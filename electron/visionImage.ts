// visionImage.ts
//
// Sizing rules for the screenshot we hand to a vision model. Pure arithmetic —
// no sharp, no Electron — so the awkward cases (very tall screens, tiny inputs,
// a budget smaller than one grid cell) are cheap to pin down in tests.
//
// Why this exists: Qwen-family servers run their own `smart_resize` on whatever
// image you send, rounding each side to a multiple of 28 within a pixel budget
// before the vision tower sees it. The model then answers with absolute pixel
// coordinates — but *in which frame*, the original or the resized one, varies
// by model version and serving stack. On a retina capture that ambiguity is a
// ~2x coordinate error, which lands a click nowhere near the target.
//
// Resizing to a grid-aligned size ourselves before sending removes the question
// entirely: original and resized are then the same image, so both readings
// agree. It also cuts several megabytes off every step of a run.

export interface ImageSize {
  width: number
  height: number
}

export interface VisionGridOptions {
  /** Side length the model's patch grid works in. 28 for the Qwen family. */
  factor?: number
  /** Upper bound on total pixels; the image is scaled down to fit. */
  maxPixels?: number
  /** Lower bound, so a small window doesn't collapse to nothing. */
  minPixels?: number
}

const DEFAULT_FACTOR = 28
const DEFAULT_MAX_PIXELS = 1_500_000
const DEFAULT_MIN_PIXELS = 4 * DEFAULT_FACTOR * DEFAULT_FACTOR

/** Round to the nearest multiple of `factor`, never below one whole cell. */
function roundToFactor(value: number, factor: number): number {
  return Math.max(factor, Math.round(value / factor) * factor)
}

export function readVisionMaxPixels(
  raw: string | undefined = process.env.QWEN_VISION_MAX_PIXELS
): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PIXELS
}

/**
 * The grid-aligned size to resize an image to before sending it to the model.
 * Preserves aspect ratio as closely as the grid allows, and keeps the result
 * inside [minPixels, maxPixels].
 */
export function fitToVisionGrid(
  size: ImageSize,
  options: VisionGridOptions = {}
): ImageSize {
  const factor = options.factor ?? DEFAULT_FACTOR
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS
  const minPixels = options.minPixels ?? DEFAULT_MIN_PIXELS

  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new Error("Image dimensions must be positive numbers")
  }

  let width = size.width
  let height = size.height

  // Scale on the real dimensions first; rounding to the grid afterwards keeps
  // the aspect error under half a cell instead of compounding it.
  const pixels = width * height
  if (pixels > maxPixels) {
    const scale = Math.sqrt(maxPixels / pixels)
    width *= scale
    height *= scale
  } else if (pixels < minPixels) {
    const scale = Math.sqrt(minPixels / pixels)
    width *= scale
    height *= scale
  }

  let gridWidth = roundToFactor(width, factor)
  let gridHeight = roundToFactor(height, factor)

  // Rounding up can push us back over budget; step the longer side down one
  // cell at a time until it fits. Bounded by construction — each pass removes
  // at least `factor` pixels from one side.
  while (
    gridWidth * gridHeight > maxPixels &&
    (gridWidth > factor || gridHeight > factor)
  ) {
    if (gridWidth >= gridHeight && gridWidth > factor) {
      gridWidth -= factor
    } else if (gridHeight > factor) {
      gridHeight -= factor
    } else {
      break
    }
  }

  return { width: gridWidth, height: gridHeight }
}

/**
 * Whether a target's centre lands inside the image the model was shown.
 *
 * Worth checking explicitly because the downstream geometry clamps out-of-range
 * coordinates to the screen edge (see `screenshotTargetToDipRect`), which turns
 * a grounding failure into a confident click in a corner. Failing here instead
 * costs one retry of the step.
 */
export function isTargetWithinImage(
  target: { x: number; y: number; width?: number; height?: number },
  size: ImageSize,
  tolerance = 0.02
): boolean {
  const centerX = target.x + (target.width ?? 0) / 2
  const centerY = target.y + (target.height ?? 0) / 2
  const marginX = size.width * tolerance
  const marginY = size.height * tolerance

  return (
    centerX >= -marginX &&
    centerY >= -marginY &&
    centerX <= size.width + marginX &&
    centerY <= size.height + marginY
  )
}
