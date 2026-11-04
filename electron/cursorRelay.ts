export interface CursorPoint {
  x: number
  y: number
}

export interface CursorBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Client point to inject while the overlay is click-through.
 *
 * macOS does not deliver mouse-moved events to a window that ignores mouse
 * events, so the renderer never learns the cursor is over the pill and never
 * turns click-through off. Returns null when real events are already flowing,
 * a drag is in progress, or the cursor is outside the window.
 */
export function cursorRelayPoint(
  cursor: CursorPoint,
  bounds: CursorBounds,
  state: { ignoringMouseEvents: boolean; dragging: boolean; visible: boolean }
): CursorPoint | null {
  if (!state.visible || !state.ignoringMouseEvents || state.dragging) return null
  if (
    cursor.x < bounds.x ||
    cursor.y < bounds.y ||
    cursor.x >= bounds.x + bounds.width ||
    cursor.y >= bounds.y + bounds.height
  ) {
    return null
  }
  return {
    x: Math.round(cursor.x - bounds.x),
    y: Math.round(cursor.y - bounds.y)
  }
}
