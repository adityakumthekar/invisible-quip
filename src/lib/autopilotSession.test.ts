import { describe, expect, it } from "vitest"
import type { AutopilotUpdate } from "./autopilot"
import type { TeachingResult, TeachingStepResult } from "./teaching"
import {
  autopilotProgressLabel,
  autopilotSessionReducer,
  describeAutopilotPhase,
  describePendingAction,
  initialAutopilotSessionState,
  isAutopilotBusy,
  isAutopilotTerminal,
  type AutopilotSessionState
} from "./autopilotSession"

function update(overrides: Partial<AutopilotUpdate> = {}): AutopilotUpdate {
  return {
    phase: "thinking",
    runId: 1,
    goal: "do the thing",
    stepIndex: 0,
    maxSteps: 25,
    ...overrides
  }
}

function reduce(
  events: Parameters<typeof autopilotSessionReducer>[1][],
  from: AutopilotSessionState = initialAutopilotSessionState
): AutopilotSessionState {
  return events.reduce(autopilotSessionReducer, from)
}

describe("autopilotSessionReducer", () => {
  it("tracks the goal independently of run state", () => {
    const state = reduce([
      { type: "set-goal", goal: "open my calendar" },
      { type: "start-requested" }
    ])

    expect(state.goal).toBe("open my calendar")
    expect(state.starting).toBe(true)
    expect(state.phase).toBe("thinking")
  })

  it("keeps the goal across a reset so the user can rerun it", () => {
    const state = reduce([
      { type: "set-goal", goal: "open my calendar" },
      { type: "start-requested" },
      { type: "reset" }
    ])

    expect(state.goal).toBe("open my calendar")
    expect(state.phase).toBe("idle")
    expect(state.update).toBeNull()
  })

  it("adopts updates from main and clears the starting flag", () => {
    const state = reduce([
      { type: "start-requested" },
      { type: "update", update: update({ phase: "acting", stepIndex: 2 }) }
    ])

    expect(state.phase).toBe("acting")
    expect(state.starting).toBe(false)
    expect(state.update?.stepIndex).toBe(2)
  })

  it("ignores a late update from an abandoned run", () => {
    const state = reduce([
      { type: "update", update: update({ runId: 4, phase: "thinking" }) },
      { type: "update", update: update({ runId: 2, phase: "stopped" }) }
    ])

    expect(state.phase).toBe("thinking")
    expect(state.runId).toBe(4)
  })

  it("surfaces an error carried on an update", () => {
    const state = reduce([
      {
        type: "update",
        update: update({ phase: "error", error: "Screen access is off" })
      }
    ])

    expect(state.phase).toBe("error")
    expect(state.error).toBe("Screen access is off")
  })

  it("records a failure to start at all", () => {
    const state = reduce([
      { type: "start-requested" },
      { type: "start-failed", error: new Error("Autopilot consent required.") }
    ])

    expect(state.phase).toBe("error")
    expect(state.starting).toBe(false)
    expect(state.error).toMatch(/consent required/i)
  })

  it("clears a stale error when a new run starts", () => {
    const state = reduce([
      { type: "start-failed", error: new Error("nope") },
      { type: "start-requested" }
    ])

    expect(state.error).toBeNull()
  })
})

describe("autopilot state helpers", () => {
  it("treats only settled phases as terminal", () => {
    for (const phase of ["complete", "blocked", "stopped", "error", "idle"] as const) {
      expect(isAutopilotTerminal(phase)).toBe(true)
    }
    for (const phase of ["thinking", "acting", "awaiting-confirmation"] as const) {
      expect(isAutopilotTerminal(phase)).toBe(false)
    }
  })

  it("counts a pending start as busy", () => {
    expect(
      isAutopilotBusy({ ...initialAutopilotSessionState, starting: true })
    ).toBe(true)
    expect(isAutopilotBusy(initialAutopilotSessionState)).toBe(false)
  })

  it("labels progress only once a run reports in", () => {
    expect(autopilotProgressLabel(initialAutopilotSessionState)).toBeNull()
    expect(
      autopilotProgressLabel(
        reduce([
          { type: "update", update: update({ stepIndex: 3, maxSteps: 25 }) }
        ])
      )
    ).toBe("Step 3 of 25")
  })

  it("describes every phase", () => {
    for (const phase of [
      "idle",
      "thinking",
      "acting",
      "awaiting-confirmation",
      "complete",
      "blocked",
      "stopped",
      "error"
    ] as const) {
      expect(describeAutopilotPhase(phase)).toMatch(/\w/)
    }
  })
})

describe("describePendingAction", () => {
  const bounds = { x: 0, y: 0, width: 1440, height: 900 }
  const step = (overrides: Partial<TeachingStepResult>): TeachingStepResult => ({
    state: "step",
    instruction: "Do it.",
    action: "click",
    risk: "safe",
    target: { x: 10, y: 10, width: 10, height: 10 },
    displayId: 1,
    displayBounds: bounds,
    ...overrides
  })

  it("returns nothing without a pending step", () => {
    expect(describePendingAction(undefined)).toBeNull()
    const done: TeachingResult = {
      state: "complete",
      instruction: "Done.",
      displayId: 1,
      displayBounds: bounds
    }
    expect(describePendingAction(done)).toBeNull()
  })

  it("names the exact action for every kind", () => {
    expect(describePendingAction(step({ action: "click" }))).toMatch(/^Click/)
    expect(describePendingAction(step({ action: "double-click" }))).toMatch(
      /^Double-click/
    )
    expect(describePendingAction(step({ action: "right-click" }))).toMatch(
      /^Right-click/
    )
    expect(describePendingAction(step({ action: "drag" }))).toMatch(/^Drag/)
    expect(describePendingAction(step({ action: "wait" }))).toMatch(/^Wait/)
  })

  it("quotes the text that will be typed", () => {
    expect(
      describePendingAction(step({ action: "type", text: "hello world" }))
    ).toContain("“hello world”")
  })

  it("spells out the key combo and scroll vector", () => {
    expect(describePendingAction(step({ action: "key", key: "cmd+a" }))).toBe(
      "Press cmd+a"
    )
    expect(
      describePendingAction(
        step({ action: "scroll", scroll: { direction: "down", amount: 3 } })
      )
    ).toBe("Scroll down 3 notches")
    expect(
      describePendingAction(
        step({ action: "scroll", scroll: { direction: "up", amount: 1 } })
      )
    ).toBe("Scroll up 1 notch")
  })
})
