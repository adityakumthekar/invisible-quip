import { describe, expect, it } from "vitest"
import {
  findDisplay,
  normalizedPointToDip,
  resolvePoint,
  scrollDeltaToSteps,
  toRemoteDisplay,
  TokenBucket,
  UNKNOWN_DISPLAY_MESSAGE
} from "./remoteInput"
import type { DisplayDescriptor } from "./displayTopology"

/** Primary, at the origin. */
const BUILT_IN: DisplayDescriptor = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  scaleFactor: 2
}

/** A second monitor to the right — the case that catches missing offsets. */
const EXTERNAL: DisplayDescriptor = {
  id: 2,
  bounds: { x: 1512, y: -200, width: 2560, height: 1440 },
  scaleFactor: 1
}

describe("normalizedPointToDip", () => {
  it("maps the corners and centre of the primary display", () => {
    expect(normalizedPointToDip({ x: 0, y: 0 }, BUILT_IN)).toEqual({ x: 0, y: 0 })
    expect(normalizedPointToDip({ x: 1, y: 1 }, BUILT_IN)).toEqual({
      x: 1512,
      y: 982
    })
    expect(normalizedPointToDip({ x: 0.5, y: 0.5 }, BUILT_IN)).toEqual({
      x: 756,
      y: 491
    })
  })

  // The bug this exists to prevent: dropping the display origin sends every
  // click on the second monitor to the first one.
  it("adds the display origin, including a negative one", () => {
    expect(normalizedPointToDip({ x: 0, y: 0 }, EXTERNAL)).toEqual({
      x: 1512,
      y: -200
    })
    expect(normalizedPointToDip({ x: 1, y: 1 }, EXTERNAL)).toEqual({
      x: 4072,
      y: 1240
    })
    expect(normalizedPointToDip({ x: 0.5, y: 0.5 }, EXTERNAL)).toEqual({
      x: 2792,
      y: 520
    })
  })

  // DIPs, not physical pixels: nut-js and Electron's screen API both speak
  // DIPs, so a 2x display must not double the coordinate.
  it("ignores scaleFactor", () => {
    const scaled = { ...BUILT_IN, scaleFactor: 3 }
    expect(normalizedPointToDip({ x: 0.5, y: 0.5 }, scaled)).toEqual(
      normalizedPointToDip({ x: 0.5, y: 0.5 }, BUILT_IN)
    )
  })

  it("never returns a point outside the display", () => {
    for (const [x, y] of [[0, 0], [1, 1], [0.5, 0.5], [0, 1], [1, 0]]) {
      const point = normalizedPointToDip({ x, y }, EXTERNAL)
      expect(point.x).toBeGreaterThanOrEqual(EXTERNAL.bounds.x)
      expect(point.x).toBeLessThanOrEqual(EXTERNAL.bounds.x + EXTERNAL.bounds.width)
      expect(point.y).toBeGreaterThanOrEqual(EXTERNAL.bounds.y)
      expect(point.y).toBeLessThanOrEqual(EXTERNAL.bounds.y + EXTERNAL.bounds.height)
    }
  })
})

describe("findDisplay / resolvePoint", () => {
  const displays = [BUILT_IN, EXTERNAL]

  it("finds a display by id", () => {
    expect(findDisplay(displays, 2)).toBe(EXTERNAL)
  })

  // Falling back to the primary display would take a tap meant for a monitor
  // that has been unplugged and click somewhere else entirely.
  it("returns null for an unknown display rather than a fallback", () => {
    expect(findDisplay(displays, 99)).toBeNull()
    expect(findDisplay([], 1)).toBeNull()
  })

  it("resolves a point against the named display", () => {
    expect(resolvePoint({ x: 0.5, y: 0.5, displayId: 2 }, displays)).toEqual({
      x: 2792,
      y: 520
    })
  })

  it("refuses a point on a display that is gone", () => {
    expect(() =>
      resolvePoint({ x: 0.5, y: 0.5, displayId: 99 }, displays)
    ).toThrow(UNKNOWN_DISPLAY_MESSAGE)
  })
})

describe("scrollDeltaToSteps", () => {
  it("maps sign to direction on both axes", () => {
    expect(scrollDeltaToSteps({ dx: 0, dy: 400 })).toEqual([
      { direction: "down", steps: 10 }
    ])
    expect(scrollDeltaToSteps({ dx: 0, dy: -400 })).toEqual([
      { direction: "up", steps: 10 }
    ])
    expect(scrollDeltaToSteps({ dx: 400, dy: 0 })).toEqual([
      { direction: "right", steps: 10 }
    ])
    expect(scrollDeltaToSteps({ dx: -400, dy: 0 })).toEqual([
      { direction: "left", steps: 10 }
    ])
  })

  it("emits vertical before horizontal for a diagonal flick", () => {
    expect(scrollDeltaToSteps({ dx: -80, dy: 120 })).toEqual([
      { direction: "down", steps: 3 },
      { direction: "left", steps: 2 }
    ])
  })

  it("drops an axis with no movement", () => {
    expect(scrollDeltaToSteps({ dx: 0, dy: 0 })).toEqual([])
  })

  // A small deliberate scroll must still move something; rounding it to zero
  // steps makes the gesture feel broken rather than gentle.
  it("floors a small non-zero delta at one step", () => {
    expect(scrollDeltaToSteps({ dx: 0, dy: 1 })).toEqual([
      { direction: "down", steps: 1 }
    ])
    expect(scrollDeltaToSteps({ dx: -3, dy: 0 })).toEqual([
      { direction: "left", steps: 1 }
    ])
  })
})

describe("toRemoteDisplay", () => {
  it("marks the primary and carries DIP dimensions", () => {
    expect(toRemoteDisplay({ ...BUILT_IN, label: "Built-in Retina" }, 1)).toEqual({
      id: 1,
      label: "Built-in Retina",
      width: 1512,
      height: 982,
      primary: true
    })
    expect(toRemoteDisplay(EXTERNAL, 1).primary).toBe(false)
  })

  it("falls back to a usable label when the OS gives none", () => {
    expect(toRemoteDisplay(EXTERNAL, 1).label).toBe("Display 2")
    expect(toRemoteDisplay({ ...EXTERNAL, label: "   " }, 1).label).toBe("Display 2")
  })
})

describe("TokenBucket", () => {
  /** A clock the test drives, so rate limiting doesn't need real time. */
  function clock(start = 0) {
    let at = start
    return {
      now: () => at,
      advance: (ms: number) => {
        at += ms
      }
    }
  }

  it("allows a burst up to capacity, then refuses", () => {
    const time = clock()
    const bucket = new TokenBucket(5, 10, time.now)

    for (let index = 0; index < 5; index += 1) {
      expect(bucket.tryTake()).toBe(true)
    }
    expect(bucket.tryTake()).toBe(false)
  })

  it("refills at the configured rate", () => {
    const time = clock()
    const bucket = new TokenBucket(5, 10, time.now)
    for (let index = 0; index < 5; index += 1) {
      bucket.tryTake()
    }

    // 10/sec means one token per 100ms.
    time.advance(100)
    expect(bucket.tryTake()).toBe(true)
    expect(bucket.tryTake()).toBe(false)

    time.advance(300)
    expect(bucket.tryTake()).toBe(true)
    expect(bucket.tryTake()).toBe(true)
    expect(bucket.tryTake()).toBe(true)
    expect(bucket.tryTake()).toBe(false)
  })

  it("never refills past capacity", () => {
    const time = clock()
    const bucket = new TokenBucket(3, 10, time.now)
    time.advance(60_000)

    expect(bucket.tryTake()).toBe(true)
    expect(bucket.tryTake()).toBe(true)
    expect(bucket.tryTake()).toBe(true)
    expect(bucket.tryTake()).toBe(false)
  })

  // Sleep/wake and NTP both move this clock backwards. Neither should hand out
  // free tokens or wedge the bucket shut.
  it("survives a clock that jumps backwards", () => {
    const time = clock(10_000)
    const bucket = new TokenBucket(2, 10, time.now)
    bucket.tryTake()
    bucket.tryTake()
    expect(bucket.tryTake()).toBe(false)

    time.advance(-5_000)
    expect(bucket.tryTake()).toBe(false)

    time.advance(5_100)
    expect(bucket.tryTake()).toBe(true)
  })
})
