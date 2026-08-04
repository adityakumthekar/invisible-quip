// Raw PCM plumbing for Live Listen.
//
// The capture path deliberately does not use MediaRecorder. With a timeslice,
// only the first chunk carries the WebM header and Tracks; every later chunk is
// a bare cluster whose timecodes are absolute from the start of the stream. A
// slice taken twenty minutes into a session is either undecodable on its own or
// claims to be a twenty-minute file — which is what the provider would bill for.
// Raw samples have no framing to lose, so the boundaries the VAD finds are
// exactly the boundaries that get sent.

/**
 * The capture AudioContext is opened at this rate and Chromium resamples the
 * 48 kHz device into it, which is why nothing here downsamples by hand — a
 * naive decimator would alias, and a proper one is a filter nobody needs to
 * own. Speech is well served by 16 kHz, and it is a fifth of the bytes.
 */
export const SAMPLE_RATE = 16000

export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    // Clamp before scaling. A sample a hair past 1.0 would wrap to a large
    // negative on truncation, which sounds like a click and measures as speech.
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/**
 * Fixed-capacity sample history, so an utterance can be cut after the fact.
 *
 * Pre-roll is the whole reason this exists. The VAD needs several frames above
 * threshold before it will call something speech, so by the time onset is
 * declared the first syllable has already gone past. Reading backwards from the
 * ring recovers it; without this, every question would lose its first word.
 *
 * Capacity rounds up to a power of two so the wrap is a mask rather than a
 * modulo on the hot path.
 */
export class RingBuffer {
  private readonly buf: Int16Array
  private readonly mask: number
  private writeCount = 0

  constructor(minCapacity: number) {
    let capacity = 1
    while (capacity < minCapacity) capacity *= 2
    this.buf = new Int16Array(capacity)
    this.mask = capacity - 1
  }

  get capacity(): number {
    return this.buf.length
  }

  /**
   * Absolute index one past the newest sample. Utterance bounds are expressed
   * in these rather than in ring offsets, so a boundary stays meaningful after
   * the data behind it has been overwritten.
   */
  get position(): number {
    return this.writeCount
  }

  push(samples: Int16Array): void {
    for (let i = 0; i < samples.length; i++) {
      this.buf[(this.writeCount + i) & this.mask] = samples[i]
    }
    this.writeCount += samples.length
  }

  /**
   * Samples in [from, to) by absolute index. Anything already overwritten is
   * gone, so the range is clamped rather than throwing: a caller reaching
   * further back than the ring holds wants whatever survived, not an exception
   * in the middle of a live interview.
   */
  read(from: number, to: number): Int16Array {
    const end = Math.min(to, this.writeCount)
    const start = Math.max(from, 0, end - this.capacity)
    if (end <= start) return new Int16Array(0)
    const out = new Int16Array(end - start)
    for (let i = 0; i < out.length; i++) {
      out[i] = this.buf[(start + i) & this.mask]
    }
    return out
  }
}

/**
 * Canonical 44-byte RIFF header plus signed 16-bit little-endian PCM.
 *
 * Uncompressed costs nothing worth having here: one question at 16 kHz mono is
 * 32 KB/s, so a fifteen-second question is under half a megabyte. Opus would
 * save bytes we are not short of, in exchange for a muxer and an encoder hop
 * between the interviewer finishing and the answer starting.
 */
export function encodeWav(
  samples: Int16Array,
  sampleRate: number = SAMPLE_RATE
): Uint8Array {
  const dataBytes = samples.length * 2
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }

  ascii(0, "RIFF")
  view.setUint32(4, 36 + dataBytes, true) // everything after this field
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true) // fmt chunk size for PCM
  view.setUint16(20, 1, true) // format 1 = PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate = rate * channels * 2
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, "data")
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, samples[i], true)
  }
  return bytes
}

/**
 * Base64 without FileReader. The clip path can afford the async reader hop
 * because a human is waiting on a button; here the settle timer is already
 * running and the encode is on the critical path to the first token.
 *
 * Chunked because String.fromCharCode(...bytes) overflows the argument limit
 * somewhere around 100 KB, and a clip is measured in hundreds of them.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
