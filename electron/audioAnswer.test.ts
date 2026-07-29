import { describe, expect, it } from "vitest"
import { parseAudioAnswer } from "./audioAnswer"

describe("parseAudioAnswer", () => {
  it("splits the two labelled sections", () => {
    const raw = [
      "TRANSCRIPT: How would you reverse a linked list?",
      "ANSWER: Walk the list once, rewiring each next pointer."
    ].join("\n")
    expect(parseAudioAnswer(raw)).toEqual({
      transcript: "How would you reverse a linked list?",
      answer: "Walk the list once, rewiring each next pointer."
    })
  })

  it("keeps a multi-line answer intact, including code fences", () => {
    const raw = [
      "TRANSCRIPT: two sum in python",
      "ANSWER: Use a seen-map.",
      "",
      "```python",
      "def two_sum(nums, target):",
      "    return []",
      "```"
    ].join("\n")
    const { answer } = parseAudioAnswer(raw)
    expect(answer).toContain("```python")
    expect(answer).toContain("def two_sum")
    expect(answer.startsWith("Use a seen-map.")).toBe(true)
  })

  it("tolerates lowercase labels and extra whitespace", () => {
    const raw = "  transcript:  hello there \n\n answer:  hi \n"
    expect(parseAudioAnswer(raw)).toEqual({
      transcript: "hello there",
      answer: "hi"
    })
  })

  it("falls back to the whole reply when the model ignores the format", () => {
    expect(parseAudioAnswer("Just an answer, no labels.")).toEqual({
      transcript: "",
      answer: "Just an answer, no labels."
    })
  })

  it("returns an empty transcript when nothing was said", () => {
    const raw = "TRANSCRIPT: (no speech)\nANSWER: I couldn't hear anything."
    expect(parseAudioAnswer(raw).transcript).toBe("")
  })
})
