import sharp from "sharp"
import type { Rect, RgbColor } from "./privacyPreflightMarker"

export interface RegionColorStats {
  r: number
  g: number
  b: number
  /** Highest per-channel standard deviation across the sampled region. */
  stdev: number
}

/** Euclidean RGB distance tolerance for treating a sample as "the marker color". */
const COLOR_DISTANCE_TOLERANCE = 30
/** Above this, the region isn't a solid block (real desktop content, edge bleed, etc.). */
const STDEV_THRESHOLD = 20

export function clampRectToImage(rect: Rect, imageWidth: number, imageHeight: number): Rect {
  const x = Math.min(Math.max(rect.x, 0), Math.max(imageWidth - 1, 0))
  const y = Math.min(Math.max(rect.y, 0), Math.max(imageHeight - 1, 0))
  const width = Math.max(1, Math.min(rect.width, imageWidth - x))
  const height = Math.max(1, Math.min(rect.height, imageHeight - y))
  return { x, y, width, height }
}

export function colorDistance(a: RgbColor, b: RgbColor): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

export function isMarkerColorMatch(stats: RegionColorStats, expected: RgbColor): boolean {
  return (
    colorDistance(stats, expected) <= COLOR_DISTANCE_TOLERANCE &&
    stats.stdev <= STDEV_THRESHOLD
  )
}

/**
 * Reads the mean RGB color and max channel standard deviation of a region.
 * Computed manually from raw pixels rather than sharp's `.stats()`, which
 * (as of sharp 0.33) does not reliably apply a preceding `.extract()`.
 */
export async function sampleRegionStats(
  imagePath: string,
  rect: Rect
): Promise<RegionColorStats> {
  const metadata = await sharp(imagePath).metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error("Captured screenshot has no usable dimensions")
  }

  const clamped = clampRectToImage(rect, metadata.width, metadata.height)
  const { data, info } = await sharp(imagePath)
    .extract({
      left: clamped.x,
      top: clamped.y,
      width: clamped.width,
      height: clamped.height
    })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixelCount = info.width * info.height
  let sumR = 0
  let sumG = 0
  let sumB = 0
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * info.channels
    sumR += data[offset]
    sumG += data[offset + 1]
    sumB += data[offset + 2]
  }
  const meanR = sumR / pixelCount
  const meanG = sumG / pixelCount
  const meanB = sumB / pixelCount

  let varianceR = 0
  let varianceG = 0
  let varianceB = 0
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * info.channels
    varianceR += (data[offset] - meanR) ** 2
    varianceG += (data[offset + 1] - meanG) ** 2
    varianceB += (data[offset + 2] - meanB) ** 2
  }
  const stdev = Math.sqrt(Math.max(varianceR, varianceG, varianceB) / pixelCount)

  return { r: meanR, g: meanG, b: meanB, stdev }
}

export async function analyzeMarkerSamples(
  imagePath: string,
  rects: readonly Rect[],
  expectedColors: readonly RgbColor[]
): Promise<boolean[]> {
  const matches: boolean[] = []
  for (let i = 0; i < rects.length; i += 1) {
    const stats = await sampleRegionStats(imagePath, rects[i])
    matches.push(isMarkerColorMatch(stats, expectedColors[i]))
  }
  return matches
}

/**
 * Requires a strict majority of independent samples to agree before calling
 * it a leak, so a single incidental color match against real desktop
 * content can't produce a false "fail".
 */
export function evaluateMarkerDetection(matches: readonly boolean[]): boolean {
  if (matches.length === 0) {
    return false
  }
  const matchCount = matches.filter(Boolean).length
  return matchCount > matches.length / 2
}
