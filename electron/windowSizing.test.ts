import { describe, expect, it } from "vitest"
import { computeWindowBounds } from "./windowSizing"

const workArea = { x: 0, y: 25, width: 1440, height: 875 }

describe("computeWindowBounds", () => {
  it("grows with the content while it fits", () => {
    const { height } = computeWindowBounds({
      content: { width: 400, height: 300 },
      current: { x: 100, y: 100 },
      workArea,
      widthFraction: 0.7
    })
    expect(height).toBe(300)
  })

  it("caps height at 60% of the work area so it never owns the screen", () => {
    const { height, maxHeight } = computeWindowBounds({
      content: { width: 400, height: 5000 },
      current: { x: 100, y: 100 },
      workArea,
      widthFraction: 0.7
    })
    expect(maxHeight).toBe(525)
    expect(height).toBe(525)
  })

  it("caps width at the given fraction and adds the chrome pad below it", () => {
    expect(
      computeWindowBounds({
        content: { width: 400, height: 100 },
        current: { x: 0, y: 100 },
        workArea,
        widthFraction: 0.7
      }).width
    ).toBe(432)
    // 1007, not 1008: 1440 * 0.7 is 1007.9999… in binary floating point and the
    // cap floors it. Unchanged from the pre-existing width behaviour.
    expect(
      computeWindowBounds({
        content: { width: 5000, height: 100 },
        current: { x: 0, y: 100 },
        workArea,
        widthFraction: 0.7
      }).width
    ).toBe(1007)
  })

  it("pulls a window that would grow past the bottom back into the work area", () => {
    const { y, height } = computeWindowBounds({
      content: { width: 400, height: 500 },
      current: { x: 100, y: 800 },
      workArea,
      widthFraction: 0.7
    })
    expect(y + height).toBeLessThanOrEqual(workArea.y + workArea.height)
    expect(y).toBeGreaterThanOrEqual(workArea.y)
  })

  it("never pushes y above the top of the work area", () => {
    const { y } = computeWindowBounds({
      content: { width: 400, height: 5000 },
      current: { x: 100, y: 30 },
      workArea,
      widthFraction: 0.7
    })
    expect(y).toBe(30)
  })

  it("keeps x inside the work area, as before", () => {
    expect(
      computeWindowBounds({
        content: { width: 400, height: 100 },
        current: { x: 1400, y: 100 },
        workArea,
        widthFraction: 0.7
      }).x
    ).toBe(1440 - 432)
  })
})
