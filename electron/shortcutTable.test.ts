import { describe, expect, it } from "vitest"
import { GLOBAL_ACCELERATORS } from "./shortcutTable"
import { SHORTCUTS } from "../src/lib/shortcuts"

describe("global accelerators", () => {
  it("binds record to a key macOS actually delivers", () => {
    // Not ⌘/ — see the note in shortcutTable.ts. Punctuation accelerators
    // register without error and then silently never fire.
    expect(GLOBAL_ACCELERATORS.RECORD).toBe("CommandOrControl+Shift+M")
  })

  it("has no duplicate accelerators", () => {
    const all = Object.values(GLOBAL_ACCELERATORS)
    expect(new Set(all).size).toBe(all.length)
  })

  it("lists record in the UI shortcut list so it is discoverable", () => {
    const record = SHORTCUTS.find((s) => s.action === "Record voice")
    expect(record?.keys).toEqual(["⌘", "⇧", "M"])
  })
})
