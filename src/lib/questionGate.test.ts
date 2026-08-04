import { describe, expect, it } from "vitest"
import {
  isBackchannel,
  normalizeTranscript,
  shouldAnswer,
  wordCount
} from "./questionGate"

describe("normalizeTranscript", () => {
  it("empties the no-speech marker in the shapes a model emits it", () => {
    for (const text of [
      "(no speech)",
      "[no speech]",
      "no speech",
      "  (No Speech).  ",
      "NO SPEECH!"
    ]) {
      expect(normalizeTranscript(text)).toBe("")
    }
  })

  it("keeps real words that merely mention speech", () => {
    expect(normalizeTranscript("no speech recognition experience")).toBe(
      "no speech recognition experience"
    )
  })

  it("trims but otherwise preserves a transcript", () => {
    expect(normalizeTranscript("  How would you shard this?  ")).toBe(
      "How would you shard this?"
    )
  })
})

describe("isBackchannel", () => {
  it("catches the common ones with and without punctuation", () => {
    for (const text of [
      "ok",
      "Okay.",
      "right",
      "Sure!",
      "mm-hmm",
      "mmhmm",
      "uh-huh",
      "got it",
      "Makes sense.",
      "I see",
      "gotcha",
      "Go on.",
      "alright",
      "thanks"
    ]) {
      expect(isBackchannel(text), text).toBe(true)
    }
  })

  it("does not catch a question that opens with one", () => {
    expect(isBackchannel("Okay, so how would you scale this?")).toBe(false)
    expect(isBackchannel("Right, what about writes?")).toBe(false)
  })
})

describe("wordCount", () => {
  it("counts across arbitrary whitespace", () => {
    expect(wordCount("  how   would\nyou  ")).toBe(3)
    expect(wordCount("")).toBe(0)
    expect(wordCount("   ")).toBe(0)
  })
})

describe("shouldAnswer", () => {
  it("answers a real question", () => {
    expect(shouldAnswer("How would you shard this table?")).toBe(true)
  })

  it("refuses an empty or backchannel buffer", () => {
    expect(shouldAnswer("")).toBe(false)
    expect(shouldAnswer("   ")).toBe(false)
    expect(shouldAnswer("mm-hmm")).toBe(false)
    expect(shouldAnswer("Got it.")).toBe(false)
  })

  it("refuses a fragment under the word floor", () => {
    expect(shouldAnswer("So the thing")).toBe(false)
  })

  it("answers once a backchannel is followed by the actual question", () => {
    // The buffer is kept rather than cleared on a failed gate, so this is the
    // shape that reaches the model when someone says "Okay." then pauses.
    expect(shouldAnswer("Okay. How would you shard this?")).toBe(true)
  })
})
