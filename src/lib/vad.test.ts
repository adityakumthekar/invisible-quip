import { describe, expect, it } from "vitest"
import {
  DEFAULT_VAD_CONFIG,
  FRAME_MS,
  createVad,
  isDigitalSilence,
  rms,
  type VadEvent
} from "./vad"

const LOUD = 0.3
const QUIET = 0

/** Push a run of levels and return every non-"none" event, in order. */
const drive = (vad: ReturnType<typeof createVad>, levels: number[]) => {
  const events: VadEvent[] = []
  for (const level of levels) {
    const event = vad.push(level)
    if (event.type !== "none") events.push(event)
  }
  return events
}

const repeat = (level: number, count: number) => Array(count).fill(level)

const utterance = (events: VadEvent[]) =>
  events.find((e) => e.type === "utterance") as
    | Extract<VadEvent, { type: "utterance" }>
    | undefined

describe("rms", () => {
  it("is zero for silence and full scale for a square wave", () => {
    expect(rms(new Int16Array(64))).toBe(0)
    expect(rms(Int16Array.from(Array(64).fill(-0x8000)))).toBeCloseTo(1, 5)
  })

  it("is zero for an empty frame rather than NaN", () => {
    expect(rms(new Int16Array(0))).toBe(0)
  })
})

describe("isDigitalSilence", () => {
  it("distinguishes exact zero from a noise floor", () => {
    expect(isDigitalSilence(new Int16Array(32))).toBe(true)
    const floor = new Int16Array(32)
    floor[17] = 1
    expect(isDigitalSilence(floor)).toBe(false)
  })
})

describe("createVad onset", () => {
  it("declares speech only after onsetFrames consecutive loud frames", () => {
    const vad = createVad()
    expect(vad.push(LOUD).type).toBe("none")
    expect(vad.push(LOUD).type).toBe("none")
    expect(vad.push(LOUD).type).toBe("speech-start")
  })

  it("rejects a single-frame transient", () => {
    // A keyboard click or a notification blip. Two of these separated by quiet
    // must not accumulate into an onset.
    const vad = createVad()
    const events = drive(vad, [LOUD, QUIET, LOUD, QUIET, LOUD, QUIET])
    expect(events).toEqual([])
    expect(vad.isSpeaking()).toBe(false)
  })

  it("backdates the start to the first loud frame", () => {
    const vad = createVad()
    drive(vad, repeat(QUIET, 10))
    drive(vad, repeat(LOUD, 20))
    const events = drive(vad, repeat(QUIET, DEFAULT_VAD_CONFIG.hangoverFrames))
    // Speech began at frame 10, not at frame 12 where onset was proven — the
    // pre-roll depends on this being the real first syllable.
    expect(utterance(events)?.startFrame).toBe(10)
  })
})

describe("createVad endpointing", () => {
  it("closes after hangoverFrames of silence, excluding the silence", () => {
    const vad = createVad()
    drive(vad, repeat(LOUD, 20)) // frames 0..19
    const events = drive(vad, repeat(QUIET, DEFAULT_VAD_CONFIG.hangoverFrames))
    const closed = utterance(events)
    expect(closed).toBeDefined()
    expect(closed?.startFrame).toBe(0)
    // The trailing silence proved the turn ended; it is not part of it.
    expect(closed?.endFrame).toBe(20)
  })

  it("rides a pause shorter than the hangover", () => {
    const vad = createVad()
    drive(vad, repeat(LOUD, 10))
    const events = drive(vad, [
      ...repeat(QUIET, DEFAULT_VAD_CONFIG.hangoverFrames - 1),
      ...repeat(LOUD, 10)
    ])
    expect(utterance(events)).toBeUndefined()
    expect(vad.isSpeaking()).toBe(true)
  })

  it("counts only voiced frames toward the duration floor", () => {
    const vad = createVad()
    drive(vad, repeat(LOUD, 20))
    const events = drive(vad, repeat(QUIET, DEFAULT_VAD_CONFIG.hangoverFrames))
    expect(utterance(events)?.voicedMs).toBe(20 * FRAME_MS)
  })

  it("flags a clip under minVoicedMs so it never costs a transcription", () => {
    const vad = createVad()
    // Three frames is 192 ms of voice — a door slam, not a question.
    drive(vad, repeat(LOUD, 3))
    const events = drive(vad, repeat(QUIET, DEFAULT_VAD_CONFIG.hangoverFrames))
    expect(utterance(events)?.tooShort).toBe(true)
  })

  it("does not flag a clip past minVoicedMs", () => {
    const vad = createVad()
    drive(vad, repeat(LOUD, 20)) // 1280 ms
    const events = drive(vad, repeat(QUIET, DEFAULT_VAD_CONFIG.hangoverFrames))
    expect(utterance(events)?.tooShort).toBe(false)
  })

  it("force-cuts a monologue at maxUtteranceMs", () => {
    const vad = createVad()
    const maxFrames = Math.ceil(DEFAULT_VAD_CONFIG.maxUtteranceMs / FRAME_MS)
    const events = drive(vad, repeat(LOUD, maxFrames + 5))
    const closed = utterance(events)
    expect(closed).toBeDefined()
    expect(closed!.endFrame - closed!.startFrame).toBe(maxFrames)
  })

  it("keeps capturing after a force-cut, so the rest of the question survives", () => {
    // The cut is a size limit, not an endpoint — they are still talking. If
    // this re-armed only on the next silence, the tail of a long question
    // would be dropped on the floor.
    const vad = createVad()
    const maxFrames = Math.ceil(DEFAULT_VAD_CONFIG.maxUtteranceMs / FRAME_MS)
    drive(vad, repeat(LOUD, maxFrames + DEFAULT_VAD_CONFIG.onsetFrames))
    expect(vad.isSpeaking()).toBe(true)

    const events = drive(vad, repeat(QUIET, DEFAULT_VAD_CONFIG.hangoverFrames))
    // The continuation is its own utterance, starting where the cut landed.
    expect(utterance(events)?.startFrame).toBe(maxFrames)
  })
})

describe("createVad on a virtual device", () => {
  it("never triggers on digital silence", () => {
    // The whole reason absFloor exists: an unrouted BlackHole has a noise floor
    // of exactly 0, so a purely relative threshold would fire immediately.
    const vad = createVad()
    expect(drive(vad, repeat(0, 500))).toEqual([])
    expect(vad.threshold()).toBe(DEFAULT_VAD_CONFIG.absFloor)
  })

  it("never triggers on a level below the absolute floor", () => {
    const vad = createVad()
    expect(drive(vad, repeat(DEFAULT_VAD_CONFIG.absFloor / 2, 500))).toEqual([])
  })

  it("raises the threshold above a noisy floor", () => {
    const vad = createVad()
    drive(vad, repeat(0.05, 2000))
    expect(vad.threshold()).toBeGreaterThan(DEFAULT_VAD_CONFIG.absFloor)
    expect(vad.threshold()).toBeLessThanOrEqual(
      0.05 * DEFAULT_VAD_CONFIG.thresholdRatio
    )
  })

  it("does not let speech drag the floor up mid-utterance", () => {
    const vad = createVad()
    drive(vad, repeat(LOUD, 3)) // onset
    const during = vad.threshold()
    drive(vad, repeat(LOUD, 200)) // a long answer
    expect(vad.threshold()).toBe(during)
  })
})

describe("createVad reset", () => {
  it("drops the open utterance but keeps frame indices monotonic", () => {
    const vad = createVad()
    drive(vad, repeat(LOUD, 10))
    expect(vad.isSpeaking()).toBe(true)

    vad.reset()
    expect(vad.isSpeaking()).toBe(false)

    // Indices must keep advancing — they address the ring buffer, and
    // restarting them would make a later slice read the wrong samples.
    drive(vad, repeat(LOUD, 20))
    const events = drive(vad, repeat(QUIET, DEFAULT_VAD_CONFIG.hangoverFrames))
    expect(utterance(events)?.startFrame).toBe(10)
  })
})
