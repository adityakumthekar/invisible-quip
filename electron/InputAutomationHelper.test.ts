import { describe, expect, it, vi } from "vitest"
import { InputAutomationHelper, type NutBinding } from "./InputAutomationHelper"

function makeBinding() {
  const setPosition = vi.fn().mockResolvedValue(undefined)
  const leftClick = vi.fn().mockResolvedValue(undefined)
  const type = vi.fn().mockResolvedValue(undefined)
  class Point {
    constructor(
      public x: number,
      public y: number
    ) {}
  }
  const binding: NutBinding = {
    mouse: { setPosition, leftClick, config: { autoDelayMs: 100 } },
    keyboard: { type, config: { autoDelayMs: 100 } },
    Point
  }
  return { binding, setPosition, leftClick, type, Point }
}

describe("InputAutomationHelper", () => {
  it("moves to a rounded point and left-clicks", async () => {
    const { binding, setPosition, leftClick, Point } = makeBinding()
    const helper = new InputAutomationHelper(() => binding)

    await helper.clickAt({ x: 100.4, y: 200.6 })

    expect(setPosition).toHaveBeenCalledTimes(1)
    const point = setPosition.mock.calls[0][0]
    expect(point).toBeInstanceOf(Point)
    expect(point).toMatchObject({ x: 100, y: 201 })
    expect(leftClick).toHaveBeenCalledTimes(1)
  })

  it("types text into the focused field", async () => {
    const { binding, type } = makeBinding()
    const helper = new InputAutomationHelper(() => binding)

    await helper.typeText("discover weekly")

    expect(type).toHaveBeenCalledWith("discover weekly")
  })

  it("disables per-action delays once loaded", async () => {
    const { binding } = makeBinding()
    const helper = new InputAutomationHelper(() => binding)

    await helper.clickAt({ x: 1, y: 2 })

    expect(binding.mouse.config.autoDelayMs).toBe(0)
    expect(binding.keyboard.config.autoDelayMs).toBe(0)
  })

  it("surfaces an actionable error when the native binding is missing", async () => {
    const helper = new InputAutomationHelper(() => {
      throw new Error("Cannot find module '@nut-tree-fork/nut-js'")
    })

    await expect(helper.clickAt({ x: 0, y: 0 })).rejects.toThrow(
      /input automation is unavailable/i
    )
  })

  it("loads the native binding only once across actions", async () => {
    const { binding } = makeBinding()
    const load = vi.fn(() => binding)
    const helper = new InputAutomationHelper(load)

    await helper.clickAt({ x: 1, y: 2 })
    await helper.typeText("hi")

    expect(load).toHaveBeenCalledTimes(1)
  })
})
