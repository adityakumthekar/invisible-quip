import type { DisplayCaptureInfo } from "./teaching"

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface RgbColor {
  r: number
  g: number
  b: number
}

/** Small window so the test marker stays unobtrusive if it ever leaks through. */
export const PRIVACY_PREFLIGHT_MARKER_SIZE = 160
export const PRIVACY_PREFLIGHT_MARKER_OFFSET_X = 40
export const PRIVACY_PREFLIGHT_MARKER_OFFSET_Y = 80
const QUADRANT_SIZE = PRIVACY_PREFLIGHT_MARKER_SIZE / 2
/** Inset from each quadrant's edge so samples avoid anti-aliased seams. */
const SAMPLE_MARGIN = 20
const SAMPLE_SIZE = QUADRANT_SIZE - SAMPLE_MARGIN * 2

/**
 * Four highly saturated, mutually distinct colors. Requiring a majority of
 * these four independent samples to match (see privacyPreflightAnalysis.ts)
 * makes an accidental false positive against arbitrary desktop content
 * astronomically unlikely.
 */
export const PRIVACY_PREFLIGHT_MARKER_COLORS: readonly [
  RgbColor,
  RgbColor,
  RgbColor,
  RgbColor
] = [
  { r: 255, g: 59, b: 48 }, // top-left
  { r: 52, g: 199, b: 89 }, // top-right
  { r: 10, g: 132, b: 255 }, // bottom-left
  { r: 255, g: 214, b: 10 } // bottom-right
]

const QUADRANT_ORIGINS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: QUADRANT_SIZE, y: 0 },
  { x: 0, y: QUADRANT_SIZE },
  { x: QUADRANT_SIZE, y: QUADRANT_SIZE }
]

export function computeMarkerWindowBounds(displayBounds: Rect): Rect {
  return {
    x: Math.round(displayBounds.x + PRIVACY_PREFLIGHT_MARKER_OFFSET_X),
    y: Math.round(displayBounds.y + PRIVACY_PREFLIGHT_MARKER_OFFSET_Y),
    width: PRIVACY_PREFLIGHT_MARKER_SIZE,
    height: PRIVACY_PREFLIGHT_MARKER_SIZE
  }
}

function computeMarkerSampleRectsLocal(): Rect[] {
  return QUADRANT_ORIGINS.map((origin) => ({
    x: origin.x + SAMPLE_MARGIN,
    y: origin.y + SAMPLE_MARGIN,
    width: SAMPLE_SIZE,
    height: SAMPLE_SIZE
  }))
}

function dipRectToPixelRect(rect: Rect, capture: DisplayCaptureInfo): Rect {
  const { bounds, screenshotWidth, screenshotHeight } = capture
  const scaleX = screenshotWidth / bounds.width
  const scaleY = screenshotHeight / bounds.height

  return {
    x: Math.round((rect.x - bounds.x) * scaleX),
    y: Math.round((rect.y - bounds.y) * scaleY),
    width: Math.round(rect.width * scaleX),
    height: Math.round(rect.height * scaleY)
  }
}

/**
 * Converts the marker window's DIP-space sample regions into pixel-space
 * regions within the captured screenshot, accounting for the active
 * display's scale factor and origin offset (multi-monitor aware).
 */
export function computeMarkerSamplePixelRects(
  windowBounds: Rect,
  capture: DisplayCaptureInfo
): Rect[] {
  return computeMarkerSampleRectsLocal()
    .map((rect) => ({
      x: rect.x + windowBounds.x,
      y: rect.y + windowBounds.y,
      width: rect.width,
      height: rect.height
    }))
    .map((rect) => dipRectToPixelRect(rect, capture))
}

export function buildPrivacyPreflightMarkerHtml(
  colors: readonly RgbColor[] = PRIVACY_PREFLIGHT_MARKER_COLORS
): string {
  const quadrants = QUADRANT_ORIGINS.map((origin, index) => {
    const color = colors[index]
    return `<div style="position:absolute;left:${origin.x}px;top:${origin.y}px;width:${QUADRANT_SIZE}px;height:${QUADRANT_SIZE}px;background:rgb(${color.r}, ${color.g}, ${color.b});"></div>`
  }).join("")

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:transparent;">${quadrants}</body></html>`
}
