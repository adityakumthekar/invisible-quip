// remoteViewport.ts
//
// Turning a finger on glass into a fraction of the laptop's screen.
//
// Three coordinate spaces are involved and it is worth naming them, because
// conflating any two of them produces clicks that land near the right place —
// the worst kind of wrong, since it looks like a calibration problem rather
// than a bug:
//
//   1. **Element space** — CSS pixels from the top-left of the <img>'s
//      container, which is what a touch event reports.
//   2. **Content space** — the letterboxed rectangle the frame actually
//      occupies inside that container. A 16:10 laptop screen inside a phone
//      viewport leaves bars, and a tap on a bar is not a tap on the screen.
//   3. **Normalized space** — 0..1 across the frame, which is the only thing
//      that goes over the wire. See NormalizedPoint in remoteProtocol.
//
// Pure and DOM-free so all of it is testable without a browser.

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** A pan/zoom applied as `translate(offsetX, offsetY) scale(scale)`. */
export interface ViewportTransform {
  scale: number
  offsetX: number
  offsetY: number
}

export const IDENTITY_TRANSFORM: ViewportTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 6

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Where the frame sits inside its container under `object-fit: contain`.
 *
 * Returns a zero-sized rect for degenerate inputs rather than dividing by zero
 * — a container can genuinely be 0×0 for a frame or two during layout.
 */
export function contentRect(
  container: Size,
  frame: Size
): { x: number; y: number; width: number; height: number } {
  if (
    container.width <= 0 ||
    container.height <= 0 ||
    frame.width <= 0 ||
    frame.height <= 0
  ) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  const fit = Math.min(container.width / frame.width, container.height / frame.height)
  const width = frame.width * fit
  const height = frame.height * fit

  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height
  }
}

/**
 * Element point → normalized frame point, or null when the tap missed the
 * frame entirely.
 *
 * Null rather than a clamp on purpose: clamping a tap on the letterbox bar to
 * the nearest edge would click the very edge of the screen, which is where
 * scrollbars and window controls live. Doing nothing is the correct response to
 * a tap on nothing.
 */
export function elementPointToNormalized(
  point: Point,
  container: Size,
  frame: Size,
  transform: ViewportTransform = IDENTITY_TRANSFORM
): Point | null {
  if (transform.scale <= 0) {
    return null
  }

  // Undo the pan/zoom first: the transform is applied to the container, so a
  // reported touch is in post-transform space.
  const untransformed = {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale
  }

  const content = contentRect(container, frame)
  if (content.width <= 0 || content.height <= 0) {
    return null
  }

  const normalized = {
    x: (untransformed.x - content.x) / content.width,
    y: (untransformed.y - content.y) / content.height
  }

  if (
    normalized.x < 0 ||
    normalized.x > 1 ||
    normalized.y < 0 ||
    normalized.y > 1
  ) {
    return null
  }
  return normalized
}

/**
 * Zoom about a fixed point, keeping whatever is under the fingers under the
 * fingers. Without the offset correction, pinching drifts the image away from
 * the gesture and feels broken.
 */
export function zoomAbout(
  transform: ViewportTransform,
  focus: Point,
  factor: number
): ViewportTransform {
  const scale = clamp(transform.scale * factor, MIN_ZOOM, MAX_ZOOM)
  // Recompute from the achieved scale, not the requested one, or the image
  // slides while the zoom sits pinned at a limit.
  const applied = scale / transform.scale

  return {
    scale,
    offsetX: focus.x - (focus.x - transform.offsetX) * applied,
    offsetY: focus.y - (focus.y - transform.offsetY) * applied
  }
}

/**
 * Keep the frame covering its container after a pan or zoom.
 *
 * At scale 1 the transform is pinned to the identity: letting a fully
 * zoomed-out frame be dragged around leaves a gap at the edge and no way to
 * tell whether the view is off-centre or the laptop screen simply ends there.
 */
export function constrainTransform(
  transform: ViewportTransform,
  container: Size
): ViewportTransform {
  const scale = clamp(transform.scale, MIN_ZOOM, MAX_ZOOM)
  if (scale <= MIN_ZOOM) {
    return IDENTITY_TRANSFORM
  }

  // Overflow is how much bigger the scaled content is than the container; the
  // offset may range across exactly that much, and no further.
  const maxOffsetX = container.width * (scale - 1)
  const maxOffsetY = container.height * (scale - 1)

  return {
    scale,
    offsetX: clamp(transform.offsetX, -maxOffsetX, 0),
    offsetY: clamp(transform.offsetY, -maxOffsetY, 0)
  }
}

export function panBy(
  transform: ViewportTransform,
  delta: Point,
  container: Size
): ViewportTransform {
  return constrainTransform(
    {
      scale: transform.scale,
      offsetX: transform.offsetX + delta.x,
      offsetY: transform.offsetY + delta.y
    },
    container
  )
}
