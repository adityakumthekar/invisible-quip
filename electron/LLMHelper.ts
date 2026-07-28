import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"
import fs from "fs"
import sharp from "sharp"
import {
  parseTeachingResponse,
  pixelTeachingTargetToNormalized,
  TeachingStepResponse
} from "./teaching"
import { parseAudioAnswer } from "./audioAnswer"
import { ChatTurn, flattenHistory, toGeminiHistory } from "./chatHistory"

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

interface OllamaResponse {
  response: string
  done: boolean
}

const SOLUTION_JSON_FORMAT = `{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}
Important: Return ONLY the JSON object, without any markdown formatting or code blocks.`

/**
 * Output contract shared by every chat flow. Appended after the persona rather
 * than baked into the mode prompts (src/lib/modes.ts) so `set-system-prompt`
 * can't drop it. The renderer parses the result as markdown with GFM, KaTeX
 * math, and syntax-highlighted fences, so the formats named here all render.
 */
export const RESPONSE_FORMAT = `

Answer directly. State the answer itself — do not open with "You're looking at…",
do not restate the question, and never frame the answer as "your best next action
is…" or a menu of options. No meta-commentary about the screen.

If the question is a coding problem, write the complete, runnable solution as a
fenced code block. Always tag the fence with its language — \`\`\`python,
\`\`\`javascript, \`\`\`typescript, \`\`\`cpp, \`\`\`java, \`\`\`sql, and so on.
Use the language already visible in the editor or question; if that is genuinely
unclear, use Python. Never describe code in prose instead of writing it.

Structure a coding answer as: one or two lines on the approach, then the code
block, then a single line of time and space complexity. Stop there.

Use LaTeX only for real mathematical formulas — $…$ inline, $$…$$ for display.
Identifiers, variables, and expressions like \`nums[i]\` or \`max1\` go in
backticks, not math.`

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
    temperature: 0.4,
    candidateCount: 1,
    maxOutputTokens: 2048
  }

  private model: GenerativeModel | null = null
  // Mirrors the "general" mode in src/lib/modes.ts — this is what's live until
  // the renderer's applySavedMode() sends the persisted persona on startup.
  private systemPrompt = `You are Quip, a helpful, proactive assistant for any problem or situation. Analyze the situation and give a clear, direct answer. Be concise.`
  private useOllama: boolean = false
  private ollamaModel: string = "llama3.2"
  private ollamaUrl: string = "http://localhost:11434"
  // gemini-2.0-flash was shut down June 1, 2026. 3.6 Flash (GA 2026-07-21) is
  // the pick for autopilot: it scores 83% on OSWorld-Verified against 78.4% for
  // 3.5 Flash, and screen grounding is the weakest link in a run.
  // Override with GEMINI_MODEL.
  private geminiModel: string = process.env.GEMINI_MODEL || "gemini-3.6-flash"

  constructor(apiKey?: string, useOllama: boolean = false, ollamaModel?: string, ollamaUrl?: string) {
    this.useOllama = useOllama
    
    if (useOllama) {
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
      throw new Error("Either provide Gemini API key or enable Ollama mode")
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
    const jpeg = await sharp(image)
      .resize({
        width: LLMHelper.CHAT_IMAGE_MAX_EDGE,
        height: LLMHelper.CHAT_IMAGE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({ quality: 80 })
      .toBuffer()
    return {
      inlineData: {
        data: jpeg.toString("base64"),
        mimeType: "image/jpeg"
      }
    }
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  private async callOllama(
    prompt: string,
    options: {
      /** Base64 PNG data, no data: prefix. Requires a vision-capable model. */
      images?: string[]
      /** Ask Ollama to constrain output to valid JSON. */
      json?: boolean
      temperature?: number
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

  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      const imageParts = await Promise.all(imagePaths.map(path => this.fileToGenerativePart(path)))
      
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const result = await this.model.generateContent([prompt, ...imageParts])
      const response = await result.response
      const text = this.cleanJsonResponse(response.text())
      return JSON.parse(text)
    } catch (error) {
      console.error("Error extracting problem from images:", error)
      throw error
    }
  }

  public async generateSolution(problemInfo: any) {
    const prompt = `${this.systemPrompt}\n\nGiven this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n${SOLUTION_JSON_FORMAT}`

    console.log("[LLMHelper] Calling Gemini LLM for solution...");
    try {
      const result = await this.model.generateContent(prompt)
      console.log("[LLMHelper] Gemini LLM returned result.");
      const response = await result.response
      const text = this.cleanJsonResponse(response.text())
      const parsed = JSON.parse(text)
      console.log("[LLMHelper] Parsed LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("[LLMHelper] Error in generateSolution:", error);
      throw error;
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    try {
      const imageParts = await Promise.all(debugImagePaths.map(path => this.fileToGenerativePart(path)))
      
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n${SOLUTION_JSON_FORMAT}`

      const result = await this.model.generateContent([prompt, ...imageParts])
      const response = await result.response
      const text = this.cleanJsonResponse(response.text())
      const parsed = JSON.parse(text)
      console.log("[LLMHelper] Parsed debug LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("Error debugging solution with images:", error)
      throw error
    }
  }

  public async analyzeAudioFile(audioPath: string) {
    try {
      const audioData = await fs.promises.readFile(audioPath);
      const audioPart = {
        inlineData: {
          data: audioData.toString("base64"),
          mimeType: "audio/mp3"
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user.`;
      const result = await this.model.generateContent([prompt, audioPart]);
      const response = await result.response;
      const text = response.text();
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio file:", error);
      throw error;
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
    history: ChatTurn[] = []
  ) {
    try {
      const audioPart = {
        inlineData: {
          data,
          mimeType
        }
      };
      const prompt = `${this.systemPrompt}\n\nThe user spoke the attached audio clip. Answer what they asked.\n\nReply in exactly two sections and nothing else:\nTRANSCRIPT: the words that were spoken, verbatim, on one line — or "(no speech)" if the clip has none\nANSWER: your answer${RESPONSE_FORMAT}`;
      // A spoken follow-up belongs to the same conversation as the typed turns
      // around it, so it carries the same history.
      const result = await this.model.generateContent({
        contents: [
          ...toGeminiHistory(history),
          { role: "user", parts: [{ text: prompt }, audioPart] }
        ]
      });
      const response = await result.response;
      const { transcript, answer } = parseAudioAnswer(response.text());
      return { transcript, text: answer, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio from base64:", error);
      throw error;
    }
  }

  // Prompt construction lives in one place per flow so the streaming and
  // non-streaming variants below can't drift apart. Every chat flow carries
  // RESPONSE_FORMAT, so a persona swap (set-system-prompt) can't drop it.
  private imageAnalysisPrompt(): string {
    return `${this.systemPrompt}\n\nAnswer the question visible in the attached screenshot. If there is no question, say what is on screen in one line.${RESPONSE_FORMAT}`
  }

  private plainChatPrompt(message: string): string {
    // Prepend the active mode/persona so Modes actually shape plain chat.
    return `${this.systemPrompt}${RESPONSE_FORMAT}\n\nUser: ${message}`
  }

  private screenChatPrompt(message: string): string {
    return `${this.systemPrompt}\n\nThe user is looking at the attached screenshot(s) of their screen. Answer their message based on what is visible.${RESPONSE_FORMAT}\n\nUser: ${message}`
  }

  /**
   * Drive a Gemini stream, forwarding each delta as it lands and returning the
   * full text. Aborting stops forwarding immediately rather than waiting for
   * the remaining tokens, so a superseded request can't write into the chat.
   */
  private async consumeGeminiStream(
    request: Parameters<GenerativeModel["generateContentStream"]>[0],
    onChunk: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    if (!this.model) {
      throw new Error("No LLM provider configured")
    }
    const result = await this.model.generateContentStream(request)
    let text = ""
    for await (const chunk of result.stream) {
      if (signal?.aborted) break
      const delta = chunk.text()
      if (!delta) continue
      text += delta
      onChunk(delta)
    }
    return text
  }

  public async analyzeImageFile(imagePath: string) {
    try {
      const imagePart = await this.toChatImagePart(imagePath);
      const result = await this.model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: this.imageAnalysisPrompt() }, imagePart]
          }
        ],
        generationConfig: LLMHelper.CHAT_GENERATION_CONFIG
      });
      const response = await result.response;
      const text = response.text();
      return { text, timestamp: Date.now() };
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
    const imagePart = await this.toChatImagePart(imagePath)
    return this.consumeGeminiStream(
      {
        contents: [
          {
            role: "user",
            parts: [{ text: this.imageAnalysisPrompt() }, imagePart]
          }
        ],
        generationConfig: LLMHelper.CHAT_GENERATION_CONFIG
      },
      onChunk,
      signal
    )
  }

  public setSystemPrompt(text: string): void {
    // Fall back to the default persona if a caller clears it.
    this.systemPrompt = text?.trim() ? text.trim() : this.systemPrompt
  }

  public async chatWithGemini(message: string): Promise<string> {
    const prompt = this.plainChatPrompt(message);
    try {
      if (this.useOllama) {
        return this.callOllama(prompt);
      } else if (this.model) {
        const result = await this.model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: LLMHelper.CHAT_GENERATION_CONFIG
        });
        const response = await result.response;
        return response.text();
      } else {
        throw new Error("No LLM provider configured");
      }
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
    history: ChatTurn[] = []
  ): Promise<string> {
    const prompt = this.plainChatPrompt(message)
    if (this.useOllama) {
      const prior = flattenHistory(history)
      return this.callOllamaStream(
        prior ? `${prior}\n\n${prompt}` : prompt,
        onChunk,
        { signal }
      )
    }
    return this.consumeGeminiStream(
      {
        contents: [
          ...toGeminiHistory(history),
          { role: "user", parts: [{ text: prompt }] }
        ],
        generationConfig: LLMHelper.CHAT_GENERATION_CONFIG
      },
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
      if (this.useOllama) {
        return this.callOllama(message);
      }
      if (!this.model) {
        throw new Error("No LLM provider configured");
      }
      const imageParts = await Promise.all(images.map((i) => this.toChatImagePart(i)));
      const result = await this.model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: this.screenChatPrompt(message) }, ...imageParts]
          }
        ],
        generationConfig: LLMHelper.CHAT_GENERATION_CONFIG
      });
      const response = await result.response;
      return response.text();
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
    history: ChatTurn[] = []
  ): Promise<string> {
    if (this.useOllama) {
      const prior = flattenHistory(history)
      return this.callOllamaStream(
        prior ? `${prior}\n\n${message}` : message,
        onChunk,
        { signal }
      )
    }
    const imageParts = await Promise.all(
      images.map((i) => this.toChatImagePart(i))
    )
    // History is text-only: past screenshots are not re-uploaded, so a
    // follow-up reasons over what was said about a screen, not the screen.
    return this.consumeGeminiStream(
      {
        contents: [
          ...toGeminiHistory(history),
          {
            role: "user",
            parts: [{ text: this.screenChatPrompt(message) }, ...imageParts]
          }
        ],
        generationConfig: LLMHelper.CHAT_GENERATION_CONFIG
      },
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
    if (this.useOllama) {
      return this.generateTeachingStepWithOllama(
        goal,
        history,
        screenshotPath,
        imageSize
      )
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
    return this.useOllama;
  }

  public async getOllamaModels(): Promise<string[]> {
    if (!this.useOllama) return [];
    
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

  public getCurrentProvider(): "ollama" | "gemini" {
    return this.useOllama ? "ollama" : "gemini";
  }

  public getCurrentModel(): string {
    return this.useOllama ? this.ollamaModel : this.geminiModel;
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    this.useOllama = true;
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
    
    this.useOllama = false;
    console.log(`[LLMHelper] Switched to Gemini (${this.geminiModel})`);
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.useOllama) {
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