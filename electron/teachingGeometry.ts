// teachingGeometry.ts
//
// Coordinate plumbing between three spaces: the model's normalized 0–1000 box
// space, screenshot pixels, and global DIP coordinates (what Electron's screen
// API and nut-js both speak). Split out of teaching.ts; re-exported from there.

import type { TeachingTarget } from "./teachingContract"

/** Electron display metadata for a captured screenshot. */
export interface DisplayCaptureInfo {
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  scaleFactor: number
  screenshotWidth: number
  screenshotHeight: number
}

export interface TeachingDisplayCaptureInfo extends DisplayCaptureInfo {
  displayId: number
}

export interface TeachingCapture {
  path: string
  display: TeachingDisplayCaptureInfo
}

export interface TeachingDisplaySource {
  id: number
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  scaleFactor: number
}

export interface ImageDimensions {
  width?: number
  height?: number
}

export interface DipPoint {
  x: number
  y: number
}

export interface DipRect {
  x: number
  y: number
  width: number
  height: number
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function screenshotPixelToDip(
  pixel: DipPoint,
  capture: DisplayCaptureInfo
): DipPoint {
  const { bounds, screenshotWidth, screenshotHeight } = capture

  const clampedX = clamp(pixel.x, 0, screenshotWidth)
  const clampedY = clamp(pixel.y, 0, screenshotHeight)

  const dipX = bounds.x + (clampedX * bounds.width) / screenshotWidth
  const dipY = bounds.y + (clampedY * bounds.height) / screenshotHeight

  return {
    x: clamp(dipX, bounds.x, bounds.x + bounds.width),
    y: clamp(dipY, bounds.y, bounds.y + bounds.height)
  }
}

/**
 * Convert Gemini's trained 0–1000 box space into screenshot pixels.
 * (0,0) is top-left; (1000,1000) is bottom-right of the image.
 */
export function normalizedTeachingTargetToPixels(
  target: TeachingTarget,
  screenshotWidth: number,
  screenshotHeight: number
): TeachingTarget {
  const toPixel = (value: number, size: number) => (value / 1000) * size

  const converted: TeachingTarget = {
    x: toPixel(target.x, screenshotWidth),
    y: toPixel(target.y, screenshotHeight)
  }
  if (target.width !== undefined) {
    converted.width = toPixel(target.width, screenshotWidth)
  }
  if (target.height !== undefined) {
    converted.height = toPixel(target.height, screenshotHeight)
  }
  return converted
}

/**
 * Inverse of `normalizedTeachingTargetToPixels`. Local vision models (Qwen2.5-VL
 * and friends) emit absolute pixel coordinates rather than Gemini's 0–1000 box
 * space, so their output is folded back into the canonical space at the model
 * boundary — everything downstream then speaks one coordinate system.
 */
export function pixelTeachingTargetToNormalized(
  target: TeachingTarget,
  screenshotWidth: number,
  screenshotHeight: number
): TeachingTarget {
  if (screenshotWidth <= 0 || screenshotHeight <= 0) {
    throw new Error("Screenshot dimensions must be positive")
  }

  const toNormalized = (value: number, size: number) => (value / size) * 1000

  const converted: TeachingTarget = {
    x: toNormalized(target.x, screenshotWidth),
    y: toNormalized(target.y, screenshotHeight)
  }
  if (target.width !== undefined) {
    converted.width = toNormalized(target.width, screenshotWidth)
  }
  if (target.height !== undefined) {
    converted.height = toNormalized(target.height, screenshotHeight)
  }
  return converted
}

export function screenshotTargetToDipRect(
  target: TeachingTarget,
  capture: DisplayCaptureInfo
): DipRect {
  const { bounds, screenshotWidth, screenshotHeight } = capture
  const origin = screenshotPixelToDip({ x: target.x, y: target.y }, capture)

  const maxX = bounds.x + bounds.width
  const maxY = bounds.y + bounds.height

  const width = clamp(
    ((target.width ?? 0) * bounds.width) / screenshotWidth,
    0,
    maxX - origin.x
  )
  const height = clamp(
    ((target.height ?? 0) * bounds.height) / screenshotHeight,
    0,
    maxY - origin.y
  )

  return {
    x: origin.x,
    y: origin.y,
    width,
    height
  }
}

/**
 * Run a model-space target through both conversions in one go: 0–1000 →
 * screenshot pixels → global DIP rect.
 */
export function normalizedTargetToDipRect(
  target: TeachingTarget,
  capture: DisplayCaptureInfo
): DipRect {
  return screenshotTargetToDipRect(
    normalizedTeachingTargetToPixels(
      target,
      capture.screenshotWidth,
      capture.screenshotHeight
    ),
    capture
  )
}

/** Center of a DIP rect in the same (global) coordinate space as the rect. */
export function dipRectCenter(rect: DipRect): DipPoint {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  }
}

export function createTeachingDisplayCaptureInfo(
  display: TeachingDisplaySource,
  image: ImageDimensions
): TeachingDisplayCaptureInfo {
  if (
    typeof image.width !== "number" ||
    !Number.isFinite(image.width) ||
    image.width <= 0 ||
    typeof image.height !== "number" ||
    !Number.isFinite(image.height) ||
    image.height <= 0
  ) {
    throw new Error("Captured PNG dimensions are unavailable")
  }

  return {
    displayId: display.id,
    bounds: { ...display.bounds },
    scaleFactor: display.scaleFactor,
    screenshotWidth: image.width,
    screenshotHeight: image.height
  }
}
