import { describe, expect, it } from "vitest"
import { GLOBAL_ACCELERATORS } from "./shortcutTable"
import { SHORTCUTS } from "../src/lib/shortcuts"

describe("global accelerators", () => {
  it("binds record to a two-key chord macOS actually delivers", () => {
    // Not ⌘/ or ⌥. — see the note in shortcutTable.ts. Punctuation accelerators
    // register without error and then silently never fire.
    expect(GLOBAL_ACCELERATORS.RECORD).toBe("Alt+M")
  })

  it("has no duplicate accelerators", () => {
    const all = Object.values(GLOBAL_ACCELERATORS)
    expect(new Set(all).size).toBe(all.length)
  })

  it("lists record in the UI shortcut list so it is discoverable", () => {
    const record = SHORTCUTS.find((s) => s.action === "Record voice")
    expect(record?.keys).toEqual(["⌥", "M"])
  })

  // New chat clears only the conversation; reset tears down the workspace. They
  // are separate actions, so they must stay separate keys.
  it("binds new chat to its own key, distinct from reset", () => {
    expect(GLOBAL_ACCELERATORS.NEW_CHAT).toBe("CommandOrControl+N")
    expect(GLOBAL_ACCELERATORS.NEW_CHAT).not.toBe(GLOBAL_ACCELERATORS.RESET)
  })

  it("lists new chat in the UI shortcut list so it is discoverable", () => {
    const newChat = SHORTCUTS.find((s) => s.action === "New chat")
    expect(newChat?.keys).toEqual(["⌘", "N"])
  })
})
