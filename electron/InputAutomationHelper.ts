// InputAutomationHelper.ts
//
// Thin wrapper around @nut-tree-fork/nut-js for OS-level mouse/keyboard input.
// The native binding is loaded lazily (and injectably) so a missing/unbuilt
// module can never crash app startup and so the wrapper stays unit-testable.

import type { ScrollDirection } from "./teachingContract"

export interface InputPoint {
  x: number
  y: number
}

/** The minimal surface of @nut-tree-fork/nut-js that we depend on. */
export interface NutBinding {
  mouse: {
    setPosition: (target: unknown) => Promise<unknown>
    leftClick: () => Promise<unknown>
    rightClick: () => Promise<unknown>
    doubleClick: (button: unknown) => Promise<unknown>
    scrollUp: (amount: number) => Promise<unknown>
    scrollDown: (amount: number) => Promise<unknown>
    scrollLeft: (amount: number) => Promise<unknown>
    scrollRight: (amount: number) => Promise<unknown>
    drag: (path: unknown) => Promise<unknown>
    config: { autoDelayMs: number }
  }
  keyboard: {
    type: (...input: unknown[]) => Promise<unknown>
    pressKey: (...keys: unknown[]) => Promise<unknown>
    releaseKey: (...keys: unknown[]) => Promise<unknown>
    config: { autoDelayMs: number }
  }
  Point: new (x: number, y: number) => unknown
  Button: Record<string, unknown>
  Key: Record<string, unknown>
}

export type NutLoader = () => NutBinding
export type Sleep = (ms: number) => Promise<void>

const defaultLoader: NutLoader = () =>
  // Lazy require so a missing native binding never crashes app startup.
  require("@nut-tree-fork/nut-js") as NutBinding

const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * How long to wait after clicking a field in another application before typing
 * into it. macOS activates the clicked app asynchronously, so keystrokes sent
 * immediately are delivered to whatever had focus beforehand — which, in an
 * autopilot run, is Quip's own panel. Override with QUIP_FOCUS_SETTLE_MS.
 */
export const DEFAULT_FOCUS_SETTLE_MS =
  Number(process.env.QUIP_FOCUS_SETTLE_MS) || 250

/** Our normalized modifier tokens → nut-js `Key` enum member names. */
const MODIFIER_KEY_NAMES: Record<string, string> = {
  cmd: "LeftCmd",
  command: "LeftCmd",
  ctrl: "LeftControl",
  control: "LeftControl",
  alt: "LeftAlt",
  option: "LeftAlt",
  shift: "LeftShift",
  meta: "LeftSuper"
}

/** Our normalized named keys → nut-js `Key` enum member names. */
const NAMED_KEY_NAMES: Record<string, string> = {
  enter: "Enter",
  return: "Return",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  space: "Space",
  backspace: "Backspace",
  delete: "Delete",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown"
}

/**
 * Translate a combo already normalized by `parseKeyCombo` ("cmd+a", "enter")
 * into nut-js `Key` member names, modifiers first. Exported for testing —
 * this mapping is the part most likely to drift against the enum.
 */
export function keyComboToKeyNames(combo: string): string[] {
  const tokens = combo.split("+")
  const main = tokens[tokens.length - 1]
  const modifiers = tokens.slice(0, -1)

  const names = modifiers.map((modifier) => {
    const name = MODIFIER_KEY_NAMES[modifier]
    if (!name) {
      throw new Error(`Unsupported key modifier: ${modifier}`)
    }
    return name
  })

  if (NAMED_KEY_NAMES[main]) {
    names.push(NAMED_KEY_NAMES[main])
  } else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(main)) {
    names.push(main.toUpperCase())
  } else if (/^[a-z]$/.test(main)) {
    names.push(main.toUpperCase())
  } else if (/^[0-9]$/.test(main)) {
    names.push(`Num${main}`)
  } else {
    throw new Error(`Unsupported key: ${main}`)
  }

  return names
}

export class InputAutomationHelper {
  private binding: NutBinding | null = null

  constructor(
    private readonly load: NutLoader = defaultLoader,
    private readonly sleep: Sleep = defaultSleep,
    private readonly check: () => void = () => {}
  ) {}

  private nut(): NutBinding {
    if (!this.binding) {
      let binding: NutBinding
      try {
        binding = this.load()
      } catch (error: any) {
        throw new Error(
          `Input automation is unavailable: ${error?.message ?? error}. ` +
            "Reinstall dependencies so the native input module is built for Electron."
        )
      }
      // The action was already approved (by a human, or by the autopilot risk
      // policy), so don't pad it with delays.
      binding.mouse.config.autoDelayMs = 0
      binding.keyboard.config.autoDelayMs = 0
      this.binding = binding
    }
    return this.binding
  }

  private point(nut: NutBinding, point: InputPoint): unknown {
    return new nut.Point(Math.round(point.x), Math.round(point.y))
  }

  /**
   * Look up an enum member by name. `Button.LEFT` and `Key.Escape` are both 0,
   * so this must test for undefined rather than falsiness.
   */
  private enumValue(
    table: Record<string, unknown>,
    name: string,
    kind: string
  ): unknown {
    const value = table[name]
    if (value === undefined) {
      throw new Error(`Input automation does not support ${kind} "${name}"`)
    }
    return value
  }

  private async moveTo(nut: NutBinding, point: InputPoint): Promise<void> {
    await nut.mouse.setPosition(this.point(nut, point))
  }

  /** Move the cursor to `point` (rounded to whole pixels) and left-click. */
  public async clickAt(point: InputPoint): Promise<void> {
    this.check()
    const nut = this.nut()
    await this.moveTo(nut, point)
    this.check()
    await nut.mouse.leftClick()
  }

  public async doubleClickAt(point: InputPoint): Promise<void> {
    this.check()
    const nut = this.nut()
    await this.moveTo(nut, point)
    this.check()
    await nut.mouse.doubleClick(this.enumValue(nut.Button, "LEFT", "button"))
  }

  public async rightClickAt(point: InputPoint): Promise<void> {
    this.check()
    const nut = this.nut()
    await this.moveTo(nut, point)
    this.check()
    await nut.mouse.rightClick()
  }

  /** Park the cursor over `point` first, so the scroll lands in that pane. */
  public async scrollAt(
    point: InputPoint,
    direction: ScrollDirection,
    amount: number
  ): Promise<void> {
    this.check()
    const nut = this.nut()
    await this.moveTo(nut, point)
    this.check()

    const steps = Math.max(1, Math.round(amount))
    switch (direction) {
      case "up":
        await nut.mouse.scrollUp(steps)
        return
      case "down":
        await nut.mouse.scrollDown(steps)
        return
      case "left":
        await nut.mouse.scrollLeft(steps)
        return
      case "right":
        await nut.mouse.scrollRight(steps)
        return
    }
  }

  /** Press and hold a modifier chain, then release it in the same order. */
  public async pressKey(combo: string): Promise<void> {
    this.check()
    const nut = this.nut()
    const keys = keyComboToKeyNames(combo).map((name) =>
      this.enumValue(nut.Key, name, "key")
    )

    await nut.keyboard.pressKey(...keys)
    await nut.keyboard.releaseKey(...keys)
  }

  /** Press at `from`, move to `to`, release. */
  public async dragTo(from: InputPoint, to: InputPoint): Promise<void> {
    this.check()
    const nut = this.nut()
    await this.moveTo(nut, from)
    this.check()
    await nut.mouse.drag([this.point(nut, from), this.point(nut, to)])
  }

  /** Type `text` into whatever currently has keyboard focus. */
  public async typeText(text: string): Promise<void> {
    this.check()
    const nut = this.nut()
    await nut.keyboard.type(text)
  }

  /**
   * Click a field, wait for the OS to move keyboard focus there, then type.
   *
   * The wait is the whole point: `autoDelayMs` is 0 so approved actions fire
   * without padding, but that makes the click and the keystrokes effectively
   * simultaneous. Focus changes are asynchronous, so the text would otherwise
   * be delivered to the previously-focused window and silently lost.
   */
  public async clickThenType(
    point: InputPoint,
    text: string,
    settleMs: number = DEFAULT_FOCUS_SETTLE_MS
  ): Promise<void> {
    await this.clickAt(point)
    if (!text) {
      return
    }
    await this.sleep(settleMs)
    await this.typeText(text)
  }
}
