import { describe, expect, it } from "vitest"
import { CLICK_SLOP_PX, isClickNotDrag } from "./windowDrag"

describe("isClickNotDrag", () => {
  it("treats a press that never moved as a click", () => {
    expect(isClickNotDrag({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(true)
  })

  it("tolerates hand tremor up to the slop", () => {
    expect(
      isClickNotDrag({ x: 100, y: 100 }, { x: 100 + CLICK_SLOP_PX, y: 100 })
    ).toBe(true)
  })

  it("treats a real drag as not a click", () => {
    expect(isClickNotDrag({ x: 100, y: 100 }, { x: 340, y: 220 })).toBe(false)
  })

  it("measures diagonal travel, not per-axis", () => {
    // 4px on each axis is inside the slop per-axis but 5.66px of actual travel.
    expect(isClickNotDrag({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false)
  })

  it("falls back to click when the press was never recorded", () => {
    expect(isClickNotDrag(null, { x: 999, y: 999 })).toBe(true)
  })
})
