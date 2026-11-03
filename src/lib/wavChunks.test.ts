import { describe, expect, it } from "vitest"
import { encodeWav, splitSamples, STT_SAMPLE_RATE } from "./wavChunks"

describe("splitSamples", () => {
  it("cuts at 29 s so every piece fits Sarvam's 30 s cap", () => {
    const seconds = 70
    const pieces = splitSamples(new Float32Array(STT_SAMPLE_RATE * seconds), STT_SAMPLE_RATE)
    expect(pieces.map((p) => p.length / STT_SAMPLE_RATE)).toEqual([29, 29, 12])
  })

  it("leaves a short clip whole", () => {
    expect(splitSamples(new Float32Array(16000 * 5), 16000)).toHaveLength(1)
  })
})

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM RIFF header and clamps samples", () => {
    const bytes = encodeWav(new Float32Array([0, 1, -1, 2]), 16000)
    const view = new DataView(bytes.buffer)
    const ascii = (o: number, n: number) =>
      String.fromCharCode(...bytes.subarray(o, o + n))

    expect(ascii(0, 4)).toBe("RIFF")
    expect(ascii(8, 4)).toBe("WAVE")
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(8)
    expect(bytes.length).toBe(44 + 8)
    expect(view.getInt16(46, true)).toBe(0x7fff)
    expect(view.getInt16(48, true)).toBe(-0x8000)
    expect(view.getInt16(50, true)).toBe(0x7fff) // 2 clamped to 1
  })
})
