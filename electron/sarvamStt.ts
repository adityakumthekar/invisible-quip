/**
 * Sarvam speech-to-text, used for the voice path when Claude on Bedrock is the
 * provider — Converse can't take audio, so the clip is transcribed first.
 *
 * The real-time REST endpoint is documented for clips under 30 seconds; the
 * renderer splits longer recordings into ≤29 s WAV pieces (src/lib/wavChunks.ts)
 * and they are sent here as an ordered list.
 */
const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text"

export interface AudioChunk {
  /** Base64, no data: prefix. */
  data: string
  mimeType: string
}

export class SarvamStt {
  constructor(
    private apiKey: string,
    private model: string = process.env.SARVAM_STT_MODEL || "saaras:v4"
  ) {}

  /**
   * One transcript per chunk, in order. Chunks go out in parallel: a 45 s clip
   * costs one round trip, not two, which matters mid-interview.
   */
  async transcribe(chunks: AudioChunk[]): Promise<string[]> {
    return Promise.all(chunks.map((chunk) => this.transcribeOne(chunk)))
  }

  private async transcribeOne(chunk: AudioChunk): Promise<string> {
    const form = new FormData()
    const extension = chunk.mimeType.includes("wav") ? "wav" : "webm"
    form.append(
      "file",
      new Blob([Buffer.from(chunk.data, "base64")], { type: chunk.mimeType }),
      `clip.${extension}`
    )
    form.append("model", this.model)
    // Auto-detect: an interview can be in English with Hindi on either side.
    form.append("language_code", "unknown")

    const response = await fetch(SARVAM_STT_URL, {
      method: "POST",
      headers: { "api-subscription-key": this.apiKey },
      body: form
    })
    if (!response.ok) {
      let detail = response.statusText
      try {
        const body = await response.json()
        detail = body?.error?.message || detail
      } catch {
        // Not JSON — the status text is all there is.
      }
      throw new Error(`Sarvam speech-to-text failed (${response.status}): ${detail}`)
    }
    const body = (await response.json()) as { transcript?: string }
    return (body.transcript ?? "").trim()
  }
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
