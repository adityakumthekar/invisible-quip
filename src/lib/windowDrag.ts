/**
 * Renderer-side bookkeeping for the manual grip drag.
 *
 * The main process does the actual moving (WindowHelper.startWindowDrag); the
 * renderer only marks the gesture so useClickThrough can keep the window
 * interactive for its whole duration. `buttons` is not trustworthy here — a
 * transparent window with setIgnoreMouseEvents(true, { forward: true }) reports
 * `buttons === 0` on the mouseleave that a drag fires.
 */
let dragging = false

export function isWindowDragging(): boolean {
  return dragging
}

export function beginWindowDrag(): void {
  if (dragging) return
  dragging = true
  void window.electronAPI?.startWindowDrag()
}

export function endWindowDrag(): void {
  if (!dragging) return
  dragging = false
  void window.electronAPI?.endWindowDrag()
}

export interface ScreenPoint {
  x: number
  y: number
}

/** Screen-pixel travel a press may have before it stops counting as a click. */
export const CLICK_SLOP_PX = 4

/**
 * Whether a press that started at `start` and released at `end` should be
 * treated as a click rather than the tail of a drag.
 *
 * Needed wherever one element is both the drag handle and a button — the
 * collapsed control bar blob — because the pointerup that ends a drag also
 * fires a click, which would otherwise trigger the button on every move.
 *
 * The points must be screen coordinates. Client coordinates are useless here:
 * WindowHelper.followCursor holds the window at a fixed offset from the cursor
 * for the whole gesture, so clientX/clientY stay put no matter how far the
 * window travels. A missing `start` (a press this code never saw) counts as a
 * click — the button should still work.
 */
export function isClickNotDrag(
  start: ScreenPoint | null,
  end: ScreenPoint
): boolean {
  if (!start) return true
  return Math.hypot(end.x - start.x, end.y - start.y) <= CLICK_SLOP_PX
}
