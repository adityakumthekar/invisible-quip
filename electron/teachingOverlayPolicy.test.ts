import { describe, expect, it } from "vitest"
import {
  createTeachingOverlayEventData,
  createTeachingOverlayWindowOptions,
  globalDipTargetToOverlayLocal
} from "./teachingOverlayPolicy"

const bounds = { x: 1440, y: -100, width: 1280, height: 800 }

describe("teaching overlay coordinate policy", () => {
  it("converts a global DIP rectangle to display-local coordinates once", () => {
    expect(
      globalDipTargetToOverlayLocal(
        { x: 1540, y: -50, width: 40, height: 20 },
        bounds
      )
    ).toEqual({ x: 100, y: 50, width: 40, height: 20 })
  })

  it("creates narrowly scoped renderer event data in local DIP coordinates", () => {
    expect(
      createTeachingOverlayEventData({
        state: "step",
        instruction: "Click Share.",
        label: "Share",
        target: { x: 1540, y: -50, width: 40, height: 20 },
        displayId: 7,
        displayBounds: bounds
      })
    ).toEqual({
      instruction: "Click Share.",
      label: "Share",
      target: { x: 100, y: 50, width: 40, height: 20 }
    })
  })
})

describe("teaching overlay window policy", () => {
  it("creates a full-display non-interactive transparent overlay", () => {
    expect(
      createTeachingOverlayWindowOptions(bounds, true, "/tmp/preload.js")
    ).toMatchObject({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      fullscreenable: false,
      resizable: false,
      movable: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: "/tmp/preload.js"
      }
    })
  })

  it("preserves INVISIBLE=false as capturable debug policy", () => {
    expect(
      createTeachingOverlayWindowOptions(bounds, false, "/tmp/preload.js")
        .contentProtection
    ).toBe(false)
    expect(
      createTeachingOverlayWindowOptions(bounds, true, "/tmp/preload.js")
        .contentProtection
    ).toBe(true)
  })
})
