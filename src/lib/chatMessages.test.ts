import { describe, expect, it } from "vitest"
import {
  createMessage,
  formatClock,
  formatDuration,
  startsExchange,
  toHistory
} from "./chatMessages"

describe("createMessage", () => {
  it("gives every message a unique id", () => {
    const ids = new Set(
      Array.from({ length: 50 }, () =>
        createMessage({ role: "user", text: "hi", source: "typed" }).id
      )
    )
    expect(ids.size).toBe(50)
  })

  it("defaults the timestamp to now and keeps the fields given", () => {
    const before = Date.now()
    const msg = createMessage({ role: "gemini", text: "yo", source: "voice" })
    expect(msg.at).toBeGreaterThanOrEqual(before)
    expect(msg).toMatchObject({ role: "gemini", text: "yo", source: "voice" })
  })
})

describe("startsExchange", () => {
  const user = createMessage({ role: "user", text: "q", source: "typed" })
  const answer = createMessage({ role: "gemini", text: "a", source: "typed" })
  const note = createMessage({ role: "gemini", text: "n", source: "system" })

  it("is false for the first message so the list has no leading rule", () => {
    expect(startsExchange(undefined, user)).toBe(false)
  })

  it("is true when a user turn follows an answer", () => {
    expect(startsExchange(answer, user)).toBe(true)
  })

  it("is false between a user turn and its own answer", () => {
    expect(startsExchange(user, answer)).toBe(false)
  })

  it("is true for a system notice, which is not part of either exchange", () => {
    expect(startsExchange(answer, note)).toBe(true)
  })

  it("is true for an answer with no user turn before it", () => {
    expect(startsExchange(answer, answer)).toBe(true)
  })
})

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [7, "0:07"],
    [62, "1:02"],
    [600, "10:00"]
  ])("formats %i seconds as %s", (secs, expected) => {
    expect(formatDuration(secs)).toBe(expected)
  })
})

describe("toHistory", () => {
  it("keeps user and assistant turns in order", () => {
    const msgs = [
      createMessage({ role: "user", text: "two sum", source: "typed" }),
      createMessage({ role: "gemini", text: "use a map", source: "typed" })
    ]
    expect(toHistory(msgs)).toEqual([
      { role: "user", text: "two sum" },
      { role: "gemini", text: "use a map" }
    ])
  })

  it("drops system notices, which are app chrome not conversation", () => {
    const msgs = [
      createMessage({
        role: "gemini",
        text: "Switched to x.",
        source: "system"
      }),
      createMessage({ role: "user", text: "hi", source: "typed" })
    ]
    expect(toHistory(msgs)).toEqual([{ role: "user", text: "hi" }])
  })

  it("drops empty turns — placeholders and header-only turns", () => {
    const msgs = [
      createMessage({ role: "user", text: "", source: "screen" }),
      createMessage({ role: "gemini", text: "   ", source: "typed" }),
      createMessage({ role: "user", text: "real", source: "typed" })
    ]
    expect(toHistory(msgs)).toEqual([{ role: "user", text: "real" }])
  })
})

describe("formatClock", () => {
  it("renders a short local time", () => {
    expect(formatClock(new Date(2026, 6, 27, 23, 12).getTime())).toMatch(
      /\d{1,2}:\d{2}/
    )
  })
})
