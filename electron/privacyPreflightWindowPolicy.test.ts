import { describe, expect, it } from "vitest"
import { createPrivacyPreflightWindowOptions } from "./privacyPreflightWindowPolicy"

const bounds = { x: 40, y: 80, width: 160, height: 160 }

describe("privacy preflight test window policy", () => {
  it("creates a small, non-interactive, always-on-top transparent window", () => {
    expect(createPrivacyPreflightWindowOptions(bounds, true)).toMatchObject({
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
        nodeIntegration: false
      }
    })
  })

  it("applies capture protection normally, and disables it only in debug mode", () => {
    expect(createPrivacyPreflightWindowOptions(bounds, true).contentProtection).toBe(true)
    expect(createPrivacyPreflightWindowOptions(bounds, false).contentProtection).toBe(false)
  })
})
