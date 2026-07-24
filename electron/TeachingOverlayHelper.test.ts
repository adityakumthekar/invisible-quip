import { beforeEach, describe, expect, it, vi } from "vitest"

// Mimic Electron's real behavior: after a BrowserWindow is destroyed, its
// `webContents` accessor throws "Object has been destroyed", and `destroy()`
// emits the "closed" event synchronously from within the destroy call.
const bwState = vi.hoisted(() => {
  const { EventEmitter } = require("node:events") as typeof import("node:events")

  class FakeWebContents {
    send(): void {}
  }

  class FakeBrowserWindow extends EventEmitter {
    static instances: FakeBrowserWindow[] = []
    destroyed = false
    private readonly _webContents = new FakeWebContents()

    constructor(public readonly options: unknown) {
      super()
      FakeBrowserWindow.instances.push(this)
    }

    get webContents(): FakeWebContents {
      if (this.destroyed) {
        throw new Error("Object has been destroyed")
      }
      return this._webContents
    }

    setBounds(): void {}
    showInactive(): void {}
    hide(): void {}
    setIgnoreMouseEvents(): void {}
    setContentProtection(): void {}
    setVisibleOnAllWorkspaces(): void {}
    setAlwaysOnTop(): void {}
    loadURL(): Promise<void> {
      return Promise.resolve()
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    destroy(): void {
      if (this.destroyed) {
        return
      }
      this.destroyed = true
      this.emit("closed")
    }
  }

  return { FakeBrowserWindow }
})

vi.mock("electron", () => ({ BrowserWindow: bwState.FakeBrowserWindow }))

import { TeachingOverlayHelper } from "./TeachingOverlayHelper"

const stepResult = {
  state: "step" as const,
  instruction: "Click Share.",
  label: "Share",
  action: "click" as const,
  target: { x: 1540, y: -50, width: 40, height: 20 },
  displayId: 7,
  displayBounds: { x: 1440, y: -100, width: 1280, height: 800 }
}

describe("TeachingOverlayHelper", () => {
  beforeEach(() => {
    bwState.FakeBrowserWindow.instances.length = 0
  })

  it("closes without touching webContents on the destroyed window", () => {
    const helper = new TeachingOverlayHelper()
    helper.showTarget(stepResult)

    expect(() => helper.close()).not.toThrow()
    expect(bwState.FakeBrowserWindow.instances[0].isDestroyed()).toBe(true)
  })

  it("handles a window closed externally without throwing in the closed handler", () => {
    const helper = new TeachingOverlayHelper()
    helper.showTarget(stepResult)

    const overlayWindow = bwState.FakeBrowserWindow.instances[0]
    expect(() => overlayWindow.destroy()).not.toThrow()
  })
})
