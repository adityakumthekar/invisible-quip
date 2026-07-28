import { describe, expect, it, vi } from "vitest"
import {
  InputAutomationHelper,
  keyComboToKeyNames,
  type NutBinding
} from "./InputAutomationHelper"

function makeBinding() {
  const mouse = {
    setPosition: vi.fn().mockResolvedValue(undefined),
    leftClick: vi.fn().mockResolvedValue(undefined),
    rightClick: vi.fn().mockResolvedValue(undefined),
    doubleClick: vi.fn().mockResolvedValue(undefined),
    scrollUp: vi.fn().mockResolvedValue(undefined),
    scrollDown: vi.fn().mockResolvedValue(undefined),
    scrollLeft: vi.fn().mockResolvedValue(undefined),
    scrollRight: vi.fn().mockResolvedValue(undefined),
    drag: vi.fn().mockResolvedValue(undefined),
    config: { autoDelayMs: 100 }
  }
  const keyboard = {
    type: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    releaseKey: vi.fn().mockResolvedValue(undefined),
    config: { autoDelayMs: 100 }
  }
  class Point {
    constructor(
      public x: number,
      public y: number
    ) {}
  }
  // Mirrors the real enums, where the first member is 0 — a falsy value that
  // a naive lookup would treat as "unsupported".
  const Button = { LEFT: 0, MIDDLE: 1, RIGHT: 2 }
  const Key = {
    Escape: 0,
    A: 72,
    N: 93,
    Num5: 33,
    Enter: 103,
    Tab: 50,
    F5: 5,
    LeftCmd: 107,
    LeftControl: 104,
    LeftShift: 87,
    LeftAlt: 108,
    LeftSuper: 105
  }

  const binding: NutBinding = { mouse, keyboard, Point, Button, Key }
  return { binding, mouse, keyboard, Point, Button, Key }
}

describe("keyComboToKeyNames", () => {
  it("maps modifiers and letters", () => {
    expect(keyComboToKeyNames("cmd+a")).toEqual(["LeftCmd", "A"])
    expect(keyComboToKeyNames("ctrl+shift+n")).toEqual([
      "LeftControl",
      "LeftShift",
      "N"
    ])
  })

  it("maps named keys, function keys, and digits", () => {
    expect(keyComboToKeyNames("enter")).toEqual(["Enter"])
    expect(keyComboToKeyNames("esc")).toEqual(["Escape"])
    expect(keyComboToKeyNames("f5")).toEqual(["F5"])
    expect(keyComboToKeyNames("5")).toEqual(["Num5"])
  })

  it("rejects tokens with no enum equivalent", () => {
    expect(() => keyComboToKeyNames("hyper+a")).toThrow(/modifier/i)
    expect(() => keyComboToKeyNames("brightness")).toThrow(/unsupported key/i)
  })
})

describe("InputAutomationHelper", () => {
  it("moves to a rounded point and left-clicks", async () => {
    const { binding, mouse, Point } = makeBinding()
    const helper = new InputAutomationHelper(() => binding)

    await helper.clickAt({ x: 100.4, y: 200.6 })

    expect(mouse.setPosition).toHaveBeenCalledTimes(1)
    const point = mouse.setPosition.mock.calls[0][0]
    expect(point).toBeInstanceOf(Point)
    expect(point).toMatchObject({ x: 100, y: 201 })
    expect(mouse.leftClick).toHaveBeenCalledTimes(1)
  })

  it("double-clicks with the left button enum, whose value is 0", async () => {
    const { binding, mouse } = makeBinding()
    const helper = new InputAutomationHelper(() => binding)

    await helper.doubleClickAt({ x: 10, y: 20 })

    expect(mouse.setPosition).toHaveBeenCalledTimes(1)
    expect(mouse.doubleClick).toHaveBeenCalledWith(0)
  })

  it("right-clicks at a point", async () => {
    const { binding, mouse } = makeBinding()
    const helper = new InputAutomationHelper(() => binding)

    await helper.rightClickAt({ x: 10, y: 20 })

    expect(mouse.setPosition).toHaveBeenCalledTimes(1)
    expect(mouse.rightClick).toHaveBeenCalledTimes(1)
  })

  it("parks the cursor before scrolling in each direction", async () => {
    const { binding, mouse } = makeBinding()
    const helper = new InputAutomationHelper(() => binding)

    await helper.scrollAt({ x: 5, y: 6 }, "down", 3)
    expect(mouse.setPosition).toHaveBeenCalledTimes(1)
    expect(mouse.scrollDown).toHaveBeenCalledWith(3)

    await helper.scrollAt({ x: 5, y: 6 }, "up", 2)
    expect(mouse.scrollUp).toHaveBeenCalledWith(2)

    await helper.scrollAt({ x: 5, y: 6 }, "left", 1)
    expect(mouse.scrollLeft).toHaveBeenCalledWith(1)

    await helper.scrollAt({ x: 5, y: 6 }, "right", 4)
    expect(mouse.scrollRight).toHaveBeenCalledWith(4)
  })

  it("floors scroll steps to at least one", async () => {
    const { binding, mouse } = makeBinding()
    const helper = new InputAutomationHelper(() => binding)

    await helper.scrollAt({ x: 0, y: 0 }, "down", 0.2)

    expect(mouse.scrollDown).toHaveBeenCalledWith(1)
  })

  it("presses and releases a key combo", async () => {
    const { binding, keyboard } = makeBinding()
    const helper = new InputAutomationHelper(() => binding)

    await helper.pressKey("cmd+a")

    expect(keyboard.pressKey).toHaveBeenCalledWith(107, 72)
    expect(keyboard.releaseKey).toHaveBeenCalledWith(107, 72)
  })

  it("presses a key whose enum value is 0", async () => {
    const { binding, keyboard } = makeBinding()
    const helper = new InputAutomationHelper(() => binding)

    await helper.pressKey("escape")

    expect(keyboard.pressKey).toHaveBeenCalledWith(0)
  })

  it("reports a key the binding does not expose", async () => {
    const { binding } = makeBinding()
    delete (binding.Key as Record<string, unknown>).Tab
    const helper = new InputAutomationHelper(() => binding)

    await expect(helper.pressKey("tab")).rejects.toThrow(/does not support key/i)
  })

  it("drags from one point to another", async () => {
    const { binding, mouse, Point } = makeBinding()
    const helper = new InputAutomationHelper(() => binding)

    await helper.dragTo({ x: 10.2, y: 20.7 }, { x: 90, y: 80 })

    expect(mouse.setPosition).toHaveBeenCalledTimes(1)
    const path = mouse.drag.mock.calls[0][0] as unknown[]
    expect(path).toHaveLength(2)
    expect(path[0]).toBeInstanceOf(Point)
    expect(path[0]).toMatchObject({ x: 10, y: 21 })
    expect(path[1]).toMatchObject({ x: 90, y: 80 })
  })

  it("types text into the focused field", async () => {
    const { binding, keyboard } = makeBinding()
    const helper = new InputAutomationHelper(() => binding)

    await helper.typeText("discover weekly")

    expect(keyboard.type).toHaveBeenCalledWith("discover weekly")
  })

  describe("clickThenType", () => {
    it("waits for focus to move before typing", async () => {
      // macOS activates the clicked application asynchronously. Typing with no
      // gap delivers the keystrokes to whatever had focus before the click —
      // in autopilot that is Quip's own panel, which the user just clicked to
      // approve the step, so the text vanishes silently.
      const { binding, mouse, keyboard } = makeBinding()
      const order: string[] = []
      const sleep = vi.fn(async (ms: number) => {
        order.push(`sleep:${ms}`)
      })
      mouse.leftClick.mockImplementation(async () => {
        order.push("click")
      })
      keyboard.type.mockImplementation(async () => {
        order.push("type")
      })

      const helper = new InputAutomationHelper(() => binding, sleep)
      await helper.clickThenType({ x: 10, y: 20 }, "marvel", 250)

      expect(order).toEqual(["click", "sleep:250", "type"])
      expect(keyboard.type).toHaveBeenCalledWith("marvel")
    })

    it("still clicks when there is no text to type", async () => {
      const { binding, mouse, keyboard } = makeBinding()
      const sleep = vi.fn(async () => {})
      const helper = new InputAutomationHelper(() => binding, sleep)

      await helper.clickThenType({ x: 10, y: 20 }, "")

      expect(mouse.leftClick).toHaveBeenCalledTimes(1)
      expect(keyboard.type).not.toHaveBeenCalled()
      expect(sleep).not.toHaveBeenCalled()
    })
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
    await helper.pressKey("enter")

    expect(load).toHaveBeenCalledTimes(1)
  })
})
