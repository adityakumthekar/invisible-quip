import { describe, expect, it } from "vitest"
import {
  ANCHOR_MAX_CHARS,
  flattenHistory,
  HISTORY_MAX_CHARS,
  HISTORY_MAX_TURNS,
  OLLAMA_MAX_CHARS,
  toGeminiHistory
} from "./chatHistory"

const turn = (role: "user" | "assistant", text: string) => ({ role, text })

/** A session that blows the budget several times over: n exchanges of code-sized answers. */
const longSession = (exchanges: number) =>
  Array.from({ length: exchanges }, (_, i) => [
    turn("user", `question ${i}`),
    turn("assistant", `answer ${i} `.padEnd(2000, "x"))
  ]).flat()

describe("toGeminiHistory", () => {
  it("maps the assistant role to Gemini's 'model'", () => {
    expect(toGeminiHistory([turn("user", "q"), turn("assistant", "a")])).toEqual([
      { role: "user", parts: [{ text: "q" }] },
      { role: "model", parts: [{ text: "a" }] }
    ])
  })

  it("drops leading model turns, which open a malformed conversation", () => {
    const out = toGeminiHistory([
      turn("assistant", "orphan answer"),
      turn("user", "q")
    ])
    expect(out).toEqual([{ role: "user", parts: [{ text: "q" }] }])
  })

  it("keeps the most recent turns when over the turn cap", () => {
    const many = Array.from({ length: HISTORY_MAX_TURNS + 6 }, (_, i) =>
      turn(i % 2 === 0 ? "user" : "assistant", `m${i}`)
    )
    const out = toGeminiHistory(many)
    expect(out.length).toBeLessThanOrEqual(HISTORY_MAX_TURNS)
    expect(out[out.length - 1].parts[0].text).toBe(`m${many.length - 1}`)
  })

  it("keeps the most recent turns when over the character budget", () => {
    const big = "x".repeat(HISTORY_MAX_CHARS)
    const out = toGeminiHistory([
      turn("user", big),
      turn("assistant", big),
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

describe("the anchored opening turn", () => {
  it("keeps the first question through a session that outruns the budget", () => {
    const session = longSession(20)
    const out = toGeminiHistory(session)

    // The premise every later "now make it faster" refers to.
    expect(out[0]).toEqual({ role: "user", parts: [{ text: "question 0" }] })
    expect(out[out.length - 1].parts[0].text).toBe(
      session[session.length - 1].text
    )
  })

  it("stays inside both budgets while anchored", () => {
    const out = toGeminiHistory(longSession(20))
    const chars = out.reduce((n, c) => n + c.parts[0].text.length, 0)
    expect(chars).toBeLessThanOrEqual(HISTORY_MAX_CHARS)
    expect(out.length).toBeLessThanOrEqual(HISTORY_MAX_TURNS)
  })

  it("truncates a pasted-essay opening so it can't eat the budget", () => {
    const essay = "P".repeat(ANCHOR_MAX_CHARS * 4)
    const out = toGeminiHistory([turn("user", essay), ...longSession(20)])

    expect(out[0].parts[0].text).toBe("P".repeat(ANCHOR_MAX_CHARS))
    const chars = out.reduce((n, c) => n + c.parts[0].text.length, 0)
    expect(chars).toBeLessThanOrEqual(HISTORY_MAX_CHARS)
  })

  it("does not repeat the opening turn when it still fits on its own", () => {
    const short = [
      turn("user", "reverse a linked list"),
      turn("assistant", "iterative, O(n)"),
      turn("user", "now do it recursively")
    ]
    expect(toGeminiHistory(short).map((c) => c.parts[0].text)).toEqual([
      "reverse a linked list",
      "iterative, O(n)",
      "now do it recursively"
    ])
  })

  it("never puts an unrelated answer directly after the anchor", () => {
    // Trimming lands mid-exchange, so the window opens on an answer.
    const out = toGeminiHistory(longSession(20))
    expect(out[1].role).toBe("user")
  })
})

describe("flattenHistory", () => {
  it("labels each turn for models that take one prompt string", () => {
    expect(flattenHistory([turn("user", "q"), turn("assistant", "a")])).toBe(
      "User: q\nAssistant: a"
    )
  })

  it("is empty for no history, so nothing is prepended", () => {
    expect(flattenHistory([])).toBe("")
  })

  it("stays on the narrow budget, since Ollama gets no num_ctx", () => {
    const out = flattenHistory(longSession(20))
    expect(out.length).toBeLessThanOrEqual(
      OLLAMA_MAX_CHARS + "User: Assistant: ".length * HISTORY_MAX_TURNS
    )
    expect(out.startsWith("User: question 0")).toBe(true)
  })
})
