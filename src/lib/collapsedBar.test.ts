import { beforeEach, describe, expect, it } from "vitest"
import { getBarCollapsed, setBarCollapsed } from "./collapsedBar"

// vitest runs in the node environment (vitest.config.ts), so there is no
// localStorage here — a minimal in-memory stand-in is enough for these.
function installStorage(): Map<string, string> {
  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    }
  }
  return store
}

describe("collapsed bar preference", () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installStorage()
  })

  it("defaults to expanded when nothing is stored", () => {
    expect(getBarCollapsed()).toBe(false)
  })

  it("round-trips both states", () => {
    setBarCollapsed(true)
    expect(getBarCollapsed()).toBe(true)

    setBarCollapsed(false)
    expect(getBarCollapsed()).toBe(false)
  })

  it("treats a garbage stored value as expanded", () => {
    store.set("quipBarCollapsed", "yes")
    expect(getBarCollapsed()).toBe(false)
  })
})
