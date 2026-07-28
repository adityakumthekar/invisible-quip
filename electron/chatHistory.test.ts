import { describe, expect, it } from "vitest"
import {
  flattenHistory,
  HISTORY_MAX_CHARS,
  HISTORY_MAX_TURNS,
  toGeminiHistory
} from "./chatHistory"

const turn = (role: "user" | "gemini", text: string) => ({ role, text })

describe("toGeminiHistory", () => {
  it("maps the assistant role to Gemini's 'model'", () => {
    expect(toGeminiHistory([turn("user", "q"), turn("gemini", "a")])).toEqual([
      { role: "user", parts: [{ text: "q" }] },
      { role: "model", parts: [{ text: "a" }] }
    ])
  })

  it("drops leading model turns, which open a malformed conversation", () => {
    const out = toGeminiHistory([
      turn("gemini", "orphan answer"),
      turn("user", "q")
    ])
    expect(out).toEqual([{ role: "user", parts: [{ text: "q" }] }])
  })

  it("keeps the most recent turns when over the turn cap", () => {
    const many = Array.from({ length: HISTORY_MAX_TURNS + 6 }, (_, i) =>
      turn(i % 2 === 0 ? "user" : "gemini", `m${i}`)
    )
    const out = toGeminiHistory(many)
    expect(out.length).toBeLessThanOrEqual(HISTORY_MAX_TURNS)
    expect(out[out.length - 1].parts[0].text).toBe(`m${many.length - 1}`)
  })

  it("keeps the most recent turns when over the character budget", () => {
    const big = "x".repeat(HISTORY_MAX_CHARS)
    const out = toGeminiHistory([
      turn("user", big),
      turn("gemini", big),
      turn("user", "latest")
    ])
    const chars = out.reduce((n, c) => n + c.parts[0].text.length, 0)
    expect(chars).toBeLessThanOrEqual(HISTORY_MAX_CHARS)
    expect(out[out.length - 1].parts[0].text).toBe("latest")
  })

  it("returns nothing for an empty transcript", () => {
    expect(toGeminiHistory([])).toEqual([])
  })
})

describe("flattenHistory", () => {
  it("labels each turn for models that take one prompt string", () => {
    expect(flattenHistory([turn("user", "q"), turn("gemini", "a")])).toBe(
      "User: q\nAssistant: a"
    )
  })

  it("is empty for no history, so nothing is prepended", () => {
    expect(flattenHistory([])).toBe("")
  })
})
