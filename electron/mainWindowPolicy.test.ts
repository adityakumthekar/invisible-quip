import { describe, expect, it } from "vitest"
import { createMainWindowOptions } from "./mainWindowPolicy"

describe("main window stealth policy", () => {
  it("hides the window from capture and drops chrome in normal (invisible) mode", () => {
    const options = createMainWindowOptions(true, "/tmp/preload.js")

    expect(options.contentProtection).toBe(true)
    expect(options.frame).toBe(false)
    expect(options.transparent).toBe(true)
    expect(options.hasShadow).toBe(false)
    expect(options.backgroundColor).toBe("#00000000")
    expect(options.webPreferences).toMatchObject({ preload: "/tmp/preload.js" })
  })

  it("is capturable with normal chrome only in INVISIBLE=false debug mode", () => {
    const options = createMainWindowOptions(false, "/tmp/preload.js")

    expect(options.contentProtection).toBe(false)
    expect(options.frame).toBe(true)
    expect(options.transparent).toBe(false)
    expect(options.hasShadow).toBe(true)
    expect(options.backgroundColor).toBe("#1a1a1a")
  })
})
