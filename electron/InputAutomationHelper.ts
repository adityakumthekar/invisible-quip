// InputAutomationHelper.ts
//
// Thin wrapper around @nut-tree-fork/nut-js for OS-level mouse/keyboard input.
// The native binding is loaded lazily (and injectably) so a missing/unbuilt
// module can never crash app startup and so the wrapper stays unit-testable.

export interface InputPoint {
  x: number
  y: number
}

/** The minimal surface of @nut-tree-fork/nut-js that we depend on. */
export interface NutBinding {
  mouse: {
    setPosition: (target: unknown) => Promise<unknown>
    leftClick: () => Promise<unknown>
    config: { autoDelayMs: number }
  }
  keyboard: {
    type: (...input: unknown[]) => Promise<unknown>
    config: { autoDelayMs: number }
  }
  Point: new (x: number, y: number) => unknown
}

export type NutLoader = () => NutBinding

const defaultLoader: NutLoader = () =>
  // Lazy require so a missing native binding never crashes app startup.
  require("@nut-tree-fork/nut-js") as NutBinding

export class InputAutomationHelper {
  private binding: NutBinding | null = null

  constructor(private readonly load: NutLoader = defaultLoader) {}

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
      // The human already confirmed this action, so don't pad it with delays.
      binding.mouse.config.autoDelayMs = 0
      binding.keyboard.config.autoDelayMs = 0
      this.binding = binding
    }
    return this.binding
  }

  /** Move the cursor to `point` (rounded to whole pixels) and left-click. */
  public async clickAt(point: InputPoint): Promise<void> {
    const nut = this.nut()
    await nut.mouse.setPosition(
      new nut.Point(Math.round(point.x), Math.round(point.y))
    )
    await nut.mouse.leftClick()
  }

  /** Type `text` into whatever currently has keyboard focus. */
  public async typeText(text: string): Promise<void> {
    const nut = this.nut()
    await nut.keyboard.type(text)
  }
}
