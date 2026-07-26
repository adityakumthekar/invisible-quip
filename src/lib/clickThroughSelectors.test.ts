import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * The set of surfaces that receive mouse events is declared twice: once in CSS
 * (the `pointer-events: auto` rule that beats the blanket `#root *` rule) and
 * once in TypeScript (HIT_SELECTOR, which drives Electron's setIgnoreMouseEvents
 * hit-testing). If they drift, a surface renders normally but silently stops
 * being clickable — the window just passes the click through to whatever is
 * behind it, which is very hard to trace back to a stylesheet edit.
 */
const root = path.resolve(__dirname, "../..")
const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8")
const hook = fs.readFileSync(path.join(root, "src/hooks/useClickThrough.ts"), "utf8")

function hitSelectorClasses(): string[] {
  const match = hook.match(/const HIT_SELECTOR\s*=\s*([\s\S]*?)\n\n/)
  if (!match) throw new Error("Could not find HIT_SELECTOR in useClickThrough.ts")
  return [...match[1].matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1])
}

function pointerEventsAutoClasses(): string[] {
  // The rule listing every clickable surface, ending in `pointer-events: auto`.
  const match = css.match(/((?:#root [^{]+,\s*)+#root [^{]+)\{\s*pointer-events:\s*auto/)
  if (!match) throw new Error("Could not find the pointer-events:auto rule in index.css")
  return [...match[1].matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1])
}

describe("click-through surface selectors", () => {
  it("finds a non-empty selector list in both files", () => {
    expect(hitSelectorClasses().length).toBeGreaterThan(0)
    expect(pointerEventsAutoClasses().length).toBeGreaterThan(0)
  })

  it("every hit-tested surface is also clickable in CSS", () => {
    const css = new Set(pointerEventsAutoClasses())
    const missing = hitSelectorClasses().filter((c) => !css.has(c))
    expect(missing).toEqual([])
  })

  it("every CSS-clickable surface is also hit-tested", () => {
    const hit = new Set(hitSelectorClasses())
    const missing = pointerEventsAutoClasses().filter((c) => !hit.has(c))
    expect(missing).toEqual([])
  })
})
