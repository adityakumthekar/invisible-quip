import {
  GoogleGenerativeAI,
  GenerativeModel,
  GenerateContentRequest,
  Part
} from "@google/generative-ai"
import fs from "fs"
import sharp from "sharp"
import {
  parseTeachingResponse,
  pixelTeachingTargetToNormalized,
  TeachingStepResponse
} from "./teaching"
import {
  createAnswerSplitter,
  parseAudioAnswer,
  parseTranscriptTurns,
  TranscriptTurn
} from "./audioAnswer"
import {
  ChatTurn,
  flattenHistory,
  toConverseHistory,
  toGeminiHistory
} from "./chatHistory"
import {
  BedrockClient,
  BedrockConfig,
  bedrockApiKeyFromEnv,
  ConverseRequest,
  imageBlock,
  withUserTurn
} from "./bedrockClient"
import {
  AudioChunk,
  SpeechToText,
  SttProvider,
  createSpeechToText,
  labelledTranscript
} from "./speechToText"

/**
 * How a model expresses target coordinates. Gemini is trained on a normalized
 * 0–1000 box space; local vision models (Qwen2.5-VL and friends) emit absolute
 * pixels. Everything downstream speaks "normalized", so the pixel dialect gets
 * converted at this boundary — see `normalizeTeachingStep`.
 */
export type TeachingCoordinateSpace = "normalized" | "pixels"

export function buildTeachingPrompt(
  goal: string,
  history: string[],
  imageSize: { width: number; height: number },
  coordinateSpace: TeachingCoordinateSpace = "normalized"
): string {
  const priorSteps =
    history.length > 0
      ? history.map((step, index) => `${index + 1}. ${step}`).join("\n")
      : "None."

  const coordinateRules =
    coordinateSpace === "normalized"
      ? `IMPORTANT — target coordinates use the normalized 0–1000 space (NOT raw screenshot pixels):
- (0, 0) is the top-left of the image; (1000, 1000) is the bottom-right.
- x/y are the top-left corner of the UI element in that 0–1000 space.
- width/height are also in 0–1000 space. Always provide them so the action lands on the element center.
- Example: an element covering the middle of the screen might be {"x":400,"y":450,"width":200,"height":100}.`
      : `IMPORTANT — target coordinates are absolute pixels in the attached image:
- (0, 0) is the top-left; (${imageSize.width}, ${imageSize.height}) is the bottom-right.
- x/y are the top-left corner of the UI element, in pixels.
- width/height are the element's size in pixels. Always provide them so the action lands on the element center.
- Example: a button 80×32 pixels near the middle might be {"x":700,"y":420,"width":80,"height":32}.`

  return `You are a visual assistant working toward this goal on the user's screen:
${goal}

Prior step summaries:
${priorSteps}

Inspect the attached screenshot (${imageSize.width}×${imageSize.height} pixels) and return exactly one concise instruction for only the immediate next action. Do not provide a list or multiple actions. The app performs the action on the user's real screen, so choose one small, reversible action at a time and re-assess from the next screenshot.

Return only one strict JSON object with this exact contract:
{
  "state": "step" | "complete" | "blocked",
  "instruction": "one concise instruction",
  "label": "optional short name of the target element",
  "action": "click" | "double-click" | "right-click" | "type" | "scroll" | "key" | "drag" | "wait",
  "risk": "safe" | "confirm",
  "text": "text to type (only when action is type)",
  "key": "key combo to press (only when action is key)",
  "scroll": { "direction": "up" | "down" | "left" | "right", "amount": number },
  "to": { "x": number, "y": number, "width": number, "height": number },
  "target": { "x": number, "y": number, "width": number, "height": number }
}

Use state "step" when there is a visible next action. target is required for every step — including "key" and "wait", where it should point at the element you are acting on or waiting for.
${coordinateRules}

Choose exactly one action:
- "click" — click the target. Use this unless another action clearly fits.
- "double-click" — open an item that needs two clicks (a file, a list row).
- "right-click" — open a context menu at the target.
- "type" — click the target, then enter "text". Include "text" only here.
- "scroll" — put the pointer on the target and scroll. Include "scroll" only here; amount is 1–25 notches. Use this when the element you need is off-screen.
- "key" — press a key combo, e.g. "Enter", "Tab", "Escape", "cmd+a", "ctrl+shift+n". Include "key" only here. Only these named keys are supported: Enter, Return, Tab, Escape, Space, Backspace, Delete, Up, Down, Left, Right, Home, End, PageUp, PageDown, F1–F12, plus single letters and digits. Modifiers: cmd, ctrl, alt, option, shift, meta.
- "drag" — press at target, move to "to", release. Include "to" only here.
- "wait" — the screen is still loading; do nothing and look again shortly.
Include ONLY the payload field belonging to your chosen action; any other payload field is an error.

Set "risk" to "confirm" when the action would be hard or impossible to undo — sending or posting a message, deleting or discarding something, submitting a form, confirming a dialog, or spending money. The app pauses and asks the user before performing those. Set "risk" to "safe" for ordinary navigation. When in doubt, choose "confirm".

Use state "complete" when the screenshot shows the goal is finished.
Use state "blocked" when no safe visible next action can be identified, and briefly explain what is missing.
For "complete" and "blocked", omit target, action, risk, and all payload fields. Omit label when it is not useful. Do not add properties, markdown, or commentary.`
}

/**
 * Fold a pixel-space step into the canonical normalized space. No-op for
 * models that already answer in 0–1000.
 */
export function normalizeTeachingStep(
  step: TeachingStepResponse,
  imageSize: { width: number; height: number },
  coordinateSpace: TeachingCoordinateSpace
): TeachingStepResponse {
  if (coordinateSpace === "normalized" || step.state !== "step") {
    return step
  }

  const convert = (target: Parameters<typeof pixelTeachingTargetToNormalized>[0]) =>
    pixelTeachingTargetToNormalized(target, imageSize.width, imageSize.height)

  return {
    ...step,
    target: convert(step.target),
    ...(step.to !== undefined ? { to: convert(step.to) } : {})
  }
}

export function parseTeachingModelText(text: string): TeachingStepResponse {
  // Gemini often wraps JSON in a ```json code fence even when told not to;
  // strip it before parsing, mirroring cleanJsonResponse on the other paths.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error("Invalid teaching JSON response")
  }
  return parseTeachingResponse(parsed)
}

export type LLMProvider = "gemini" | "ollama" | "bedrock"

interface OllamaResponse {
  response: string
  done: boolean
}

/**
 * SDK 0.2.1 predates `systemInstruction`, but it never needs to know about it:
 * `formatGenerateContentInput` returns the request untouched when `contents` is
 * present, and the caller hands the whole object to `JSON.stringify`, so the
 * field reaches the REST body regardless. Typed here rather than cast at every
 * call site.
 */
export type ChatRequest = GenerateContentRequest & {
  systemInstruction?: { role: "user"; parts: [{ text: string }] }
}

/**
 * Output contract shared by every chat flow. Carried alongside the persona
 * rather than baked into the mode prompts (src/lib/modes.ts) so
 * `set-system-prompt` can't drop it. The renderer parses the result as markdown
 * with GFM, KaTeX math, and syntax-highlighted fences, so the formats named
 * here all render.
 *
 * Written as numbered rules rather than prose: this is read by the model as a
 * system directive, and rules survive a long context better than paragraphs.
 * Rules 2 and 6 exist because of what this is — an overlay read at a glance
 * mid-conversation. Hedging is what made answers read as non-technical, and a
 * clarifying question is dead air the reader cannot answer.
 */
export const RESPONSE_FORMAT = `

OUTPUT CONTRACT

1. Answer directly. The first line is the answer itself — no preamble, no
   restating the question, no "You're looking at…", never "your best next action
   is…" or a menu of options, no meta-commentary about the screen. Assume the
   reader speaks aloud after reading one line.

2. Do not hedge. Never open with "it depends", "there are several approaches",
   or "generally". Where a real trade-off exists, commit to one answer first and
   name the trade-off in a clause after it.

3. Be specific, not general. Name the actual mechanism, data structure,
   algorithm, protocol, API, or config flag. Prefer a number to an adjective —
   complexity, latency, memory, size limits.

4. Coding problems: one or two lines on the approach, then the complete,
   runnable solution as a fenced code block, then one line of time and space
   complexity. Always tag the fence with its language — \`\`\`python,
   \`\`\`javascript, \`\`\`typescript, \`\`\`cpp, \`\`\`java, \`\`\`sql, and so
   on. Use the language already visible in the editor or question; if that is
   genuinely unclear, use Python. Never describe code in prose instead of
   writing it. Add nothing after the complexity line — no recap, no offer to
   continue.

5. Use LaTeX only for real mathematical formulas — $…$ inline, $$…$$ for
   display. Identifiers, variables, and expressions like \`nums[i]\` or \`max1\`
   go in backticks, not math.

6. If the question is ambiguous, answer the most likely reading and name the
   reading you took in a short clause. Never ask a clarifying question — the
   reader cannot reply to you.`

export class LLMHelper {
  private static readonly CHAT_IMAGE_MAX_EDGE = 1568

  /**
   * Chat calls used to pass no generationConfig at all, which left the output
   * cap at the model default — the model would happily keep writing long after
   * the user had read enough. 1024 was roughly a screenful of prose, but the
   * response contract now asks for approach + full code + complexity, which
   * truncates mid-function at that cap.
   */
  private static readonly CHAT_GENERATION_CONFIG = {
    // Was 0.4. The contract's rules 2 and 3 want the confident, specific
    // completion — sampling that hard is how "it depends" gets picked.
    temperature: 0.25,
    candidateCount: 1,
    maxOutputTokens: 2048
  }

  /**
   * The voice path emits a verbatim transcript *and* the answer, so the chat cap
   * would truncate it. It ran with no generationConfig at all until now, which
   * is why the omission never showed.
   */
  private static readonly AUDIO_GENERATION_CONFIG = {
    ...LLMHelper.CHAT_GENERATION_CONFIG,
    maxOutputTokens: 3072
  }

  private model: GenerativeModel | null = null
  /**
   * The SDK pins API_VERSION to "v1" with no override in 0.2.1. v1 is documented
   * to take `systemInstruction`, but if this endpoint rejects it we downgrade to
   * the old concatenated prompt rather than failing a question mid-interview.
   * Sticky, so the retry is paid at most once per session.
   */
  private systemInstructionSupported = true
  // Mirrors the "general" mode in src/lib/modes.ts — this is what's live until
  // the renderer's applySavedMode() sends the persisted persona on startup.
  private systemPrompt = `You are Quip, a helpful, proactive assistant for any problem or situation. Analyze the situation and give a clear, direct answer. Be concise.`
  // Who the user is, in their own words (Settings → Profile). Without it the
  // model has no way to pitch an answer at the right stack or seniority.
  private userProfile = ""
  private provider: LLMProvider = "gemini"
  private bedrock: BedrockClient | null = null
  // Voice on Bedrock only — Converse can't take audio, Gemini hears it directly.
  // Both keys are kept so Settings can change backend without re-entering one.
  private sttKeys = {
    sarvam: process.env.SARVAM_API_KEY,
    groq: process.env.GROQ_API_KEY
  }
  private stt: SpeechToText | null = createSpeechToText({
    provider: process.env.STT_PROVIDER,
    sarvamApiKey: this.sttKeys.sarvam,
    groqApiKey: this.sttKeys.groq
  })
  private ollamaModel: string = "llama3.2"
  private ollamaUrl: string = "http://localhost:11434"
  // gemini-2.0-flash was shut down June 1, 2026. 3.6 Flash (GA 2026-07-21) is
  // the pick for autopilot: it scores 83% on OSWorld-Verified against 78.4% for
  // 3.5 Flash, and screen grounding is the weakest link in a run.
  // Override with GEMINI_MODEL.
  private geminiModel: string = process.env.GEMINI_MODEL || "gemini-3.6-flash"

  constructor(
    apiKey?: string,
    useOllama: boolean = false,
    ollamaModel?: string,
    ollamaUrl?: string,
    bedrock?: BedrockConfig
  ) {
    if (bedrock) {
      this.provider = "bedrock"
      this.bedrock = new BedrockClient(bedrock)
      console.log(`[LLMHelper] Using Claude on Bedrock (${bedrock.modelId}, ${bedrock.region})`)
      // Kept alongside so Settings can switch back without re-entering a key.
      if (apiKey) {
        this.model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: this.geminiModel })
      }
    } else if (useOllama) {
      this.provider = "ollama"
      this.ollamaUrl = ollamaUrl || "http://localhost:11434"
      this.ollamaModel = ollamaModel || "gemma:latest" // Default fallback
      console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)
      
      // Auto-detect and use first available model if specified model doesn't exist
      this.initializeOllamaModel()
    } else if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey)
      this.model = genAI.getGenerativeModel({ model: this.geminiModel })
      console.log(`[LLMHelper] Using Google Gemini (${this.geminiModel})`)
    } else {
      throw new Error("Either provide a Gemini API key, a Bedrock config, or enable Ollama mode")
    }
  }

  /**
   * Full-resolution, lossless. Only the teaching/autopilot path should use this
   * — its click coordinates are grounded in the exact pixels the model sees.
   */
  private async fileToGenerativePart(imagePath: string) {
    const imageData = await fs.promises.readFile(imagePath)
    return {
      inlineData: {
        data: imageData.toString("base64"),
        mimeType: "image/png"
      }
    }
  }

  /**
   * The chat path's image part. A raw Retina capture is a 3–8 MB PNG (~4–11 MB
   * once base64'd) and uploading it dominates time-to-first-token. Gemini tiles
   * vision input at 768px, so anything past ~1568px on the long edge costs
   * bandwidth without giving the model more to look at.
   */
  private async toChatImagePart(image: string | Buffer) {
    const jpeg = await this.toChatJpeg(image)
    return {
      inlineData: {
        data: jpeg.toString("base64"),
        mimeType: "image/jpeg"
      }
    }
  }

  /** The bytes behind `toChatImagePart`; Bedrock takes them raw, not base64. */
  private async toChatJpeg(image: string | Buffer): Promise<Buffer> {
    return sharp(image)
      .resize({
        width: LLMHelper.CHAT_IMAGE_MAX_EDGE,
        height: LLMHelper.CHAT_IMAGE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({ quality: 80 })
      .toBuffer()
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  /**
   * The Gemini path puts the persona, profile and output contract in
   * `systemInstruction`; Ollama's /api/generate has an equivalent `system`
   * field, so both providers get the same layering instead of Ollama getting a
   * bare message.
   */
  private ollamaSystem(persona?: string): string {
    return `${this.personaBlock(persona)}${RESPONSE_FORMAT}`
  }

  private async callOllama(
    prompt: string,
    options: {
      /** Base64 PNG data, no data: prefix. Requires a vision-capable model. */
      images?: string[]
      /** Ask Ollama to constrain output to valid JSON. */
      json?: boolean
      temperature?: number
      /** Persona + output contract, kept out of the prompt body. */
      system?: string
    } = {}
  ): Promise<string> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: prompt,
          stream: false,
          ...(options.system ? { system: options.system } : {}),
          ...(options.images?.length ? { images: options.images } : {}),
          ...(options.json ? { format: "json" } : {}),
          options: {
            temperature: options.temperature ?? 0.7,
            top_p: 0.9,
          }
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data: OllamaResponse = await response.json()
      return data.response
    } catch (error) {
      console.error("[LLMHelper] Error calling Ollama:", error)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to connect to Ollama: ${message}. Make sure Ollama is running on ${this.ollamaUrl}`)
    }
  }

  /**
   * Streaming counterpart to `callOllama`. Ollama emits NDJSON — one object per
   * line, each carrying a `response` fragment — so partial lines are buffered
   * across network chunks, same as `pullOllamaModel` does for download status.
   */
  private async callOllamaStream(
    prompt: string,
    onChunk: (delta: string) => void,
    options: {
      images?: string[]
      temperature?: number
      signal?: AbortSignal
      /** Persona + output contract, kept out of the prompt body. */
      system?: string
    } = {}
  ): Promise<string> {
    let response: Response
    try {
      response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt,
          stream: true,
          ...(options.system ? { system: options.system } : {}),
          ...(options.images?.length ? { images: options.images } : {}),
          options: {
            temperature: options.temperature ?? 0.7,
            top_p: 0.9
          }
        }),
        signal: options.signal
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to connect to Ollama: ${message}. Make sure Ollama is running on ${this.ollamaUrl}`
      )
    }

    if (!response.ok || !response.body) {
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}`
      )
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let text = ""

    const handleLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return
      let parsed: any
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        return
      }
      if (parsed.error) {
        throw new Error(String(parsed.error))
      }
      const delta = typeof parsed.response === "string" ? parsed.response : ""
      if (!delta) return
      text += delta
      onChunk(delta)
    }

    while (true) {
      if (options.signal?.aborted) {
        await reader.cancel().catch(() => {})
        break
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      lines.forEach(handleLine)
    }
    handleLine(buffer)

    return text
  }

  /**
   * Whether a local model can accept images. Newer Ollama reports this in a
   * `capabilities` array; older builds only hint at it through the projector
   * family (clip/mllama), so both are checked.
   */
  public async getOllamaModelCapabilities(
    model: string
  ): Promise<{ vision: boolean }> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model })
      })
      if (!response.ok) {
        return { vision: false }
      }

      const data = await response.json()
      const capabilities: string[] = Array.isArray(data?.capabilities)
        ? data.capabilities
        : []
      if (capabilities.includes("vision")) {
        return { vision: true }
      }

      const families: string[] = Array.isArray(data?.details?.families)
        ? data.details.families
        : []
      const projectors = ["clip", "mllama", "qwen2vl", "qwen25vl"]
      return {
        vision: families.some((family) =>
          projectors.includes(String(family).toLowerCase())
        )
      }
    } catch (error) {
      console.error("[LLMHelper] Error reading Ollama model capabilities:", error)
      return { vision: false }
    }
  }

  /**
   * Download a model, reporting progress. Ollama streams NDJSON, one status
   * object per line, so partial lines are buffered across chunks.
   */
  public async pullOllamaModel(
    model: string,
    onProgress: (progress: {
      status: string
      completed?: number
      total?: number
    }) => void
  ): Promise<void> {
    const response = await fetch(`${this.ollamaUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: true })
    })

    if (!response.ok || !response.body) {
      throw new Error(
        `Could not start the download (${response.status} ${response.statusText}). Make sure Ollama is running at ${this.ollamaUrl}.`
      )
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    const handleLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return
      let parsed: any
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        return
      }
      if (parsed.error) {
        throw new Error(String(parsed.error))
      }
      onProgress({
        status: String(parsed.status ?? "downloading"),
        ...(typeof parsed.completed === "number"
          ? { completed: parsed.completed }
          : {}),
        ...(typeof parsed.total === "number" ? { total: parsed.total } : {})
      })
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        handleLine(line)
      }
    }

    handleLine(buffer)
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  private async initializeOllamaModel(): Promise<void> {
    try {
      const availableModels = await this.getOllamaModels()
      if (availableModels.length === 0) {
        console.warn("[LLMHelper] No Ollama models found")
        return
      }

      // Check if current model exists, if not use the first available
      if (!availableModels.includes(this.ollamaModel)) {
        this.ollamaModel = availableModels[0]
        console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`)
      }

      // Test the selected model works
      await this.callOllama("Hello")
      console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[LLMHelper] Failed to initialize Ollama model: ${message}`)
      // Try to use first available model as fallback
      try {
        const models = await this.getOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError)
        console.error(`[LLMHelper] Fallback also failed: ${fallbackMessage}`)
      }
    }
  }

  /**
   * The record button's path. It used to ask the model to *describe* the clip,
   * which is the wrong job for an interview copilot — it now answers what was
   * asked, and returns the spoken words separately so the renderer can show
   * them as the user's own turn instead of an unattributed answer.
   */
  public async analyzeAudioFromBase64(
    data: string,
    mimeType: string,
    history: ChatTurn[] = [],
    system?: { data: string; mimeType: string },
    /**
     * Pre-split ≤29 s WAV pieces from the renderer, sent only for long clips on
     * Bedrock — Sarvam's real-time endpoint stops at 30 s. Gemini ignores it.
     */
    chunks?: { mic: AudioChunk[]; system?: AudioChunk[] }
  ) {
    if (this.provider === "bedrock") {
      return this.analyzeAudioWithBedrock(
        chunks?.mic ?? [{ data, mimeType }],
        chunks?.system ?? (system ? [system] : undefined),
        history
      )
    }
    try {
      const audioPart = {
        inlineData: {
          data,
          mimeType
        }
      };
      const audioParts = system
        ? [audioPart, { inlineData: { data: system.data, mimeType: system.mimeType } }]
        : [audioPart]
      const preamble = LLMHelper.audioPreamble(Boolean(system))
      // A spoken follow-up belongs to the same conversation as the typed turns
      // around it, so it carries the same history.
      const text = await this.generateChatContent((legacy) =>
        this.buildChatRequest({
          message: "",
          preamble,
          imageParts: audioParts,
          history,
          generationConfig: LLMHelper.AUDIO_GENERATION_CONFIG,
          legacy
        })
      )
      const { transcript, answer } = parseAudioAnswer(text);
      return {
        transcript,
        turns: parseTranscriptTurns(transcript),
        text: answer,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error("Error analyzing audio from base64:", error);
      throw error;
    }
  }

  // The section labels and the YOU:/THEM: prefixes are parsed by regex in
  // audioAnswer.ts — reword the framing freely, but they must not move.
  // Attribution is positional, so the mic clip has to stay part one.
  private static audioPreamble(dualClip: boolean): string {
    return dualClip
      ? `Two audio clips are attached, recorded at the same time. The FIRST is this user's own microphone. The SECOND is this computer's audio output — the other people on the call. Each clip may bleed into the other; attribute a line to whoever is louder and clearer in it. Answer the question the other party asked, not the user's own words.

Reply in exactly two sections and nothing else:
TRANSCRIPT: one line per turn, in the order spoken, each starting with "YOU:" or "THEM:" — or "(no speech)" if neither clip has any
ANSWER: your answer`
      : `The attached audio clip is the user speaking, most likely a question asked out loud in the room. Answer what was asked.

Reply in exactly two sections and nothing else:
TRANSCRIPT: the words that were spoken, verbatim, on one line — or "(no speech)" if the clip has none
ANSWER: your answer`
  }

  /**
   * The record button's streaming path. The spoken turns go to `onTranscript`
   * the moment they are known — before any of the answer — so the renderer can
   * show what was heard while the answer is still being written. Resolves with
   * the answer alone, which is what the chat stream's done event carries.
   */
  public async analyzeAudioStream(
    data: string,
    mimeType: string,
    onTranscript: (transcript: string, turns: TranscriptTurn[]) => void,
    onChunk: (delta: string) => void,
    signal?: AbortSignal,
    history: ChatTurn[] = [],
    system?: { data: string; mimeType: string },
    chunks?: { mic: AudioChunk[]; system?: AudioChunk[] }
  ): Promise<string> {
    const announce = (transcript: string) =>
      onTranscript(transcript, parseTranscriptTurns(transcript))

    if (this.provider === "bedrock") {
      const hasSystem = Boolean(chunks?.system ?? system)
      const transcript = await this.transcribe(
        chunks?.mic ?? [{ data, mimeType }],
        chunks?.system ?? (system ? [system] : undefined)
      )
      announce(transcript)
      if (!transcript) {
        onChunk(LLMHelper.NO_SPEECH_REPLY)
        return LLMHelper.NO_SPEECH_REPLY
      }
      return this.bedrockOrThrow().converseStream(
        this.buildConverseRequest({
          message: transcript,
          preamble: LLMHelper.transcriptPreamble(hasSystem),
          history
        }),
        onChunk,
        signal
      )
    }

    const audioParts = [
      { inlineData: { data, mimeType } },
      ...(system ? [{ inlineData: { data: system.data, mimeType: system.mimeType } }] : [])
    ]
    const splitter = createAnswerSplitter({
      onTranscript: announce,
      onAnswerDelta: onChunk
    })
    await this.consumeGeminiStream(
      (legacy) =>
        this.buildChatRequest({
          message: "",
          preamble: LLMHelper.audioPreamble(Boolean(system)),
          imageParts: audioParts,
          history,
          generationConfig: LLMHelper.AUDIO_GENERATION_CONFIG,
          legacy
        }),
      (delta) => splitter.push(delta),
      signal
    )
    return splitter.finish().answer
  }

  /**
   * The voice path on Bedrock: Sarvam transcribes, Claude answers. Each side of
   * the call is its own clip, so attribution comes from which clip a line was
   * in rather than the model judging who sounded louder.
   */
  private async analyzeAudioWithBedrock(
    mic: AudioChunk[],
    system: AudioChunk[] | undefined,
    history: ChatTurn[]
  ) {
    const transcript = await this.transcribe(mic, system)
    if (!transcript) {
      // Nothing to answer, so don't pay for a model call to say so.
      return {
        transcript: "",
        turns: [],
        text: LLMHelper.NO_SPEECH_REPLY,
        timestamp: Date.now()
      }
    }

    const { text } = await this.bedrockOrThrow().converse(
      this.buildConverseRequest({
        message: transcript,
        preamble: LLMHelper.transcriptPreamble(Boolean(system)),
        history
      })
    )
    return {
      transcript,
      turns: parseTranscriptTurns(transcript),
      text,
      timestamp: Date.now()
    }
  }

  private static readonly NO_SPEECH_REPLY = "No speech was picked up in that clip."

  private static transcriptPreamble(dualClip: boolean): string {
    return dualClip
      ? "Below is a transcript of a live call. THEM lines are the other people on the call; YOU lines are this user. Answer the question the other party asked, not the user's own words."
      : "Below is what the user just said out loud, most likely a question asked in the room. Answer what was asked."
  }

  /** Both clips at once: the slower of the two is the whole wait, not the sum. */
  private async transcribe(
    mic: AudioChunk[],
    system: AudioChunk[] | undefined
  ): Promise<string> {
    const stt = this.stt
    if (!stt) {
      throw new Error(
        "Voice on Bedrock needs speech-to-text. Set SARVAM_API_KEY or GROQ_API_KEY, or add a key in Settings → Provider."
      )
    }
    const [you, them] = await Promise.all([
      stt.transcribe(mic),
      system ? stt.transcribe(system) : Promise.resolve([])
    ])
    return labelledTranscript(you, them)
  }

  /**
   * The active persona plus whatever the user told us about themselves. Every
   * chat flow builds its system layer from this rather than `this.systemPrompt`
   * directly, so a new flow can't ship without the profile by forgetting it.
   *
   * `override` replaces the persona for one request — quick actions are explicit
   * tasks, and the active mode is the wrong voice for "Translate".
   */
  private personaBlock(override?: string): string {
    const persona = override?.trim() || this.systemPrompt
    if (!this.userProfile) return persona
    return `${persona}\n\nAbout the user — use this to calibrate technical depth, stack, and first-person details. Never read it aloud, quote it, or mention that you have it:\n${this.userProfile}`
  }

  /** Per-request facts about where the question came from. Not the system layer. */
  private static readonly SCREEN_PREAMBLE =
    "The attached screenshot is the user's screen. If it shows a question, problem, or exercise, that is what to answer — read any code carefully and reply in the language already on screen. Answer the user's message below in that context."

  private static readonly IMAGE_PREAMBLE =
    "Answer the question visible in the attached screenshot. Read any code or problem statement carefully and answer in the language already on screen. If there is genuinely no question, say what is on screen in one line."

  /**
   * The one place a chat request is shaped, so the six flows can't drift apart.
   *
   * The persona, profile and output contract go in `systemInstruction`: sent as
   * part of the user turn they read as something the user just said this turn,
   * which is the weakest position for instruction-following, and they were
   * re-sent on every turn of a 45-minute session. `legacy` rebuilds the old
   * concatenated shape for the downgrade path.
   */
  private buildChatRequest(opts: {
    message: string
    preamble?: string
    imageParts?: Part[]
    history?: ChatTurn[]
    persona?: string
    generationConfig?: object
    legacy?: boolean
  }): ChatRequest {
    const { message, preamble, imageParts = [], history = [], persona } = opts
    const generationConfig =
      opts.generationConfig ?? LLMHelper.CHAT_GENERATION_CONFIG

    const joinUser = (...blocks: (string | undefined)[]) =>
      blocks.filter((b) => b && b.length > 0).join("\n\n")

    if (opts.legacy || !this.systemInstructionSupported) {
      const text = `${this.personaBlock(persona)}${preamble ? `\n\n${preamble}` : ""}${RESPONSE_FORMAT}${message ? `\n\nUser: ${message}` : ""}`
      return {
        contents: [
          ...toGeminiHistory(history),
          { role: "user", parts: [{ text }, ...imageParts] }
        ],
        generationConfig
      }
    }

    return {
      systemInstruction: {
        role: "user",
        parts: [{ text: `${this.personaBlock(persona)}${RESPONSE_FORMAT}` }]
      },
      contents: [
        ...toGeminiHistory(history),
        {
          role: "user",
          parts: [{ text: joinUser(preamble, message) }, ...imageParts]
        }
      ],
      generationConfig
    }
  }

  /**
   * Whether an error is the v1 endpoint refusing `systemInstruction`. Requires
   * the field name to appear, so an unrelated 400 can't silently downgrade the
   * whole session to the weaker prompt shape.
   */
  private static rejectsSystemInstruction(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return (
      /systemInstruction/i.test(message) &&
      /unknown name|cannot find field|invalid|not supported|unsupported/i.test(
        message
      )
    )
  }

  private downgradeSystemInstruction(error: unknown): void {
    this.systemInstructionSupported = false
    console.warn(
      "[LLMHelper] Endpoint rejected systemInstruction; falling back to the " +
        "concatenated prompt for the rest of this session.",
      error instanceof Error ? error.message : error
    )
  }

  /**
   * Drive a Gemini stream, forwarding each delta as it lands and returning the
   * full text. Aborting stops forwarding immediately rather than waiting for
   * the remaining tokens, so a superseded request can't write into the chat.
   *
   * Takes a builder rather than a request so the downgrade can rebuild. The 400
   * lands on the initial call, before any chunk, but the guard is explicit: a
   * retry after the first delta would duplicate text in the panel.
   */
  private async consumeGeminiStream(
    build: (legacy: boolean) => ChatRequest,
    onChunk: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    if (!this.model) {
      throw new Error("No LLM provider configured")
    }
    let sawChunk = false
    const run = async (legacy: boolean) => {
      const result = await this.model!.generateContentStream(build(legacy))
      let text = ""
      for await (const chunk of result.stream) {
        if (signal?.aborted) break
        const delta = chunk.text()
        if (!delta) continue
        sawChunk = true
        text += delta
        onChunk(delta)
      }
      return text
    }

    try {
      return await run(false)
    } catch (error) {
      if (
        sawChunk ||
        !this.systemInstructionSupported ||
        !LLMHelper.rejectsSystemInstruction(error)
      ) {
        throw error
      }
      this.downgradeSystemInstruction(error)
      return run(true)
    }
  }

  /** Non-streaming counterpart to `consumeGeminiStream`, same downgrade. */
  private async generateChatContent(
    build: (legacy: boolean) => ChatRequest
  ): Promise<string> {
    if (!this.model) {
      throw new Error("No LLM provider configured")
    }
    const run = async (legacy: boolean) => {
      const result = await this.model!.generateContent(build(legacy))
      const response = await result.response
      return response.text()
    }

    try {
      return await run(false)
    } catch (error) {
      if (
        !this.systemInstructionSupported ||
        !LLMHelper.rejectsSystemInstruction(error)
      ) {
        throw error
      }
      this.downgradeSystemInstruction(error)
      return run(true)
    }
  }

  private bedrockOrThrow(): BedrockClient {
    if (!this.bedrock) {
      throw new Error("Bedrock is not configured")
    }
    return this.bedrock
  }

  /**
   * `buildChatRequest`'s Converse twin: same system layer, same preambles, same
   * history window. Converse has a first-class `system` field, so there is no
   * legacy downgrade to carry.
   */
  private buildConverseRequest(opts: {
    message: string
    preamble?: string
    images?: Buffer[]
    history?: ChatTurn[]
    persona?: string
  }): ConverseRequest {
    const { message, preamble, images = [], history = [], persona } = opts
    const text = [preamble, message].filter((b) => b && b.length > 0).join("\n\n")
    return {
      system: `${this.personaBlock(persona)}${RESPONSE_FORMAT}`,
      // Claude reads an image best when it comes before the question about it.
      messages: withUserTurn(toConverseHistory(history), [
        ...images.map((jpeg) => imageBlock(jpeg, "jpeg")),
        ...(text ? [{ text }] : [])
      ]),
      temperature: LLMHelper.CHAT_GENERATION_CONFIG.temperature,
      maxTokens: LLMHelper.CHAT_GENERATION_CONFIG.maxOutputTokens
    }
  }

  public async analyzeImageFile(imagePath: string) {
    if (this.provider === "bedrock") {
      const { text } = await this.bedrockOrThrow().converse(
        this.buildConverseRequest({
          message: "",
          preamble: LLMHelper.IMAGE_PREAMBLE,
          images: [await this.toChatJpeg(imagePath)]
        })
      )
      return { text, timestamp: Date.now() }
    }
    try {
      const imagePart = await this.toChatImagePart(imagePath)
      const text = await this.generateChatContent((legacy) =>
        this.buildChatRequest({
          message: "",
          preamble: LLMHelper.IMAGE_PREAMBLE,
          imageParts: [imagePart],
          legacy
        })
      )
      return { text, timestamp: Date.now() }
    } catch (error) {
      console.error("Error analyzing image file:", error);
      throw error;
    }
  }

  public async analyzeImageFileStream(
    imagePath: string,
    onChunk: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    if (this.provider === "bedrock") {
      return this.bedrockOrThrow().converseStream(
        this.buildConverseRequest({
          message: "",
          preamble: LLMHelper.IMAGE_PREAMBLE,
          images: [await this.toChatJpeg(imagePath)]
        }),
        onChunk,
        signal
      )
    }
    const imagePart = await this.toChatImagePart(imagePath)
    return this.consumeGeminiStream(
      (legacy) =>
        this.buildChatRequest({
          message: "",
          preamble: LLMHelper.IMAGE_PREAMBLE,
          imageParts: [imagePart],
          legacy
        }),
      onChunk,
      signal
    )
  }

  public setSystemPrompt(text: string): void {
    // Fall back to the default persona if a caller clears it.
    this.systemPrompt = text?.trim() ? text.trim() : this.systemPrompt
  }

  // No fallback here, unlike setSystemPrompt: emptying the field in Settings is
  // how the user takes their profile back out of every request.
  public setUserProfile(text: string): void {
    this.userProfile = text?.trim() ?? ""
  }

  public async chatWithGemini(message: string): Promise<string> {
    try {
      if (this.provider === "ollama") {
        return this.callOllama(message, { system: this.ollamaSystem() })
      }
      if (this.provider === "bedrock") {
        const { text } = await this.bedrockOrThrow().converse(
          this.buildConverseRequest({ message })
        )
        return text
      }
      return this.generateChatContent((legacy) =>
        this.buildChatRequest({ message, legacy })
      )
    } catch (error) {
      console.error("[LLMHelper] Error in chatWithGemini:", error);
      throw error;
    }
  }

  /**
   * `history` is last and optional so existing positional call sites keep
   * working. Without it every request was standalone, and a follow-up like
   * "now do the same in TypeScript" had no referent to resolve.
   */
  public async chatWithGeminiStream(
    message: string,
    onChunk: (delta: string) => void,
    signal?: AbortSignal,
    history: ChatTurn[] = [],
    persona?: string
  ): Promise<string> {
    if (this.provider === "ollama") {
      const prior = flattenHistory(history)
      return this.callOllamaStream(
        prior ? `${prior}\n\nUser: ${message}` : message,
        onChunk,
        { signal, system: this.ollamaSystem(persona) }
      )
    }
    if (this.provider === "bedrock") {
      return this.bedrockOrThrow().converseStream(
        this.buildConverseRequest({ message, history, persona }),
        onChunk,
        signal
      )
    }
    return this.consumeGeminiStream(
      (legacy) => this.buildChatRequest({ message, history, persona, legacy }),
      onChunk,
      signal
    )
  }

  public async chat(message: string): Promise<string> {
    return this.chatWithGemini(message);
  }

  public async chatWithImage(
    message: string,
    images: (string | Buffer)[]
  ): Promise<string> {
    try {
      // ponytail: most Ollama models are text-only — fall back to a text reply.
      // The system layer still rides along; it used to be dropped entirely here.
      if (this.provider === "ollama") {
        return this.callOllama(message, { system: this.ollamaSystem() })
      }
      if (this.provider === "bedrock") {
        const { text } = await this.bedrockOrThrow().converse(
          this.buildConverseRequest({
            message,
            preamble: LLMHelper.SCREEN_PREAMBLE,
            images: await Promise.all(images.map((i) => this.toChatJpeg(i)))
          })
        )
        return text
      }
      const imageParts = await Promise.all(images.map((i) => this.toChatImagePart(i)));
      return this.generateChatContent((legacy) =>
        this.buildChatRequest({
          message,
          preamble: LLMHelper.SCREEN_PREAMBLE,
          imageParts,
          legacy
        })
      )
    } catch (error) {
      console.error("[LLMHelper] Error in chatWithImage:", error);
      throw error;
    }
  }

  public async chatWithImageStream(
    message: string,
    images: (string | Buffer)[],
    onChunk: (delta: string) => void,
    signal?: AbortSignal,
    history: ChatTurn[] = [],
    persona?: string
  ): Promise<string> {
    if (this.provider === "ollama") {
      // This used to send the bare message: no persona, no profile, no output
      // contract. Ollama's /api/generate has a first-class `system` field.
      const prior = flattenHistory(history)
      return this.callOllamaStream(
        prior ? `${prior}\n\nUser: ${message}` : message,
        onChunk,
        { signal, system: this.ollamaSystem(persona) }
      )
    }
    if (this.provider === "bedrock") {
      return this.bedrockOrThrow().converseStream(
        this.buildConverseRequest({
          message,
          preamble: LLMHelper.SCREEN_PREAMBLE,
          images: await Promise.all(images.map((i) => this.toChatJpeg(i))),
          history,
          persona
        }),
        onChunk,
        signal
      )
    }
    const imageParts = await Promise.all(
      images.map((i) => this.toChatImagePart(i))
    )
    // History is text-only: past screenshots are not re-uploaded, so a
    // follow-up reasons over what was said about a screen, not the screen.
    return this.consumeGeminiStream(
      (legacy) =>
        this.buildChatRequest({
          message,
          preamble: LLMHelper.SCREEN_PREAMBLE,
          imageParts,
          history,
          persona,
          legacy
        }),
      onChunk,
      signal
    )
  }

  public async generateTeachingStep(
    goal: string,
    history: string[],
    screenshotPath: string,
    imageSize: { width: number; height: number }
  ): Promise<TeachingStepResponse> {
    if (this.provider === "ollama") {
      return this.generateTeachingStepWithOllama(
        goal,
        history,
        screenshotPath,
        imageSize
      )
    }
    if (this.provider === "bedrock") {
      return this.generateTeachingStepWithBedrock(goal, history, screenshotPath)
    }
    if (!this.model) {
      throw new Error("Gemini is not configured for teaching mode.")
    }

    const imagePart = await this.fileToGenerativePart(screenshotPath)
    const result = await this.model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: buildTeachingPrompt(goal, history, imageSize) },
            imagePart
          ]
        }
      ],
      generationConfig: {
        temperature: 0,
        candidateCount: 1,
        // gemini-3.5-flash is a thinking model and maxOutputTokens caps the
        // TOTAL output including invisible reasoning tokens. 350 was consumed
        // by thinking, truncating the JSON (finishReason MAX_TOKENS). Give
        // generous headroom so the model can think AND emit the full object;
        // it stops naturally (finishReason STOP) once done, so a high cap only
        // adds safety, not cost. Override with TEACHING_MAX_OUTPUT_TOKENS.
        maxOutputTokens: Number(process.env.TEACHING_MAX_OUTPUT_TOKENS) || 8192
      }
    })
    const response = await result.response

    const finishReason = (response as any).candidates?.[0]?.finishReason
    let rawText = ""
    try {
      rawText = response.text()
    } catch (err) {
      console.error("[teaching] response.text() threw:", err)
    }

    // Turn a truncated/empty response into a clear, actionable error instead of
    // a cryptic "Invalid teaching JSON response".
    if (finishReason === "MAX_TOKENS") {
      throw new Error(
        "Teaching response was cut off before completing (MAX_TOKENS). " +
          "Increase maxOutputTokens or simplify the step and retry."
      )
    }
    if (!rawText.trim()) {
      throw new Error(
        `Teaching model returned no text (finishReason: ${finishReason ?? "unknown"}).`
      )
    }

    return parseTeachingModelText(rawText)
  }

  /**
   * Claude grounds in pixels of the image it is given — but if the image is
   * over its vision budget the API shrinks it first, and the coordinates come
   * back in the shrunk space with nothing saying so. Sending it already inside
   * the budget means the size we ask in is the size it answers in.
   */
  private static readonly BEDROCK_TEACHING_MAX_EDGE = 1568
  private static readonly BEDROCK_TEACHING_MAX_PIXELS = 1_150_000
  /** Bedrock's per-image cap is 3.75 MB; leave room for the request around it. */
  private static readonly BEDROCK_IMAGE_MAX_BYTES = 3_500_000

  private async generateTeachingStepWithBedrock(
    goal: string,
    history: string[],
    screenshotPath: string
  ): Promise<TeachingStepResponse> {
    const meta = await sharp(screenshotPath).metadata()
    const width = meta.width ?? 1
    const height = meta.height ?? 1
    const scale = Math.min(
      1,
      LLMHelper.BEDROCK_TEACHING_MAX_EDGE / Math.max(width, height),
      Math.sqrt(LLMHelper.BEDROCK_TEACHING_MAX_PIXELS / (width * height))
    )
    const sent = {
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale))
    }
    const resized = sharp(screenshotPath).resize(sent.width, sent.height)
    // Lossless unless that won't fit: a busy, photo-heavy screen can blow the
    // per-image cap as PNG, and a refused request is worse than JPEG artefacts.
    let bytes = await resized.clone().png().toBuffer()
    let format: "png" | "jpeg" = "png"
    if (bytes.length > LLMHelper.BEDROCK_IMAGE_MAX_BYTES) {
      bytes = await resized.clone().jpeg({ quality: 90 }).toBuffer()
      format = "jpeg"
    }

    const { text, stopReason } = await this.bedrockOrThrow().converse({
      messages: [
        {
          role: "user",
          content: [
            imageBlock(bytes, format),
            { text: buildTeachingPrompt(goal, history, sent, "pixels") }
          ]
        }
      ],
      temperature: 0,
      maxTokens: Number(process.env.TEACHING_MAX_OUTPUT_TOKENS) || 8192
    })

    if (stopReason === "max_tokens") {
      throw new Error(
        "Teaching response was cut off before completing (max_tokens). " +
          "Increase TEACHING_MAX_OUTPUT_TOKENS or simplify the step and retry."
      )
    }
    if (!text.trim()) {
      throw new Error(
        `Teaching model returned no text (stopReason: ${stopReason ?? "unknown"}).`
      )
    }
    // Pixels of the image Claude saw, folded into the canonical 0–1000 space —
    // which is resolution-free, so the downscale needs no undoing.
    return normalizeTeachingStep(parseTeachingModelText(text), sent, "pixels")
  }

  private async generateTeachingStepWithOllama(
    goal: string,
    history: string[],
    screenshotPath: string,
    imageSize: { width: number; height: number }
  ): Promise<TeachingStepResponse> {
    const capabilities = await this.getOllamaModelCapabilities(this.ollamaModel)
    if (!capabilities.vision) {
      throw new Error(
        `The local model "${this.ollamaModel}" cannot read screenshots. ` +
          "Pick or install a vision model (for example qwen2.5vl:7b) in Settings."
      )
    }

    const imageData = await fs.promises.readFile(screenshotPath)
    // Local vision models answer in absolute pixels, so ask in pixels and fold
    // the result back into the canonical 0–1000 space.
    const raw = await this.callOllama(
      buildTeachingPrompt(goal, history, imageSize, "pixels"),
      {
        images: [imageData.toString("base64")],
        json: true,
        temperature: 0
      }
    )

    if (!raw.trim()) {
      throw new Error(
        `The local model "${this.ollamaModel}" returned an empty response.`
      )
    }

    return normalizeTeachingStep(
      parseTeachingModelText(raw),
      imageSize,
      "pixels"
    )
  }

  public isUsingOllama(): boolean {
    return this.provider === "ollama";
  }

  public async getOllamaModels(): Promise<string[]> {
    if (this.provider !== "ollama") return [];
    
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed to fetch models');
      
      const data = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      console.error("[LLMHelper] Error fetching Ollama models:", error);
      return [];
    }
  }

  public getCurrentProvider(): LLMProvider {
    return this.provider;
  }

  /** Which service transcribes voice on Bedrock, or null if none has a key. */
  public getCurrentStt(): SttProvider | null {
    return this.stt?.provider ?? null;
  }

  public getCurrentModel(): string {
    if (this.provider === "ollama") return this.ollamaModel;
    if (this.provider === "bedrock") return this.bedrock?.config.modelId ?? "";
    return this.geminiModel;
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    this.provider = "ollama";
    if (url) this.ollamaUrl = url;
    
    if (model) {
      this.ollamaModel = model;
    } else {
      // Auto-detect first available model
      await this.initializeOllamaModel();
    }
    
    console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel} at ${this.ollamaUrl}`);
  }

  public async switchToGemini(apiKey?: string): Promise<void> {
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      this.model = genAI.getGenerativeModel({ model: this.geminiModel });
    }
    
    if (!this.model && !apiKey) {
      throw new Error("No Gemini API key provided and no existing model instance");
    }
    
    this.provider = "gemini";
    console.log(`[LLMHelper] Switched to Gemini (${this.geminiModel})`);
  }

  /**
   * Blank fields keep what is already configured — the env on first switch,
   * the last Settings entry after — so changing only the model ID doesn't mean
   * pasting the key again.
   */
  public async switchToBedrock(opts: {
    apiKey?: string
    region?: string
    modelId?: string
    sarvamApiKey?: string
    groqApiKey?: string
    sttProvider?: SttProvider
  } = {}): Promise<void> {
    const current = this.bedrock?.config
    const config: BedrockConfig = {
      apiKey: opts.apiKey || current?.apiKey || bedrockApiKeyFromEnv() || "",
      region: opts.region || current?.region || process.env.AWS_REGION || "us-east-1",
      modelId: opts.modelId || current?.modelId || process.env.BEDROCK_MODEL_ID || ""
    }
    if (!config.apiKey) {
      throw new Error("No Bedrock API key provided (AWS_BEARER_TOKEN_BEDROCK or BEDROCK_TOKEN)")
    }
    if (!config.modelId) {
      throw new Error("No Bedrock model ID provided (BEDROCK_MODEL_ID)")
    }
    this.bedrock = new BedrockClient(config)
    if (opts.sarvamApiKey) this.sttKeys.sarvam = opts.sarvamApiKey
    if (opts.groqApiKey) this.sttKeys.groq = opts.groqApiKey
    if (opts.sarvamApiKey || opts.groqApiKey || opts.sttProvider) {
      this.stt = createSpeechToText({
        provider: opts.sttProvider ?? this.stt?.provider,
        sarvamApiKey: this.sttKeys.sarvam,
        groqApiKey: this.sttKeys.groq
      })
    }
    this.provider = "bedrock";
    console.log(`[LLMHelper] Switched to Bedrock (${config.modelId}, ${config.region})`);
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.provider === "bedrock") {
        const { text } = await this.bedrockOrThrow().converse({
          messages: [{ role: "user", content: [{ text: "Hello" }] }],
          temperature: 0,
          maxTokens: 16
        })
        return text
          ? { success: true }
          : { success: false, error: "Empty response from Bedrock" };
      }
      if (this.provider === "ollama") {
        const available = await this.checkOllamaAvailable();
        if (!available) {
          return { success: false, error: `Ollama not available at ${this.ollamaUrl}` };
        }
        // Test with a simple prompt
        await this.callOllama("Hello");
        return { success: true };
      } else {
        if (!this.model) {
          return { success: false, error: "No Gemini model configured" };
        }
        // Test with a simple prompt
        const result = await this.model.generateContent("Hello");
        const response = await result.response;
        const text = response.text(); // Ensure the response is valid
        if (text) {
          return { success: true };
        } else {
          return { success: false, error: "Empty response from Gemini" };
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
} 