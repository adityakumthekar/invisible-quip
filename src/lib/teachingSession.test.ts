import { describe, expect, it, vi } from "vitest"
import type { TeachingResult } from "./teaching"
import {
  classifyTeachingError,
  executeTeachingOperation,
  initialTeachingSessionState,
  teachingSessionReducer
} from "./teachingSession"

const step: TeachingResult = {
  state: "step",
  instruction: "Open Settings.",
  label: "Settings",
  target: { x: 10, y: 20, width: 30, height: 40 },
  displayId: 1,
  displayBounds: { x: 0, y: 0, width: 1440, height: 900 }
}

describe("teachingSessionReducer", () => {
  it("moves from goal entry through loading to one step", () => {
    const withGoal = teachingSessionReducer(initialTeachingSessionState, {
      type: "set-goal",
      goal: "Learn settings"
    })
    const loading = teachingSessionReducer(withGoal, {
      type: "request",
      operation: "start",
      requestId: 1
    })
    const active = teachingSessionReducer(loading, {
      type: "resolved",
      requestId: 1,
      result: step
    })

    expect(loading).toMatchObject({
      phase: "loading",
      pendingOperation: "start"
    })
    expect(active).toMatchObject({
      phase: "step",
      result: step,
      retryOperation: undefined
    })
  })

  it("selects the failed next operation for retry", () => {
    const loading = teachingSessionReducer(
      { ...initialTeachingSessionState, phase: "step", result: step },
      { type: "request", operation: "next", requestId: 2 }
    )
    const failed = teachingSessionReducer(loading, {
      type: "rejected",
      requestId: 2,
      error: new Error("Screen recording permission denied")
    })

    expect(failed.phase).toBe("error")
    expect(failed.retryOperation).toBe("next")
    expect(failed.error).toMatchObject({
      kind: "permission",
      recoverable: true
    })
  })

  it("ignores completion from a request invalidated by reset", () => {
    const loading = teachingSessionReducer(initialTeachingSessionState, {
      type: "request",
      operation: "start",
      requestId: 4
    })
    const reset = teachingSessionReducer(loading, {
      type: "reset",
      requestId: 5
    })

    expect(
      teachingSessionReducer(reset, {
        type: "resolved",
        requestId: 4,
        result: step
      })
    ).toEqual(reset)
  })

  it.each([
    ["permission denied", "permission"],
    ["Gemini API key is missing", "provider"],
    ["network request failed", "api"],
    ["Teaching session changed before this step completed", "cancellation"]
  ] as const)("classifies %s safely", (message, kind) => {
    const error = classifyTeachingError(new Error(message))
    expect(error.kind).toBe(kind)
    expect(error.message).not.toContain(message)
  })
})

describe("executeTeachingOperation", () => {
  it("gates start for Ollama without invoking teaching IPC", async () => {
    const api = {
      start: vi.fn(),
      next: vi.fn()
    }

    const outcome = await executeTeachingOperation(
      "start",
      "Learn settings",
      "ollama",
      api
    )

    expect(outcome).toEqual({ kind: "provider-blocked" })
    expect(api.start).not.toHaveBeenCalled()
    expect(api.next).not.toHaveBeenCalled()
  })

  it("does not invoke teaching IPC after the request becomes stale", async () => {
    const api = {
      start: vi.fn().mockResolvedValue(step),
      next: vi.fn().mockResolvedValue(step)
    }

    const outcome = await executeTeachingOperation(
      "start",
      "Learn settings",
      "gemini",
      api,
      () => false
    )

    expect(outcome).toEqual({ kind: "stale" })
    expect(api.start).not.toHaveBeenCalled()
    expect(api.next).not.toHaveBeenCalled()
  })

  it("invokes the operation selected for retry", async () => {
    const api = {
      start: vi.fn().mockResolvedValue(step),
      next: vi.fn().mockResolvedValue(step)
    }

    const outcome = await executeTeachingOperation(
      "next",
      "Learn settings",
      "gemini",
      api
    )

    expect(outcome).toEqual({ kind: "result", result: step })
    expect(api.next).toHaveBeenCalledOnce()
    expect(api.start).not.toHaveBeenCalled()
  })
})
