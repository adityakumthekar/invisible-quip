import type { AutopilotPhase, AutopilotUpdate } from "./autopilot"
import type { TeachingResult } from "./teaching"

/**
 * Renderer-side mirror of an autopilot run. Main owns the loop and pushes the
 * authoritative state, so this reducer mostly tracks the latest update plus the
 * small amount of state that only exists in the UI: the goal being typed, and
 * the gap between asking main to start and the first update arriving.
 */
export interface AutopilotSessionState {
  goal: string
  phase: AutopilotPhase
  update: AutopilotUpdate | null
  /** True between the start request and the first update from main. */
  starting: boolean
  error: string | null
  /** Highest run id seen, so a late update from a previous run is ignored. */
  runId: number
}

export const initialAutopilotSessionState: AutopilotSessionState = {
  goal: "",
  phase: "idle",
  update: null,
  starting: false,
  error: null,
  runId: 0
}

export type AutopilotSessionEvent =
  | { type: "set-goal"; goal: string }
  | { type: "start-requested" }
  | { type: "start-failed"; error: unknown }
  | { type: "update"; update: AutopilotUpdate }
  | { type: "reset" }

const TERMINAL_PHASES: AutopilotPhase[] = [
  "complete",
  "blocked",
  "stopped",
  "error",
  "idle"
]

export function isAutopilotTerminal(phase: AutopilotPhase): boolean {
  return TERMINAL_PHASES.includes(phase)
}

/** True while main is doing something the user should not interrupt casually. */
export function isAutopilotBusy(state: AutopilotSessionState): boolean {
  return state.starting || !isAutopilotTerminal(state.phase)
}

export function autopilotProgressLabel(
  state: AutopilotSessionState
): string | null {
  if (!state.update) {
    return null
  }
  return `Step ${state.update.stepIndex} of ${state.update.maxSteps}`
}

export function describeAutopilotPhase(phase: AutopilotPhase): string {
  switch (phase) {
    case "thinking":
      return "Looking at your screen…"
    case "acting":
      return "Performing the action…"
    case "awaiting-confirmation":
      return "Waiting for your approval"
    case "complete":
      return "Done"
    case "blocked":
      return "Can’t continue"
    case "stopped":
      return "Stopped"
    case "error":
      return "Something went wrong"
    case "idle":
      return "Ready"
  }
}

/**
 * Plain-language summary of what autopilot is about to do, shown in the
 * confirmation prompt. The user is approving a real action on their screen, so
 * this must say exactly what will happen — never just "continue?".
 */
export function describePendingAction(
  result: TeachingResult | undefined
): string | null {
  if (!result || result.state !== "step") {
    return null
  }

  switch (result.action) {
    case "click":
      return "Click the highlighted target"
    case "double-click":
      return "Double-click the highlighted target"
    case "right-click":
      return "Right-click the highlighted target"
    case "type":
      return `Click the highlighted target, then type “${result.text ?? ""}”`
    case "scroll":
      return result.scroll
        ? `Scroll ${result.scroll.direction} ${result.scroll.amount} notch${
            result.scroll.amount === 1 ? "" : "es"
          }`
        : "Scroll at the highlighted target"
    case "key":
      return `Press ${result.key ?? "a key"}`
    case "drag":
      return "Drag from the highlighted target to the destination"
    case "wait":
      return "Wait for the screen to settle, then look again"
  }
}

export function autopilotSessionReducer(
  state: AutopilotSessionState,
  event: AutopilotSessionEvent
): AutopilotSessionState {
  switch (event.type) {
    case "set-goal":
      return { ...state, goal: event.goal }

    case "start-requested":
      return {
        ...state,
        phase: "thinking",
        update: null,
        starting: true,
        error: null
      }

    case "start-failed":
      return {
        ...state,
        phase: "error",
        starting: false,
        error:
          event.error instanceof Error
            ? event.error.message
            : String(event.error)
      }

    case "update": {
      // Main stops the previous run before starting a new one, so a lower run
      // id can only be a late message from a run the user already abandoned.
      if (event.update.runId < state.runId) {
        return state
      }
      return {
        ...state,
        phase: event.update.phase,
        update: event.update,
        starting: false,
        error: event.update.error ?? null,
        runId: event.update.runId
      }
    }

    case "reset":
      return { ...initialAutopilotSessionState, goal: state.goal }
  }
}
