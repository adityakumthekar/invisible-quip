import type { TeachingResult } from "./teaching"

export type TeachingOperation = "start" | "next" | "execute"
export type TeachingPhase =
  | "idle"
  | "loading"
  | "step"
  | "complete"
  | "blocked"
  | "error"

export interface TeachingError {
  kind: "permission" | "provider" | "api" | "cancellation"
  message: string
  recoverable: boolean
}

export interface TeachingSessionState {
  phase: TeachingPhase
  goal: string
  result?: TeachingResult
  error?: TeachingError
  pendingOperation?: TeachingOperation
  retryOperation?: TeachingOperation
  requestId: number
}

export const initialTeachingSessionState: TeachingSessionState = {
  phase: "idle",
  goal: "",
  requestId: 0
}

export type TeachingSessionEvent =
  | { type: "set-goal"; goal: string }
  | {
      type: "request"
      operation: TeachingOperation
      requestId: number
    }
  | { type: "resolved"; requestId: number; result: TeachingResult }
  | { type: "rejected"; requestId: number; error: unknown }
  | { type: "reset"; requestId: number }

export function classifyTeachingError(error: unknown): TeachingError {
  const detail = error instanceof Error ? error.message : String(error)
  const normalized = detail.toLowerCase()

  if (
    normalized.includes("cancel") ||
    normalized.includes("abort") ||
    normalized.includes("session changed") ||
    normalized.includes("stale")
  ) {
    return {
      kind: "cancellation",
      message: "Teaching was cancelled. Start again when you’re ready.",
      recoverable: false
    }
  }

  if (
    normalized.includes("permission") ||
    normalized.includes("screen recording") ||
    normalized.includes("not authorized") ||
    normalized.includes("access denied")
  ) {
    return {
      kind: "permission",
      message: "Screen access is required. Allow it in system settings, then retry.",
      recoverable: true
    }
  }

  if (
    normalized.includes("gemini") ||
    normalized.includes("api key") ||
    normalized.includes("provider") ||
    normalized.includes("unauthorized") ||
    normalized.includes("authentication")
  ) {
    return {
      kind: "provider",
      message: "Gemini isn’t available. Check your Gemini settings, then retry.",
      recoverable: true
    }
  }

  return {
    kind: "api",
    message: "Teaching couldn’t continue. Check your connection and retry.",
    recoverable: true
  }
}

export function teachingSessionReducer(
  state: TeachingSessionState,
  event: TeachingSessionEvent
): TeachingSessionState {
  switch (event.type) {
    case "set-goal":
      return { ...state, goal: event.goal }
    case "request":
      return {
        ...state,
        phase: "loading",
        error: undefined,
        pendingOperation: event.operation,
        retryOperation: undefined,
        requestId: event.requestId
      }
    case "resolved":
      if (event.requestId !== state.requestId || state.phase !== "loading") {
        return state
      }
      return {
        ...state,
        phase: event.result.state,
        result: event.result,
        error: undefined,
        pendingOperation: undefined,
        retryOperation: undefined
      }
    case "rejected":
      if (event.requestId !== state.requestId || state.phase !== "loading") {
        return state
      }
      return {
        ...state,
        phase: "error",
        error: classifyTeachingError(event.error),
        pendingOperation: undefined,
        retryOperation: state.pendingOperation
      }
    case "reset":
      return { ...initialTeachingSessionState, requestId: event.requestId }
  }
}

export interface TeachingOperationApi {
  start: (goal: string) => Promise<TeachingResult>
  next: () => Promise<TeachingResult>
  execute: () => Promise<TeachingResult>
}

export type TeachingOperationOutcome =
  | { kind: "stale" }
  | { kind: "result"; result: TeachingResult }

/**
 * Both providers can drive teaching now — Ollama needs a vision-capable model,
 * and LLMHelper raises a specific, actionable error naming one when the
 * selected model can't read screenshots. So there is no pre-emptive provider
 * gate here; a real failure carries better information than a blanket block.
 */
export async function executeTeachingOperation(
  operation: TeachingOperation,
  goal: string,
  api: TeachingOperationApi,
  isCurrent: () => boolean = () => true
): Promise<TeachingOperationOutcome> {
  if (!isCurrent()) {
    return { kind: "stale" }
  }

  const result =
    operation === "start"
      ? await api.start(goal)
      : operation === "next"
        ? await api.next()
        : await api.execute()
  return { kind: "result", result }
}
