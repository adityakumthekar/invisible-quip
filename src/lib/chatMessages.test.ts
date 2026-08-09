import { describe, expect, it } from "vitest"
import {
  createMessage,
  formatClock,
  formatDuration,
  lastExchangeStart,
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

  it("keeps both halves of one two-speaker clip in a single exchange", () => {
    const them = createMessage({
      role: "user",
      text: "how would you shard this",
      source: "voice",
      speaker: "them"
    })
    const you = createMessage({
      role: "user",
      text: "one moment",
      source: "voice"
    })
    expect(startsExchange(them, you)).toBe(false)
  })

  it("still opens an exchange when a voice turn follows a typed one", () => {
    const voice = createMessage({ role: "user", text: "q", source: "voice" })
    expect(startsExchange(user, voice)).toBe(true)
  })
})

describe("lastExchangeStart", () => {
  const user = () => createMessage({ role: "user", text: "q", source: "typed" })
  const answer = () =>
    createMessage({ role: "gemini", text: "a", source: "typed" })
  const note = () =>
    createMessage({ role: "gemini", text: "n", source: "system" })

  it("returns 0 for an empty list so the caller can index safely", () => {
    expect(lastExchangeStart([])).toBe(0)
  })

  it("anchors a lone turn on itself", () => {
    expect(lastExchangeStart([user()])).toBe(0)
  })

  it("anchors a pair on the question, not the answer", () => {
    expect(lastExchangeStart([user(), answer()])).toBe(0)
  })

  it("anchors on the newest question once a second exchange opens", () => {
    const msgs = [user(), answer(), user(), answer()]
    expect(lastExchangeStart(msgs)).toBe(2)
  })

  it("anchors on the placeholder turn a stream is still filling in", () => {
    // What the panel sees the instant a turn is sent: the question plus an
    // empty assistant message.
    const msgs = [
      user(),
      answer(),
      user(),
      createMessage({ role: "gemini", text: "", source: "typed" })
    ]
    expect(lastExchangeStart(msgs)).toBe(2)
  })

  it("anchors on a trailing system notice, which opens its own exchange", () => {
    expect(lastExchangeStart([user(), answer(), note()])).toBe(2)
  })

  it("anchors on an answer with no question before it — a screen glance", () => {
    expect(lastExchangeStart([user(), answer(), answer()])).toBe(2)
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

  it("folds a two-speaker clip into one attributed turn", () => {
    const msgs = [
      createMessage({
        role: "user",
        text: "how would you shard this",
        source: "voice",
        speaker: "them"
      }),
      createMessage({ role: "user", text: "by tenant", source: "voice" }),
      createMessage({ role: "gemini", text: "right", source: "voice" })
    ]
    expect(toHistory(msgs)).toEqual([
      {
        role: "user",
        text: "Interviewer: how would you shard this\nMe: by tenant"
      },
      { role: "gemini", text: "right" }
    ])
  })

  it("leaves a run with no interviewer turn unlabelled", () => {
    const msgs = [
      createMessage({ role: "user", text: "one", source: "typed" }),
      createMessage({ role: "user", text: "two", source: "typed" })
    ]
    expect(toHistory(msgs)).toEqual([
      { role: "user", text: "one" },
      { role: "user", text: "two" }
    ])
  })
})

describe("formatClock", () => {
  it("renders a short local time", () => {
    expect(formatClock(new Date(2026, 6, 27, 23, 12).getTime())).toMatch(
      /\d{1,2}:\d{2}/
    )
  })
})
