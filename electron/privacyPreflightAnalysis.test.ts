import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import { afterEach, describe, expect, it } from "vitest"
import type { DisplayCaptureInfo } from "./teaching"
import {
  computeMarkerSamplePixelRects,
  computeMarkerWindowBounds,
  PRIVACY_PREFLIGHT_MARKER_COLORS,
  type Rect,
  type RgbColor
} from "./privacyPreflightMarker"
import {
  analyzeMarkerSamples,
  clampRectToImage,
  colorDistance,
  evaluateMarkerDetection,
  isMarkerColorMatch,
  sampleRegionStats
} from "./privacyPreflightAnalysis"

const BACKGROUND: RgbColor = { r: 40, g: 40, b: 40 }
const tempFiles: string[] = []

afterEach(async () => {
  await Promise.all(
    tempFiles.splice(0).map((file) => fs.promises.unlink(file).catch(() => {}))
  )
})

async function writeTestImage(
  width: number,
  height: number,
  paints: Array<{ rect: Rect; color: RgbColor }>
): Promise<string> {
  const filePath = path.join(os.tmpdir(), `privacy-preflight-test-${Date.now()}-${Math.random()}.png`)
  tempFiles.push(filePath)

  const overlays = await Promise.all(
    paints.map(async ({ rect, color }) => ({
      input: await sharp({
        create: {
          width: rect.width,
          height: rect.height,
          channels: 4,
          background: { ...color, alpha: 1 }
        }
      })
        .png()
        .toBuffer(),
      left: rect.x,
      top: rect.y
    }))
  )

  await sharp({
    create: { width, height, channels: 3, background: BACKGROUND }
  })
    .composite(overlays)
    .png()
    .toFile(filePath)

  return filePath
}

describe("colorDistance / isMarkerColorMatch", () => {
  it("is zero for identical colors and grows with channel difference", () => {
    expect(colorDistance({ r: 10, g: 10, b: 10 }, { r: 10, g: 10, b: 10 })).toBe(0)
    expect(colorDistance({ r: 0, g: 0, b: 0 }, { r: 3, g: 4, b: 0 })).toBe(5)
  })

  it("matches a solid sample close to the expected color, rejects noisy or dissimilar samples", () => {
    expect(
      isMarkerColorMatch({ r: 255, g: 59, b: 48, stdev: 0 }, PRIVACY_PREFLIGHT_MARKER_COLORS[0])
    ).toBe(true)
    expect(
      isMarkerColorMatch({ r: 40, g: 40, b: 40, stdev: 0 }, PRIVACY_PREFLIGHT_MARKER_COLORS[0])
    ).toBe(false)
    // High variance means "not a solid block" even if the mean color is close.
    expect(
      isMarkerColorMatch({ r: 255, g: 59, b: 48, stdev: 60 }, PRIVACY_PREFLIGHT_MARKER_COLORS[0])
    ).toBe(false)
  })
})

describe("clampRectToImage", () => {
  it("leaves in-bounds rects unchanged", () => {
    expect(clampRectToImage({ x: 10, y: 10, width: 20, height: 20 }, 100, 100)).toEqual({
      x: 10,
      y: 10,
      width: 20,
      height: 20
    })
  })

  it("clamps rects that would extend past the image", () => {
    expect(clampRectToImage({ x: 90, y: 90, width: 50, height: 50 }, 100, 100)).toEqual({
      x: 90,
      y: 90,
      width: 10,
      height: 10
    })
  })

  it("clamps negative origins into the image", () => {
    expect(clampRectToImage({ x: -5, y: -5, width: 20, height: 20 }, 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 20
    })
  })
})

describe("sampleRegionStats", () => {
  it("reads the true mean color of a solid region", async () => {
    const imagePath = await writeTestImage(100, 100, [
      { rect: { x: 20, y: 20, width: 40, height: 40 }, color: { r: 255, g: 59, b: 48 } }
    ])

    const stats = await sampleRegionStats(imagePath, { x: 20, y: 20, width: 40, height: 40 })

    expect(stats.r).toBeCloseTo(255, 0)
    expect(stats.g).toBeCloseTo(59, 0)
    expect(stats.b).toBeCloseTo(48, 0)
    expect(stats.stdev).toBeLessThan(1)
  })

  it("reports high variance for a region straddling two colors", async () => {
    const imagePath = await writeTestImage(100, 100, [
      { rect: { x: 0, y: 0, width: 50, height: 100 }, color: { r: 255, g: 0, b: 0 } },
      { rect: { x: 50, y: 0, width: 50, height: 100 }, color: { r: 0, g: 0, b: 255 } }
    ])

    const stats = await sampleRegionStats(imagePath, { x: 25, y: 0, width: 50, height: 100 })

    expect(stats.stdev).toBeGreaterThan(20)
  })
})

describe("end-to-end marker detection via real screenshots", () => {
  function makeCapture(overrides: Partial<DisplayCaptureInfo> = {}): DisplayCaptureInfo {
    return {
      bounds: { x: 0, y: 0, width: 400, height: 400 },
      scaleFactor: 1,
      screenshotWidth: 400,
      screenshotHeight: 400,
      ...overrides
    }
  }

  it("fails (marker present) when all four samples show the marker colors", async () => {
    const capture = makeCapture()
    const windowBounds = computeMarkerWindowBounds(capture.bounds)
    const pixelRects = computeMarkerSamplePixelRects(windowBounds, capture)

    const imagePath = await writeTestImage(
      capture.screenshotWidth,
      capture.screenshotHeight,
      pixelRects.map((rect, index) => ({ rect, color: PRIVACY_PREFLIGHT_MARKER_COLORS[index] }))
    )

    const matches = await analyzeMarkerSamples(imagePath, pixelRects, PRIVACY_PREFLIGHT_MARKER_COLORS)

    expect(matches).toEqual([true, true, true, true])
    expect(evaluateMarkerDetection(matches)).toBe(true)
  })

  it("passes (marker absent) when the capture only shows background", async () => {
    const capture = makeCapture()
    const windowBounds = computeMarkerWindowBounds(capture.bounds)
    const pixelRects = computeMarkerSamplePixelRects(windowBounds, capture)

    const imagePath = await writeTestImage(capture.screenshotWidth, capture.screenshotHeight, [])

    const matches = await analyzeMarkerSamples(imagePath, pixelRects, PRIVACY_PREFLIGHT_MARKER_COLORS)

    expect(matches).toEqual([false, false, false, false])
    expect(evaluateMarkerDetection(matches)).toBe(false)
  })

  it("does not report a leak from a single incidental color match (avoids false positives)", async () => {
    const capture = makeCapture()
    const windowBounds = computeMarkerWindowBounds(capture.bounds)
    const pixelRects = computeMarkerSamplePixelRects(windowBounds, capture)

    const imagePath = await writeTestImage(capture.screenshotWidth, capture.screenshotHeight, [
      { rect: pixelRects[0], color: PRIVACY_PREFLIGHT_MARKER_COLORS[0] }
    ])

    const matches = await analyzeMarkerSamples(imagePath, pixelRects, PRIVACY_PREFLIGHT_MARKER_COLORS)

    expect(matches).toEqual([true, false, false, false])
    expect(evaluateMarkerDetection(matches)).toBe(false)
  })

  it("still detects a leak when a majority (3 of 4) samples match", async () => {
    const capture = makeCapture()
    const windowBounds = computeMarkerWindowBounds(capture.bounds)
    const pixelRects = computeMarkerSamplePixelRects(windowBounds, capture)

    const imagePath = await writeTestImage(
      capture.screenshotWidth,
      capture.screenshotHeight,
      pixelRects
        .slice(0, 3)
        .map((rect, index) => ({ rect, color: PRIVACY_PREFLIGHT_MARKER_COLORS[index] }))
    )

    const matches = await analyzeMarkerSamples(imagePath, pixelRects, PRIVACY_PREFLIGHT_MARKER_COLORS)

    expect(evaluateMarkerDetection(matches)).toBe(true)
  })

  it("correctly detects a leak on a scaled, offset secondary display", async () => {
    const capture = makeCapture({
      bounds: { x: 1920, y: 0, width: 300, height: 300 },
      scaleFactor: 2,
      screenshotWidth: 600,
      screenshotHeight: 600
    })
    const windowBounds = computeMarkerWindowBounds(capture.bounds)
    const pixelRects = computeMarkerSamplePixelRects(windowBounds, capture)

    const imagePath = await writeTestImage(
      capture.screenshotWidth,
      capture.screenshotHeight,
      pixelRects.map((rect, index) => ({ rect, color: PRIVACY_PREFLIGHT_MARKER_COLORS[index] }))
    )

    const matches = await analyzeMarkerSamples(imagePath, pixelRects, PRIVACY_PREFLIGHT_MARKER_COLORS)

    expect(matches).toEqual([true, true, true, true])
    expect(evaluateMarkerDetection(matches)).toBe(true)
  })
})
