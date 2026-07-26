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
