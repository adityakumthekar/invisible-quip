// remoteGestures.ts
//
// Deciding what a finger meant.
//
// Written as a pure state machine over touch samples rather than as DOM event
// handlers, for two reasons. It is the piece most likely to be wrong in ways
// that are miserable to reproduce by hand — a double-tap that registers as two
// clicks, a drag that fires a click at its origin — and every one of those
// cases is a three-line test here. And it keeps the recognizer honest about
// time: `now` is a parameter, so "held for 500ms" is a test, not a stopwatch.
//
// It emits *gestures*, not commands. What a drag means depends on whether the
// user is in Touch or View mode, and that decision belongs to the component
// that knows the mode, not here.

export interface Point {
  x: number
  y: number
}

/** One finger's position, in element space. */
export interface Touch extends Point {
  id: number
}

export type Gesture =
  | { type: "tap"; point: Point }
  | { type: "double-tap"; point: Point }
  | { type: "long-press"; point: Point }
  | { type: "drag"; from: Point; to: Point }
  | { type: "two-finger-pan"; delta: Point; center: Point }
  | { type: "pinch"; factor: number; center: Point }

/** Movement under this is a press, not a drag. Roughly a fingertip's wobble. */
export const TAP_SLOP_PX = 12
/** Held longer than this without moving is a long press. */
export const LONG_PRESS_MS = 500
/** A second tap within this window, near the first, is a double tap. */
export const DOUBLE_TAP_MS = 300
export const DOUBLE_TAP_SLOP_PX = 32

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function centerOf(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

interface SingleState {
  kind: "single"
  start: Point
  last: Point
  startedAt: number
  moved: boolean
}

interface DoubleState {
  kind: "double"
  center: Point
  spread: number
}

/**
 * After two fingers have been down, the leftover finger must not become a tap
 * on lift — releasing a pinch one finger at a time would otherwise click.
 */
interface SpentState {
  kind: "spent"
}

type State = SingleState | DoubleState | SpentState | null

export class GestureRecognizer {
  private state: State = null
  private lastTapAt = 0
  private lastTapPoint: Point | null = null

  /** Fingers went down, or an extra finger joined. */
  public start(touches: Touch[], now: number): Gesture[] {
    if (touches.length >= 2) {
      this.state = {
        kind: "double",
        center: centerOf(touches[0], touches[1]),
        spread: distance(touches[0], touches[1])
      }
      return []
    }

    if (touches.length === 1) {
      this.state = {
        kind: "single",
        start: { x: touches[0].x, y: touches[0].y },
        last: { x: touches[0].x, y: touches[0].y },
        startedAt: now,
        moved: false
      }
    }
    return []
  }

  public move(touches: Touch[], _now: number): Gesture[] {
    if (this.state?.kind === "double" && touches.length >= 2) {
      const center = centerOf(touches[0], touches[1])
      const spread = distance(touches[0], touches[1])
      const previous = this.state
      this.state = { kind: "double", center, spread }

      const gestures: Gesture[] = []
      // Both are reported every frame. A pinch that also drifts is a real
      // thing people do, and swallowing one of the two makes the view feel
      // like it is fighting the hand.
      if (previous.spread > 0 && spread > 0) {
        const factor = spread / previous.spread
        if (factor !== 1) {
          gestures.push({ type: "pinch", factor, center })
        }
      }
      const delta = {
        x: center.x - previous.center.x,
        y: center.y - previous.center.y
      }
      if (delta.x !== 0 || delta.y !== 0) {
        gestures.push({ type: "two-finger-pan", delta, center })
      }
      return gestures
    }

    if (this.state?.kind === "single" && touches.length === 1) {
      const point = { x: touches[0].x, y: touches[0].y }
      this.state.last = point
      if (distance(this.state.start, point) > TAP_SLOP_PX) {
        this.state.moved = true
      }
    }
    return []
  }

  /** A finger lifted. `touches` is what remains down. */
  public end(touches: Touch[], now: number): Gesture[] {
    const state = this.state

    // Still fingers down: a pinch losing one finger must not turn into a drag
    // with the other, so the rest of the gesture is dead.
    if (touches.length > 0) {
      this.state = { kind: "spent" }
      return []
    }
    this.state = null

    if (!state || state.kind !== "single") {
      return []
    }

    if (state.moved) {
      // A drag never also counts as a tap, however brief it was.
      this.lastTapPoint = null
      return [{ type: "drag", from: state.start, to: state.last }]
    }

    if (now - state.startedAt >= LONG_PRESS_MS) {
      this.lastTapPoint = null
      return [{ type: "long-press", point: state.start }]
    }

    const isDouble =
      this.lastTapPoint !== null &&
      now - this.lastTapAt <= DOUBLE_TAP_MS &&
      distance(this.lastTapPoint, state.start) <= DOUBLE_TAP_SLOP_PX

    if (isDouble) {
      // Cleared so a third tap starts a fresh pair rather than firing a second
      // double-tap off the same history.
      this.lastTapPoint = null
      return [{ type: "double-tap", point: state.start }]
    }

    this.lastTapAt = now
    this.lastTapPoint = state.start
    return [{ type: "tap", point: state.start }]
  }

  /** Abandon the gesture in progress — used when the browser cancels touches. */
  public cancel(): void {
    this.state = null
    this.lastTapPoint = null
  }
}
