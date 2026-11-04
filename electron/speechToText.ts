import { withFallback } from "./fallback"

/**
 * Speech-to-text for the voice path when Claude on Bedrock is the provider —
 * Converse can't take audio, so the clip is transcribed first. Two backends,
 * measured within ~0.1 s of each other end to end: Sarvam (built for Indian
 * English and Hindi mixed in) and Groq's hosted Whisper.
 *
 * Sarvam's real-time REST endpoint is documented for clips under 30 seconds;
 * the renderer splits longer recordings into ≤29 s WAV pieces
 * (src/lib/wavChunks.ts) and they arrive here as an ordered list. Groq has no
 * such cap but takes the same pieces just as well.
 */
export interface AudioChunk {
  /** Base64, no data: prefix. */
  data: string
  mimeType: string
}

export type SttProvider = "sarvam" | "groq"

export interface SpeechToText {
  readonly provider: SttProvider
  /**
   * One transcript per chunk, in order. Chunks go out in parallel: a 45 s clip
   * costs one round trip, not two, which matters mid-interview.
   */
  transcribe(chunks: AudioChunk[]): Promise<string[]>
}

/** Both services want a filename whose extension matches the audio. */
function fileFor(chunk: AudioChunk): { blob: Blob; name: string } {
  const extension = chunk.mimeType.includes("wav")
    ? "wav"
    : chunk.mimeType.includes("mp4") || chunk.mimeType.includes("aac")
      ? "m4a"
      : chunk.mimeType.includes("ogg")
        ? "ogg"
        : "webm"
  return {
    blob: new Blob([Buffer.from(chunk.data, "base64")], { type: chunk.mimeType }),
    name: `clip.${extension}`
  }
}

async function postForm(
  service: string,
  url: string,
  headers: Record<string, string>,
  form: FormData
): Promise<any> {
  const response = await fetch(url, { method: "POST", headers, body: form })
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      detail = body?.error?.message || detail
    } catch {
      // Not JSON — the status text is all there is.
    }
    throw new Error(`${service} speech-to-text failed (${response.status}): ${detail}`)
  }
  return response.json()
}

export class SarvamStt implements SpeechToText {
  readonly provider = "sarvam"

  constructor(
    private apiKey: string,
    private model: string = process.env.SARVAM_STT_MODEL || "saaras:v4"
  ) {}

  async transcribe(chunks: AudioChunk[]): Promise<string[]> {
    return Promise.all(chunks.map((chunk) => this.transcribeOne(chunk)))
  }

  private async transcribeOne(chunk: AudioChunk): Promise<string> {
    const { blob, name } = fileFor(chunk)
    const form = new FormData()
    form.append("file", blob, name)
    form.append("model", this.model)
    // Auto-detect: an interview can be in English with Hindi on either side.
    form.append("language_code", "unknown")
    const body = await postForm(
      "Sarvam",
      "https://api.sarvam.ai/speech-to-text",
      { "api-subscription-key": this.apiKey },
      form
    )
    return (body.transcript ?? "").trim()
  }
}

export class GroqStt implements SpeechToText {
  readonly provider = "groq"

  constructor(
    private apiKey: string,
    private model: string = process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo"
  ) {}

  async transcribe(chunks: AudioChunk[]): Promise<string[]> {
    return Promise.all(chunks.map((chunk) => this.transcribeOne(chunk)))
  }

  private async transcribeOne(chunk: AudioChunk): Promise<string> {
    const { blob, name } = fileFor(chunk)
    const form = new FormData()
    form.append("file", blob, name)
    form.append("model", this.model)
    form.append("response_format", "json")
    const body = await postForm(
      "Groq",
      "https://api.groq.com/openai/v1/audio/transcriptions",
      { Authorization: `Bearer ${this.apiKey}` },
      form
    )
    return (body.text ?? "").trim()
  }
}

/**
 * The backend asked for, if its key is there; otherwise whichever key is.
 * Sarvam wins a tie — it was built for the accents Quip is used with.
 */
export function createSpeechToText(opts: {
  provider?: string
  sarvamApiKey?: string
  groqApiKey?: string
}): SpeechToText | null {
  const { provider, sarvamApiKey, groqApiKey } = opts
  if (provider === "groq" && groqApiKey) return new GroqStt(groqApiKey)
  if (provider === "sarvam" && sarvamApiKey) return new SarvamStt(sarvamApiKey)
  if (sarvamApiKey) return new SarvamStt(sarvamApiKey)
  if (groqApiKey) return new GroqStt(groqApiKey)
  return null
}

/** Tries each backend in order. Reports the first, since that is the one asked for. */
export class FallbackStt implements SpeechToText {
  readonly provider: SttProvider

  constructor(private backends: SpeechToText[]) {
    this.provider = backends[0].provider
  }

  async transcribe(chunks: AudioChunk[]): Promise<string[]> {
    const byProvider = new Map(this.backends.map((b) => [b.provider, b]))
    return withFallback([...byProvider.keys()], (p) => byProvider.get(p as SttProvider)!.transcribe(chunks), {
      label: "speech-to-text"
    })
  }
}

/**
 * `createSpeechToText` for an ordered list (quip.models.json's `stt`): every
 * listed backend with a key, the rest kept as fallbacks. With no usable entry
 * it behaves exactly like `createSpeechToText` with no preference.
 */
export function createSpeechToTextChain(opts: {
  order: (string | undefined)[]
  sarvamApiKey?: string
  groqApiKey?: string
}): SpeechToText | null {
  const backends: SpeechToText[] = []
  for (const provider of opts.order) {
    if (backends.some((b) => b.provider === provider)) continue
    if (provider === "groq" && opts.groqApiKey) backends.push(new GroqStt(opts.groqApiKey))
    if (provider === "sarvam" && opts.sarvamApiKey) backends.push(new SarvamStt(opts.sarvamApiKey))
  }
  if (backends.length === 0) {
    return createSpeechToText({ sarvamApiKey: opts.sarvamApiKey, groqApiKey: opts.groqApiKey })
  }
  return backends.length === 1 ? backends[0] : new FallbackStt(backends)
}

/**
 * Build the transcript in the `YOU:`/`THEM:` shape `parseTranscriptTurns`
 * already reads. The clips are transcribed separately, so turns can only be
 * ordered by chunk window; within a window THEM goes first, since what they
 * asked is what the answer is for.
 */
export function labelledTranscript(you: string[], them: string[]): string {
  const lines: string[] = []
  const windows = Math.max(you.length, them.length)
  for (let i = 0; i < windows; i++) {
    if (them[i]) lines.push(`THEM: ${them[i]}`)
    if (you[i]) lines.push(`YOU: ${you[i]}`)
  }
  // Empty, not "(no speech)": that is what parseAudioAnswer hands the
  // renderer on the Gemini path when nothing was said.
  return lines.join("\n")
}
