import { describe, expect, it } from "vitest"
import {
  DOUBLE_TAP_MS,
  GestureRecognizer,
  LONG_PRESS_MS,
  TAP_SLOP_PX,
  type Gesture
} from "./remoteGestures"

const finger = (x: number, y: number, id = 1) => ({ id, x, y })

/** Press and release one finger, with control over time and distance. */
function press(
  recognizer: GestureRecognizer,
  options: {
    from: [number, number]
    to?: [number, number]
    at?: number
    heldMs?: number
  }
): Gesture[] {
  const at = options.at ?? 0
  const [x, y] = options.from
  recognizer.start([finger(x, y)], at)
  if (options.to) {
    recognizer.move([finger(options.to[0], options.to[1])], at + 10)
  }
  const [endX, endY] = options.to ?? options.from
  return recognizer.end([], at + (options.heldMs ?? 50))
}

describe("single-finger gestures", () => {
  it("recognizes a tap", () => {
    const recognizer = new GestureRecognizer()
    expect(press(recognizer, { from: [100, 200] })).toEqual([
      { type: "tap", point: { x: 100, y: 200 } }
    ])
  })

  it("recognizes a long press", () => {
    const recognizer = new GestureRecognizer()
    expect(
      press(recognizer, { from: [100, 200], heldMs: LONG_PRESS_MS })
    ).toEqual([{ type: "long-press", point: { x: 100, y: 200 } }])
  })

  it("recognizes a drag", () => {
    const recognizer = new GestureRecognizer()
    expect(press(recognizer, { from: [100, 200], to: [300, 260] })).toEqual([
      { type: "drag", from: { x: 100, y: 200 }, to: { x: 300, y: 260 } }
    ])
  })

  // A fingertip wobbles. Treating that as a drag makes every tap a tiny
  // click-and-drag, which selects text instead of clicking.
  it("treats movement within the slop as a tap", () => {
    const recognizer = new GestureRecognizer()
    const gestures = press(recognizer, {
      from: [100, 200],
      to: [100 + TAP_SLOP_PX - 1, 200]
    })
    expect(gestures[0].type).toBe("tap")
  })

  it("treats movement past the slop as a drag, however brief", () => {
    const recognizer = new GestureRecognizer()
    const gestures = press(recognizer, {
      from: [100, 200],
      to: [100 + TAP_SLOP_PX + 1, 200],
      heldMs: 20
    })
    expect(gestures[0].type).toBe("drag")
  })

  // A slow drag is still a drag: holding then moving must not right-click at
  // the origin as well.
  it("prefers drag over long press when the finger moved", () => {
    const recognizer = new GestureRecognizer()
    const gestures = press(recognizer, {
      from: [100, 200],
      to: [400, 200],
      heldMs: LONG_PRESS_MS * 2
    })
    expect(gestures).toEqual([
      { type: "drag", from: { x: 100, y: 200 }, to: { x: 400, y: 200 } }
    ])
  })
})

describe("double tap", () => {
  it("recognizes two quick taps in the same place", () => {
    const recognizer = new GestureRecognizer()
    expect(press(recognizer, { from: [100, 200], at: 0 })[0].type).toBe("tap")
    expect(press(recognizer, { from: [102, 201], at: 100 })).toEqual([
      { type: "double-tap", point: { x: 102, y: 201 } }
    ])
  })

  it("does not pair taps that are too far apart in time", () => {
    const recognizer = new GestureRecognizer()
    press(recognizer, { from: [100, 200], at: 0 })
    expect(
      press(recognizer, { from: [100, 200], at: DOUBLE_TAP_MS + 200 })[0].type
    ).toBe("tap")
  })

  it("does not pair taps that are too far apart in space", () => {
    const recognizer = new GestureRecognizer()
    press(recognizer, { from: [100, 200], at: 0 })
    expect(press(recognizer, { from: [400, 500], at: 100 })[0].type).toBe("tap")
  })

  // Three taps are a double then a single, not two doubles — otherwise a
  // rapid triple-tap opens two context-sensitive things at once.
  it("starts a fresh pair after a double tap", () => {
    const recognizer = new GestureRecognizer()
    press(recognizer, { from: [100, 200], at: 0 })
    expect(press(recognizer, { from: [100, 200], at: 100 })[0].type).toBe(
      "double-tap"
    )
    expect(press(recognizer, { from: [100, 200], at: 200 })[0].type).toBe("tap")
  })

  it("does not pair a tap with a preceding drag", () => {
    const recognizer = new GestureRecognizer()
    press(recognizer, { from: [100, 200], to: [400, 200], at: 0 })
    expect(press(recognizer, { from: [400, 200], at: 100 })[0].type).toBe("tap")
  })
})

describe("two-finger gestures", () => {
  it("reports a pan from two fingers moving together", () => {
    const recognizer = new GestureRecognizer()
    recognizer.start([finger(100, 100, 1), finger(200, 100, 2)], 0)
    const gestures = recognizer.move(
      [finger(100, 150, 1), finger(200, 150, 2)],
      16
    )

    expect(gestures).toEqual([
      { type: "two-finger-pan", delta: { x: 0, y: 50 }, center: { x: 150, y: 150 } }
    ])
  })

  it("reports a pinch factor from fingers spreading", () => {
    const recognizer = new GestureRecognizer()
    recognizer.start([finger(100, 100, 1), finger(200, 100, 2)], 0)
    const gestures = recognizer.move(
      [finger(50, 100, 1), finger(250, 100, 2)],
      16
    )

    const pinch = gestures.find((gesture) => gesture.type === "pinch")
    expect(pinch).toEqual({
      type: "pinch",
      factor: 2,
      center: { x: 150, y: 100 }
    })
  })

  it("reports both when the fingers pinch and drift at once", () => {
    const recognizer = new GestureRecognizer()
    recognizer.start([finger(100, 100, 1), finger(200, 100, 2)], 0)
    const types = recognizer
      .move([finger(60, 200, 1), finger(260, 200, 2)], 16)
      .map((gesture) => gesture.type)

    expect(types).toContain("pinch")
    expect(types).toContain("two-finger-pan")
  })

  // Lifting a pinch one finger at a time must not leave a stray click behind.
  it("does not emit a tap when releasing two fingers one by one", () => {
    const recognizer = new GestureRecognizer()
    recognizer.start([finger(100, 100, 1), finger(200, 100, 2)], 0)
    recognizer.move([finger(100, 120, 1), finger(200, 120, 2)], 16)

    expect(recognizer.end([finger(200, 120, 2)], 50)).toEqual([])
    expect(recognizer.end([], 80)).toEqual([])
  })

  it("does not emit a drag from the finger left after a pinch", () => {
    const recognizer = new GestureRecognizer()
    recognizer.start([finger(100, 100, 1), finger(300, 100, 2)], 0)
    recognizer.end([finger(300, 100, 2)], 50)
    recognizer.move([finger(600, 400, 2)], 60)

    expect(recognizer.end([], 90)).toEqual([])
  })

  it("recovers for the next gesture after a spent one", () => {
    const recognizer = new GestureRecognizer()
    recognizer.start([finger(100, 100, 1), finger(300, 100, 2)], 0)
    recognizer.end([finger(300, 100, 2)], 50)
    recognizer.end([], 80)

    expect(press(recognizer, { from: [100, 200], at: 500 })[0].type).toBe("tap")
  })
})

describe("cancel", () => {
  it("drops the gesture in progress", () => {
    const recognizer = new GestureRecognizer()
    recognizer.start([finger(100, 200)], 0)
    recognizer.cancel()
    expect(recognizer.end([], 50)).toEqual([])
  })
})
