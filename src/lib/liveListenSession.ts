// State for the Live Listen session, in the shape teachingSession.ts and
// autopilotSession.ts already use: a pure reducer, so the parts that decide
// things are testable and Queue.tsx only holds the parts that can't be.
//
// The one structural difference is that this machine is not sequential. The
// interviewer can start a second question while the first is still being
// transcribed, and can start a third while an answer is streaming. So there is
// no phase *enum* being threaded through events — there are independent facts,
// and `livePhase` derives a display state from them. Trying to sequence a
// single phase through overlapping events is what makes this kind of code wrong
// in ways that only show up in a real interview.

/** No new utterance for this long ends the question and fires the answer. */
export const SETTLE_MS = 1600
/** Idle time after which an unanswered buffer is abandoned rather than glued on. */
export const BUFFER_STALE_MS = 15000
/** Minimum gap between two fires, so one question can't answer itself twice. */
export const COOLDOWN_MS = 1500
/** Digital silence for this long after arming means the device isn't routed. */
export const DEAD_AFTER_MS = 3000

export interface LiveListenState {
  armed: boolean
  /** An utterance is currently open. */
  speaking: boolean
  /** An answer is streaming. */
  answering: boolean
  /** In-flight transcriptions. Several can overlap one slow answer. */
  transcribing: number
  /** Transcribed utterances not yet answered, oldest first. */
  pending: string[]
  /**
   * A non-zero sample has been seen since arming. False after DEAD_AFTER_MS
   * means BlackHole is not routed — a real source always has a noise floor.
   */
  heardSignal: boolean
  error?: string
  /**
   * Bumped on every arm and disarm. A transcript that resolves after the user
   * disarmed belongs to a session that no longer exists.
   */
  epoch: number
}

export const initialLiveListenState: LiveListenState = {
  armed: false,
  speaking: false,
  answering: false,
  transcribing: 0,
  pending: [],
  heardSignal: false,
  epoch: 0
}

export type LivePhase =
  | "off"
  | "error"
  | "speaking"
  | "transcribing"
  | "answering"
  | "listening"

/**
 * Display state only — nothing branches on this. Precedence is what the user
 * most needs to see: that it heard them beats that it is still writing.
 */
export function livePhase(state: LiveListenState): LivePhase {
  if (state.error) return "error"
  if (!state.armed) return "off"
  if (state.speaking) return "speaking"
  if (state.transcribing > 0) return "transcribing"
  if (state.answering) return "answering"
  return "listening"
}

/** Whether the device looks unrouted: armed, past the grace period, still silent. */
export function isDeviceDead(state: LiveListenState, armedMs: number): boolean {
  return state.armed && !state.heardSignal && armedMs >= DEAD_AFTER_MS
}

export type LiveListenEvent =
  | { type: "arm" }
  | { type: "disarm" }
  | { type: "failed"; message: string }
  | { type: "signal" }
  | { type: "speech-start" }
  | { type: "speech-end"; transcribing: boolean }
  | { type: "transcript"; epoch: number; text: string }
  | { type: "transcript-failed"; epoch: number }
  | { type: "fired" }
  | { type: "answer-done" }
  | { type: "clear-pending" }

export function liveListenReducer(
  state: LiveListenState,
  event: LiveListenEvent
): LiveListenState {
  switch (event.type) {
    case "arm":
      return {
        ...initialLiveListenState,
        armed: true,
        epoch: state.epoch + 1
      }

    case "disarm":
      // Everything in flight is abandoned rather than allowed to land: the
      // epoch bump is what stops a transcript from arriving after the user
      // has visibly turned this off.
      return {
        ...initialLiveListenState,
        armed: false,
        epoch: state.epoch + 1
      }

    case "failed":
      return {
        ...initialLiveListenState,
        armed: false,
        error: event.message,
        epoch: state.epoch + 1
      }

    case "signal":
      return state.heardSignal ? state : { ...state, heardSignal: true }

    case "speech-start":
      return state.armed ? { ...state, speaking: true } : state

    case "speech-end":
      if (!state.armed) return state
      return {
        ...state,
        speaking: false,
        // A clip below the voiced-duration floor is dropped here, before it
        // costs a transcription. It never becomes an in-flight request.
        transcribing: state.transcribing + (event.transcribing ? 1 : 0)
      }

    case "transcript": {
      if (event.epoch !== state.epoch) return state
      const text = event.text.trim()
      return {
        ...state,
        transcribing: Math.max(0, state.transcribing - 1),
        pending: text ? [...state.pending, text] : state.pending
      }
    }

    case "transcript-failed":
      if (event.epoch !== state.epoch) return state
      return { ...state, transcribing: Math.max(0, state.transcribing - 1) }

    case "fired":
      return { ...state, pending: [], answering: true }

    case "answer-done":
      return { ...state, answering: false }

    case "clear-pending":
      return state.pending.length ? { ...state, pending: [] } : state
  }
}

/** The buffer as it goes to the model. */
export function pendingText(state: LiveListenState): string {
  return state.pending.join(" ").trim()
}
