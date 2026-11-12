import { describe, expect, it } from "vitest"
import {
  RingBuffer,
  SAMPLE_RATE,
  bytesToBase64,
  encodeWav,
  floatToInt16
} from "./pcm"

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))

describe("floatToInt16", () => {
  it("maps the full-scale range", () => {
    const out = floatToInt16(new Float32Array([0, 1, -1]))
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(0x7fff)
    expect(out[2]).toBe(-0x8000)
  })

  it("clamps past full scale rather than wrapping", () => {
    // Untruncated, 1.2 * 0x7fff wraps to a large negative — a click that the
    // VAD would read as speech.
    const out = floatToInt16(new Float32Array([1.2, -1.5]))
    expect(out[0]).toBe(0x7fff)
    expect(out[1]).toBe(-0x8000)
  })
})

describe("RingBuffer", () => {
  it("reads back what was written", () => {
    const ring = new RingBuffer(16)
    ring.push(Int16Array.from([1, 2, 3, 4]))
    expect(Array.from(ring.read(0, 4))).toEqual([1, 2, 3, 4])
    expect(ring.position).toBe(4)
  })

  it("rounds capacity up to a power of two", () => {
    expect(new RingBuffer(1000).capacity).toBe(1024)
    expect(new RingBuffer(1024).capacity).toBe(1024)
  })

  it("keeps absolute indices meaningful across a wrap", () => {
    const ring = new RingBuffer(4)
    ring.push(Int16Array.from([1, 2, 3, 4]))
    ring.push(Int16Array.from([5, 6]))
    expect(ring.position).toBe(6)
    // 0..2 has been overwritten; 2..6 is what survives.
    expect(Array.from(ring.read(2, 6))).toEqual([3, 4, 5, 6])
  })

  it("clamps a read that reaches further back than it holds", () => {
    const ring = new RingBuffer(4)
    ring.push(Int16Array.from([1, 2, 3, 4, 5, 6]))
    // Asking from 0 mid-interview must yield the surviving tail, not throw.
    expect(Array.from(ring.read(0, 6))).toEqual([3, 4, 5, 6])
  })

  it("returns empty for a range past the write head", () => {
    const ring = new RingBuffer(8)
    ring.push(Int16Array.from([1, 2]))
    expect(ring.read(5, 9).length).toBe(0)
    expect(ring.read(2, 2).length).toBe(0)
  })

  it("survives a push larger than capacity", () => {
    const ring = new RingBuffer(4)
    ring.push(Int16Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    expect(ring.position).toBe(10)
    expect(Array.from(ring.read(6, 10))).toEqual([7, 8, 9, 10])
  })
})

describe("encodeWav", () => {
  const samples = Int16Array.from([0, 1000, -1000, 32767])
  const wav = encodeWav(samples)

  it("writes a canonical RIFF/WAVE header", () => {
    expect(ascii(wav, 0, 4)).toBe("RIFF")
    expect(ascii(wav, 8, 4)).toBe("WAVE")
    expect(ascii(wav, 12, 4)).toBe("fmt ")
    expect(ascii(wav, 36, 4)).toBe("data")
  })

  it("declares mono 16-bit PCM at the capture rate", () => {
    const view = new DataView(wav.buffer)
    expect(view.getUint32(16, true)).toBe(16) // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // channels
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE)
    expect(view.getUint32(28, true)).toBe(SAMPLE_RATE * 2) // byte rate
    expect(view.getUint16(32, true)).toBe(2) // block align
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
  })

  it("sizes both length fields against the payload", () => {
    const view = new DataView(wav.buffer)
    expect(wav.length).toBe(44 + samples.length * 2)
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2)
    expect(view.getUint32(40, true)).toBe(samples.length * 2)
  })

  it("round-trips the samples little-endian", () => {
    const view = new DataView(wav.buffer)
    for (let i = 0; i < samples.length; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(samples[i])
    }
  })

  it("emits a header-only file for an empty clip", () => {
    expect(encodeWav(new Int16Array(0)).length).toBe(44)
  })
})

describe("bytesToBase64", () => {
  it("matches the platform encoder", () => {
    const bytes = Uint8Array.from([0, 1, 250, 128, 65, 66, 67])
    expect(bytesToBase64(bytes)).toBe(
      Buffer.from(bytes).toString("base64")
    )
  })

  it("handles a payload past the fromCharCode argument limit", () => {
    // A real clip is hundreds of KB; spreading that into fromCharCode at once
    // overflows the argument list, which is why the encoder chunks.
    const bytes = new Uint8Array(300_000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"))
  })
})
