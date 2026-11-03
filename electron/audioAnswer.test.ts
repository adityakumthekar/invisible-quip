import { describe, expect, it } from "vitest"
import { parseAudioAnswer, parseTranscriptTurns, createAnswerSplitter } from "./audioAnswer"

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

  it("keeps every labelled turn of a two-speaker transcript", () => {
    const raw = [
      "TRANSCRIPT: THEM: How would you shard this?",
      "YOU: Give me a second.",
      "ANSWER: Shard by tenant id."
    ].join("\n")
    expect(parseAudioAnswer(raw).transcript).toBe(
      "THEM: How would you shard this?\nYOU: Give me a second."
    )
  })
})

describe("parseTranscriptTurns", () => {
  it("attributes an unlabelled transcript to the user", () => {
    expect(parseTranscriptTurns("two sum in python")).toEqual([
      { speaker: "you", text: "two sum in python" }
    ])
  })

  it("splits on speaker labels", () => {
    const transcript = ["THEM: How would you shard this?", "YOU: One moment."].join(
      "\n"
    )
    expect(parseTranscriptTurns(transcript)).toEqual([
      { speaker: "them", text: "How would you shard this?" },
      { speaker: "you", text: "One moment." }
    ])
  })

  it("accepts the interviewer/me aliases and any casing", () => {
    const transcript = ["interviewer: your turn", "  Me:  ok"].join("\n")
    expect(parseTranscriptTurns(transcript)).toEqual([
      { speaker: "them", text: "your turn" },
      { speaker: "you", text: "ok" }
    ])
  })

  it("folds an unlabelled continuation into the open turn", () => {
    const transcript = [
      "THEM: Walk me through it.",
      "Take your time.",
      "YOU: Sure."
    ].join("\n")
    expect(parseTranscriptTurns(transcript)).toEqual([
      { speaker: "them", text: "Walk me through it.\nTake your time." },
      { speaker: "you", text: "Sure." }
    ])
  })

  it("treats text before the first label as the user speaking", () => {
    const transcript = ["hey quip", "THEM: go on"].join("\n")
    expect(parseTranscriptTurns(transcript)).toEqual([
      { speaker: "you", text: "hey quip" },
      { speaker: "them", text: "go on" }
    ])
  })

  it("drops empty and no-speech turns", () => {
    const transcript = ["YOU: (no speech)", "THEM: ", "THEM: real question"].join(
      "\n"
    )
    expect(parseTranscriptTurns(transcript)).toEqual([
      { speaker: "them", text: "real question" }
    ])
  })

  it("returns nothing for an empty transcript", () => {
    expect(parseTranscriptTurns("")).toEqual([])
    expect(parseTranscriptTurns("   \n  ")).toEqual([])
  })
})

describe("createAnswerSplitter", () => {
  function run(deltas: string[]) {
    const events: string[] = []
    const splitter = createAnswerSplitter({
      onTranscript: (t) => events.push(`T:${t}`),
      onAnswerDelta: (d) => events.push(`A:${d}`)
    })
    deltas.forEach((d) => splitter.push(d))
    const result = splitter.finish()
    return { events, result }
  }

  it("holds everything until the label, then announces the transcript first", () => {
    const { events, result } = run([
      "TRANSCRIPT: two sum?\nANS",
      "WER:  Use a ",
      "hash map."
    ])
    expect(events).toEqual(["T:two sum?", "A:Use a ", "A:hash map."])
    expect(result).toEqual({ transcript: "two sum?", answer: "Use a hash map." })
  })

  it("keeps dual-speaker transcripts intact for turn parsing", () => {
    const { events } = run(["TRANSCRIPT:\nTHEM: why?\nYOU: hmm\nANSWER: because"])
    expect(events[0]).toBe("T:THEM: why?\nYOU: hmm")
    expect(events.slice(1)).toEqual(["A:because"])
  })

  it("reports no speech as an empty transcript", () => {
    const { events } = run(["TRANSCRIPT: (no speech)\nANSWER: Nothing was said."])
    expect(events).toEqual(["T:", "A:Nothing was said."])
  })

  it("falls back to all-answer at finish when the label never comes", () => {
    const { events, result } = run(["Just an ", "answer."])
    expect(events).toEqual(["T:", "A:Just an answer."])
    expect(result.answer).toBe("Just an answer.")
  })
})
