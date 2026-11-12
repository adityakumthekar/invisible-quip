import { describe, expect, it } from "vitest"
import {
  DEAD_AFTER_MS,
  initialLiveListenState,
  isDeviceDead,
  liveListenReducer,
  livePhase,
  pendingText,
  type LiveListenEvent,
  type LiveListenState
} from "./liveListenSession"

const run = (
  events: LiveListenEvent[],
  from: LiveListenState = initialLiveListenState
) => events.reduce(liveListenReducer, from)

const armed = () => run([{ type: "arm" }])

describe("arm and disarm", () => {
  it("arms clean and bumps the epoch", () => {
    const state = armed()
    expect(state.armed).toBe(true)
    expect(state.epoch).toBe(1)
    expect(livePhase(state)).toBe("listening")
  })

  it("clears everything in flight on disarm", () => {
    const state = run([
      { type: "arm" },
      { type: "speech-start" },
      { type: "speech-end", transcribing: true },
      { type: "transcript", epoch: 1, text: "half a question" },
      { type: "disarm" }
    ])
    expect(state.armed).toBe(false)
    expect(state.pending).toEqual([])
    expect(state.transcribing).toBe(0)
    expect(livePhase(state)).toBe("off")
  })

  it("re-arming starts from a clean buffer", () => {
    const state = run([
      { type: "arm" },
      { type: "speech-end", transcribing: true },
      { type: "transcript", epoch: 1, text: "stale" },
      { type: "disarm" },
      { type: "arm" }
    ])
    expect(state.pending).toEqual([])
    expect(state.epoch).toBe(3)
  })

  it("records the failure and stays off", () => {
    const state = run([{ type: "arm" }, { type: "failed", message: "no device" }])
    expect(state.armed).toBe(false)
    expect(state.error).toBe("no device")
    expect(livePhase(state)).toBe("error")
  })
})

describe("stale guards", () => {
  it("drops a transcript from a previous session", () => {
    // The user disarmed while a transcription was in flight. It must not
    // reappear in the buffer of whatever session comes next.
    const state = run([
      { type: "arm" },
      { type: "speech-end", transcribing: true },
      { type: "disarm" },
      { type: "arm" },
      { type: "transcript", epoch: 1, text: "belongs to the old session" }
    ])
    expect(state.pending).toEqual([])
    expect(state.transcribing).toBe(0)
  })

  it("drops a stale failure without decrementing the live counter", () => {
    const state = run([
      { type: "arm" },
      { type: "speech-end", transcribing: true },
      { type: "transcript-failed", epoch: 0 }
    ])
    expect(state.transcribing).toBe(1)
  })

  it("never lets the in-flight count go negative", () => {
    const state = run([
      { type: "arm" },
      { type: "transcript", epoch: 1, text: "unmatched" }
    ])
    expect(state.transcribing).toBe(0)
  })
})

describe("utterance accumulation", () => {
  it("appends transcripts in order and joins them for the prompt", () => {
    const state = run([
      { type: "arm" },
      { type: "speech-end", transcribing: true },
      { type: "transcript", epoch: 1, text: "So how would you" },
      { type: "speech-end", transcribing: true },
      { type: "transcript", epoch: 1, text: "shard this table?" }
    ])
    expect(state.pending).toEqual(["So how would you", "shard this table?"])
    expect(pendingText(state)).toBe("So how would you shard this table?")
  })

  it("does not buffer an empty transcript", () => {
    const state = run([
      { type: "arm" },
      { type: "speech-end", transcribing: true },
      { type: "transcript", epoch: 1, text: "   " }
    ])
    expect(state.pending).toEqual([])
    expect(state.transcribing).toBe(0)
  })

  it("a clip below the duration floor never becomes an in-flight request", () => {
    const state = run([
      { type: "arm" },
      { type: "speech-start" },
      { type: "speech-end", transcribing: false }
    ])
    expect(state.transcribing).toBe(0)
    expect(livePhase(state)).toBe("listening")
  })

  it("clears the buffer on fire and on staleness", () => {
    const base = run([
      { type: "arm" },
      { type: "speech-end", transcribing: true },
      { type: "transcript", epoch: 1, text: "a question" }
    ])
    expect(liveListenReducer(base, { type: "fired" }).pending).toEqual([])
    expect(liveListenReducer(base, { type: "clear-pending" }).pending).toEqual(
      []
    )
  })
})

describe("livePhase precedence", () => {
  it("shows that it heard them over anything else it is doing", () => {
    // The interviewer interrupting mid-answer is the case this exists for.
    const state = run([
      { type: "arm" },
      { type: "speech-end", transcribing: true },
      { type: "fired" },
      { type: "speech-start" }
    ])
    expect(state.answering).toBe(true)
    expect(state.transcribing).toBe(1)
    expect(livePhase(state)).toBe("speaking")
  })

  it("shows transcribing over answering", () => {
    const state = run([
      { type: "arm" },
      { type: "fired" },
      { type: "speech-end", transcribing: true }
    ])
    expect(livePhase(state)).toBe("transcribing")
  })

  it("returns to listening once the answer lands", () => {
    const state = run([
      { type: "arm" },
      { type: "fired" },
      { type: "answer-done" }
    ])
    expect(livePhase(state)).toBe("listening")
  })

  it("error outranks armed", () => {
    const state = run([{ type: "arm" }, { type: "failed", message: "boom" }])
    expect(livePhase(state)).toBe("error")
  })
})

describe("isDeviceDead", () => {
  it("reports an unrouted device only after the grace period", () => {
    const state = armed()
    expect(isDeviceDead(state, DEAD_AFTER_MS - 1)).toBe(false)
    expect(isDeviceDead(state, DEAD_AFTER_MS)).toBe(true)
  })

  it("stays quiet once any real sample has arrived", () => {
    const state = run([{ type: "arm" }, { type: "signal" }])
    expect(isDeviceDead(state, DEAD_AFTER_MS * 10)).toBe(false)
  })

  it("says nothing while disarmed", () => {
    expect(isDeviceDead(initialLiveListenState, DEAD_AFTER_MS * 10)).toBe(false)
  })
})
