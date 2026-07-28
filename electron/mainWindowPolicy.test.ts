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

  it("is capturable in INVISIBLE=false debug mode", () => {
    const options = createMainWindowOptions(false, "/tmp/preload.js")

    expect(options.contentProtection).toBe(false)
  })

  it("keeps the frameless, transparent chrome in debug mode so the pill floats free", () => {
    const stealth = createMainWindowOptions(true, "/tmp/preload.js")
    const debug = createMainWindowOptions(false, "/tmp/preload.js")

    expect(debug.frame).toBe(false)
    expect(debug.transparent).toBe(true)
    expect(debug.hasShadow).toBe(false)
    expect(debug.backgroundColor).toBe("#00000000")

    // contentProtection is the only field the mode is allowed to change.
    expect({ ...debug, contentProtection: stealth.contentProtection }).toEqual(stealth)
  })
})
