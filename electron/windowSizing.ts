export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Chrome allowance the renderer's scrollWidth doesn't account for. */
const WIDTH_PAD = 32

/**
 * An overlay that grows to whatever the model wrote stops being an overlay.
 * 60% of the work area is tall enough for a full solution with code and short
 * enough to leave the app behind it usable; past that the transcript scrolls.
 */
export const MAX_HEIGHT_FRACTION = 0.6

export function computeWindowBounds(input: {
  content: { width: number; height: number }
  current: { x: number; y: number }
  workArea: Rect
  widthFraction: number
}): { width: number; height: number; x: number; y: number; maxHeight: number } {
  const { content, current, workArea, widthFraction } = input

  const maxWidth = Math.floor(workArea.width * widthFraction)
  const maxHeight = Math.floor(workArea.height * MAX_HEIGHT_FRACTION)

  const width = Math.min(Math.ceil(content.width) + WIDTH_PAD, maxWidth)
  const height = Math.min(Math.ceil(content.height), maxHeight)

  // Clamp both axes back inside the work area. Y was never clamped before, so a
  // window near the bottom would grow straight off the screen as an answer came
  // in — with no titlebar to drag it back by.
  const x = clamp(current.x, workArea.x, workArea.x + workArea.width - width)
  const y = clamp(current.y, workArea.y, workArea.y + workArea.height - height)

  return { width, height, x, y, maxHeight }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
