import { describe, expect, it } from "vitest"
import {
  constrainTransform,
  contentRect,
  elementPointToNormalized,
  IDENTITY_TRANSFORM,
  MAX_ZOOM,
  panBy,
  zoomAbout
} from "./remoteViewport"

/** A phone in landscape. */
const CONTAINER = { width: 800, height: 400 }
/** A 16:10 laptop screen — taller in aspect than the container, so bars. */
const FRAME = { width: 1600, height: 1000 }

describe("contentRect", () => {
  it("letterboxes a frame that is taller in aspect than its container", () => {
    // 800/1600 = 0.5, 400/1000 = 0.4 → fit is 0.4, so 640x400 centred.
    expect(contentRect(CONTAINER, FRAME)).toEqual({
      x: 80,
      y: 0,
      width: 640,
      height: 400
    })
  })

  it("pillarboxes the other way round", () => {
    expect(contentRect({ width: 400, height: 400 }, { width: 800, height: 400 })).toEqual(
      { x: 0, y: 100, width: 400, height: 200 }
    )
  })

  it("fills exactly when the aspects match", () => {
    expect(contentRect({ width: 800, height: 500 }, FRAME)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 500
    })
  })

  // Containers are genuinely 0x0 for a frame or two during layout.
  it("returns an empty rect rather than dividing by zero", () => {
    for (const [container, frame] of [
      [{ width: 0, height: 400 }, FRAME],
      [{ width: 800, height: 0 }, FRAME],
      [CONTAINER, { width: 0, height: 0 }]
    ] as const) {
      expect(contentRect(container, frame)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0
      })
    }
  })
})

describe("elementPointToNormalized", () => {
  it("maps the content corners to 0 and 1", () => {
    expect(elementPointToNormalized({ x: 80, y: 0 }, CONTAINER, FRAME)).toEqual({
      x: 0,
      y: 0
    })
    expect(elementPointToNormalized({ x: 720, y: 400 }, CONTAINER, FRAME)).toEqual({
      x: 1,
      y: 1
    })
  })

  it("maps the centre to the centre", () => {
    expect(elementPointToNormalized({ x: 400, y: 200 }, CONTAINER, FRAME)).toEqual({
      x: 0.5,
      y: 0.5
    })
  })

  // The bug this guards: clamping a bar tap to the nearest edge would click
  // the very edge of the screen, where scrollbars and window controls live.
  it("returns null for a tap on the letterbox bars", () => {
    expect(elementPointToNormalized({ x: 40, y: 200 }, CONTAINER, FRAME)).toBeNull()
    expect(elementPointToNormalized({ x: 760, y: 200 }, CONTAINER, FRAME)).toBeNull()
  })

  it("returns null for a tap outside the container", () => {
    expect(elementPointToNormalized({ x: -10, y: 200 }, CONTAINER, FRAME)).toBeNull()
    expect(elementPointToNormalized({ x: 400, y: 900 }, CONTAINER, FRAME)).toBeNull()
  })

  describe("under zoom and pan", () => {
    // Zoomed 2x with the view moved left, the same finger position must name a
    // different part of the screen — this is the whole point of zooming in to
    // hit a small target.
    it("accounts for the transform", () => {
      const transform = { scale: 2, offsetX: -400, offsetY: -200 }
      // Untransformed: ((400 + 400) / 2, (200 + 200) / 2) = (400, 200) → centre.
      expect(
        elementPointToNormalized({ x: 400, y: 200 }, CONTAINER, FRAME, transform)
      ).toEqual({ x: 0.5, y: 0.5 })
    })

    it("maps a different finger position to a different point when zoomed", () => {
      const zoomed = elementPointToNormalized(
        { x: 200, y: 100 },
        CONTAINER,
        FRAME,
        { scale: 2, offsetX: 0, offsetY: 0 }
      )
      const plain = elementPointToNormalized({ x: 200, y: 100 }, CONTAINER, FRAME)
      expect(zoomed).not.toEqual(plain)
    })

    it("refuses a degenerate scale rather than dividing by zero", () => {
      for (const scale of [0, -1]) {
        expect(
          elementPointToNormalized({ x: 400, y: 200 }, CONTAINER, FRAME, {
            scale,
            offsetX: 0,
            offsetY: 0
          })
        ).toBeNull()
      }
    })
  })
})

describe("zoomAbout", () => {
  // What is under the fingers must stay under the fingers, or pinching drifts.
  it("keeps the focus point fixed", () => {
    const focus = { x: 300, y: 150 }
    const zoomed = zoomAbout(IDENTITY_TRANSFORM, focus, 2)

    const before = elementPointToNormalized(focus, CONTAINER, FRAME)
    const after = elementPointToNormalized(focus, CONTAINER, FRAME, zoomed)
    expect(after!.x).toBeCloseTo(before!.x, 6)
    expect(after!.y).toBeCloseTo(before!.y, 6)
  })

  it("clamps to the zoom limits", () => {
    expect(zoomAbout(IDENTITY_TRANSFORM, { x: 0, y: 0 }, 0.5).scale).toBe(1)
    expect(zoomAbout(IDENTITY_TRANSFORM, { x: 0, y: 0 }, 100).scale).toBe(MAX_ZOOM)
  })

  // Recomputing the offset from the requested factor rather than the achieved
  // one makes the image slide while the zoom sits pinned at its limit.
  it("does not drift once pinned at the maximum", () => {
    const atMax = zoomAbout(IDENTITY_TRANSFORM, { x: 400, y: 200 }, MAX_ZOOM)
    const pushed = zoomAbout(atMax, { x: 400, y: 200 }, 2)
    expect(pushed).toEqual(atMax)
  })
})

describe("constrainTransform", () => {
  it("snaps back to the identity at minimum zoom", () => {
    expect(
      constrainTransform({ scale: 1, offsetX: -50, offsetY: 30 }, CONTAINER)
    ).toEqual(IDENTITY_TRANSFORM)
  })

  // A gap at the edge is indistinguishable from the laptop screen simply
  // ending there, so the frame must always cover the container.
  it("keeps the frame covering the container when zoomed", () => {
    const constrained = constrainTransform(
      { scale: 2, offsetX: 500, offsetY: 500 },
      CONTAINER
    )
    expect(constrained.offsetX).toBe(0)
    expect(constrained.offsetY).toBe(0)

    const other = constrainTransform(
      { scale: 2, offsetX: -5000, offsetY: -5000 },
      CONTAINER
    )
    expect(other.offsetX).toBe(-CONTAINER.width)
    expect(other.offsetY).toBe(-CONTAINER.height)
  })
})

describe("panBy", () => {
  it("moves the view and stays constrained", () => {
    const zoomed = { scale: 2, offsetX: -400, offsetY: -200 }
    const panned = panBy(zoomed, { x: 100, y: 50 }, CONTAINER)
    expect(panned.offsetX).toBe(-300)
    expect(panned.offsetY).toBe(-150)
  })

  it("cannot pan past the edge", () => {
    const zoomed = { scale: 2, offsetX: -10, offsetY: -10 }
    expect(panBy(zoomed, { x: 999, y: 999 }, CONTAINER)).toMatchObject({
      offsetX: 0,
      offsetY: 0
    })
  })

  it("is a no-op at minimum zoom", () => {
    expect(panBy(IDENTITY_TRANSFORM, { x: 100, y: 100 }, CONTAINER)).toEqual(
      IDENTITY_TRANSFORM
    )
  })
})
