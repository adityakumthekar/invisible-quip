import { describe, expect, it } from "vitest"
import {
  fitToVisionGrid,
  isTargetWithinImage,
  readVisionMaxPixels
} from "./visionImage"

const FACTOR = 28

describe("fitToVisionGrid", () => {
  it("returns grid-aligned dimensions", () => {
    for (const size of [
      { width: 3024, height: 1964 },
      { width: 1440, height: 900 },
      { width: 2560, height: 1440 },
      { width: 1080, height: 1920 }
    ]) {
      const fitted = fitToVisionGrid(size)
      expect(fitted.width % FACTOR).toBe(0)
      expect(fitted.height % FACTOR).toBe(0)
    }
  })

  it("stays inside the pixel budget", () => {
    const maxPixels = 1_000_000
    for (const size of [
      { width: 3024, height: 1964 },
      { width: 5120, height: 2880 },
      { width: 800, height: 6000 }
    ]) {
      const fitted = fitToVisionGrid(size, { maxPixels })
      expect(fitted.width * fitted.height).toBeLessThanOrEqual(maxPixels)
    }
  })

  it("preserves aspect ratio to within a grid cell", () => {
    const size = { width: 3024, height: 1964 }
    const fitted = fitToVisionGrid(size)
    const sourceAspect = size.width / size.height
    const fittedAspect = fitted.width / fitted.height
    expect(Math.abs(fittedAspect - sourceAspect) / sourceAspect).toBeLessThan(
      0.02
    )
  })

  it("leaves an already-small image roughly alone", () => {
    const fitted = fitToVisionGrid({ width: 1400, height: 896 })
    expect(fitted).toEqual({ width: 1400, height: 896 })
  })

  it("scales a tiny image up to the minimum", () => {
    const fitted = fitToVisionGrid({ width: 20, height: 12 })
    expect(fitted.width).toBeGreaterThanOrEqual(FACTOR)
    expect(fitted.height).toBeGreaterThanOrEqual(FACTOR)
    expect(fitted.width * fitted.height).toBeGreaterThanOrEqual(
      2 * FACTOR * FACTOR
    )
  })

  it("never returns a side below one whole cell", () => {
    const fitted = fitToVisionGrid(
      { width: 4000, height: 4 },
      { maxPixels: 4 * FACTOR * FACTOR }
    )
    expect(fitted.width).toBeGreaterThanOrEqual(FACTOR)
    expect(fitted.height).toBeGreaterThanOrEqual(FACTOR)
  })

  it("rejects degenerate input", () => {
    for (const size of [
      { width: 0, height: 100 },
      { width: 100, height: -1 },
      { width: Number.NaN, height: 100 }
    ]) {
      expect(() => fitToVisionGrid(size)).toThrow(/positive/i)
    }
  })
})

describe("readVisionMaxPixels", () => {
  it("takes a positive override and ignores anything else", () => {
    expect(readVisionMaxPixels("500000")).toBe(500_000)
    expect(readVisionMaxPixels("0")).toBe(1_500_000)
    expect(readVisionMaxPixels("nope")).toBe(1_500_000)
    expect(readVisionMaxPixels(undefined)).toBe(1_500_000)
  })
})

describe("isTargetWithinImage", () => {
  const size = { width: 1400, height: 896 }

  it("accepts a target centred inside the image", () => {
    expect(
      isTargetWithinImage({ x: 700, y: 420, width: 80, height: 32 }, size)
    ).toBe(true)
    expect(isTargetWithinImage({ x: 0, y: 0 }, size)).toBe(true)
  })

  it("rejects a target centred outside it", () => {
    // The classic failure: coordinates in the original retina frame, applied
    // to the resized one.
    expect(
      isTargetWithinImage({ x: 2800, y: 1700, width: 80, height: 32 }, size)
    ).toBe(false)
    expect(isTargetWithinImage({ x: -400, y: 100 }, size)).toBe(false)
  })

  it("tolerates a target just past the edge", () => {
    expect(isTargetWithinImage({ x: 1410, y: 400 }, size)).toBe(true)
  })
})
