/**
 * Sarvam's real-time speech-to-text takes clips under 30 seconds, and a
 * MediaRecorder webm can't be cut at arbitrary points — only its first piece
 * carries the header. So a long clip is decoded here, resampled to the 16 kHz
 * mono Sarvam recommends, and re-encoded as independent WAV pieces.
 *
 * Only the Bedrock voice path uses this; Gemini takes the whole webm as-is.
 */
export const STT_SAMPLE_RATE = 16000
/** A second of headroom under Sarvam's 30 s cap. */
export const STT_MAX_CHUNK_SECONDS = 29

export interface WavChunk {
  /** Base64, no data: prefix. */
  data: string
  mimeType: "audio/wav"
}

export function splitSamples(
  samples: Float32Array,
  sampleRate: number,
  maxSeconds: number = STT_MAX_CHUNK_SECONDS
): Float32Array[] {
  const size = Math.floor(sampleRate * maxSeconds)
  const pieces: Float32Array[] = []
  for (let start = 0; start < samples.length; start += size) {
    pieces.push(samples.subarray(start, start + size))
  }
  return pieces
}

/** 16-bit PCM, mono, little-endian, with the standard 44-byte RIFF header. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return bytes
}

function toBase64(bytes: Uint8Array): string {
  // String.fromCharCode(...bytes) overflows the call stack past ~100k args.
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export async function toWavChunks(blob: Blob): Promise<WavChunk[]> {
  const context = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await context.decodeAudioData(await blob.arrayBuffer())
  } finally {
    void context.close()
  }
  // Rendering into a one-channel context downmixes and resamples in one pass.
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * STT_SAMPLE_RATE),
    STT_SAMPLE_RATE
  )
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()

  return splitSamples(rendered.getChannelData(0), STT_SAMPLE_RATE).map(
    (piece) => ({
      data: toBase64(encodeWav(piece, STT_SAMPLE_RATE)),
      mimeType: "audio/wav"
    })
  )
}
