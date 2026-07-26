import { describe, expect, it } from "vitest"
import type { DisplayCaptureInfo } from "./teaching"
import {
  buildPrivacyPreflightMarkerHtml,
  computeMarkerSamplePixelRects,
  computeMarkerWindowBounds,
  PRIVACY_PREFLIGHT_MARKER_COLORS,
  PRIVACY_PREFLIGHT_MARKER_SIZE
} from "./privacyPreflightMarker"

describe("computeMarkerWindowBounds", () => {
  it("offsets the marker window into the active display's bounds", () => {
    const bounds = computeMarkerWindowBounds({ x: 0, y: 0, width: 1440, height: 900 })
    expect(bounds.width).toBe(PRIVACY_PREFLIGHT_MARKER_SIZE)
    expect(bounds.height).toBe(PRIVACY_PREFLIGHT_MARKER_SIZE)
    expect(bounds.x).toBeGreaterThan(0)
    expect(bounds.y).toBeGreaterThan(0)
  })

  it("keeps the display origin offset for non-primary displays", () => {
    const bounds = computeMarkerWindowBounds({ x: 1920, y: -50, width: 1280, height: 800 })
    expect(bounds.x).toBe(1920 + bounds.x - 1920)
    expect(bounds.x).toBeGreaterThanOrEqual(1920)
    expect(bounds.y).toBeGreaterThanOrEqual(-50)
  })
})

describe("computeMarkerSamplePixelRects", () => {
  it("maps 1:1 for an unscaled primary display at the origin", () => {
    const displayBounds = { x: 0, y: 0, width: 1440, height: 900 }
    const windowBounds = computeMarkerWindowBounds(displayBounds)
    const capture: DisplayCaptureInfo = {
      bounds: displayBounds,
      scaleFactor: 1,
      screenshotWidth: 1440,
      screenshotHeight: 900
    }

    const rects = computeMarkerSamplePixelRects(windowBounds, capture)

    expect(rects).toHaveLength(4)
    for (const rect of rects) {
      // Local sample rects sit within the 160x160 window at a fixed inset;
      // at 1:1 scale, global DIP == pixel, so the window should fully
      // contain every sample rect.
      expect(rect.x).toBeGreaterThanOrEqual(windowBounds.x)
      expect(rect.y).toBeGreaterThanOrEqual(windowBounds.y)
      expect(rect.x + rect.width).toBeLessThanOrEqual(windowBounds.x + windowBounds.width)
      expect(rect.y + rect.height).toBeLessThanOrEqual(windowBounds.y + windowBounds.height)
    }
    // Four distinct quadrant corners, not overlapping.
    const uniqueOrigins = new Set(rects.map((r) => `${r.x},${r.y}`))
    expect(uniqueOrigins.size).toBe(4)
  })

  it("scales and offsets correctly for a Retina secondary display", () => {
    const displayBounds = { x: 1920, y: 0, width: 1280, height: 800 }
    const windowBounds = computeMarkerWindowBounds(displayBounds)
    const capture: DisplayCaptureInfo = {
      bounds: displayBounds,
      scaleFactor: 2,
      screenshotWidth: 2560,
      screenshotHeight: 1600
    }

    const rects = computeMarkerSamplePixelRects(windowBounds, capture)

    expect(rects).toEqual([
      { x: 120, y: 200, width: 80, height: 80 },
      { x: 280, y: 200, width: 80, height: 80 },
      { x: 120, y: 360, width: 80, height: 80 },
      { x: 280, y: 360, width: 80, height: 80 }
    ])
  })

  it("handles a display whose captured PNG has non-integer-scale dimensions", () => {
    const displayBounds = { x: 0, y: 0, width: 1000, height: 1000 }
    const windowBounds = computeMarkerWindowBounds(displayBounds)
    const capture: DisplayCaptureInfo = {
      bounds: displayBounds,
      scaleFactor: 1.5,
      screenshotWidth: 1500,
      screenshotHeight: 1500
    }

    const rects = computeMarkerSamplePixelRects(windowBounds, capture)

    for (const rect of rects) {
      expect(Number.isInteger(rect.x)).toBe(true)
      expect(Number.isInteger(rect.y)).toBe(true)
      expect(Number.isInteger(rect.width)).toBe(true)
      expect(Number.isInteger(rect.height)).toBe(true)
      expect(rect.width).toBeGreaterThan(0)
      expect(rect.height).toBeGreaterThan(0)
    }
  })
})

describe("buildPrivacyPreflightMarkerHtml", () => {
  it("renders all four distinct marker colors", () => {
    const html = buildPrivacyPreflightMarkerHtml()
    for (const color of PRIVACY_PREFLIGHT_MARKER_COLORS) {
      expect(html).toContain(`rgb(${color.r}, ${color.g}, ${color.b})`)
    }
  })

  it("is a self-contained HTML document with no external resources", () => {
    const html = buildPrivacyPreflightMarkerHtml()
    expect(html).toMatch(/<html/i)
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toMatch(/<script/i)
  })
})
