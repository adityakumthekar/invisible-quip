// teaching.ts
//
// The step-at-a-time session coordinator: capture → generate → (actuate) →
// repeat. The wire contract lives in teachingContract.ts and the coordinate
// math in teachingGeometry.ts; both are re-exported here so every existing
// import site keeps working unchanged.

import {
  dipRectCenter,
  normalizedTargetToDipRect,
  type DipPoint,
  type DipRect,
  type TeachingCapture,
  type TeachingDisplayCaptureInfo
} from "./teachingGeometry"
import type {
  TeachingAction,
  TeachingRisk,
  TeachingScroll,
  TeachingStepResponse
} from "./teachingContract"

export * from "./teachingContract"
export * from "./teachingGeometry"

export type TeachingResult =
  | {
      state: "step"
      instruction: string
      label?: string
      action: TeachingAction
      risk: TeachingRisk
      text?: string
      key?: string
      scroll?: TeachingScroll
      target: DipRect
      /** Drag destination, present only when action is "drag". */
      to?: DipRect
      displayId: number
      displayBounds: DipRect
    }
  | {
      state: "complete" | "blocked"
      instruction: string
      label?: string
      displayId: number
      displayBounds: DipRect
    }

export type TeachingStepResult = Extract<TeachingResult, { state: "step" }>

/**
 * A confirmed action to actuate on the real screen: where to act (the target
 * center, in global DIP coordinates) plus whatever payload the action needs.
 */
export interface TeachingActuation {
  action: TeachingAction
  point: DipPoint
  text?: string
  key?: string
  scroll?: TeachingScroll
  /** Drag destination center, in global DIP coordinates. */
  to?: DipPoint
}

export interface TeachingSessionDependencies {
  capture: () => Promise<TeachingCapture>
  generate: (
    goal: string,
    history: string[],
    screenshotPath: string,
    imageSize: { width: number; height: number }
  ) => Promise<TeachingStepResponse>
  remove: (screenshotPath: string) => Promise<void>
  /**
   * Performs a confirmed action on the real screen. Optional so callers that
   * only guide (no input control) can omit it; `execute()` then reports that
   * input automation is unavailable.
   */
  actuate?: (actuation: TeachingActuation) => Promise<void>
}

export class TeachingSessionStaleError extends Error {
  constructor() {
    super("Teaching session changed before this step completed. Please try again.")
    this.name = "TeachingSessionStaleError"
  }
}

export class TeachingOperationInProgressError extends Error {
  constructor() {
    super("A teaching step is already in progress. Please wait.")
    this.name = "TeachingOperationInProgressError"
  }
}

function summarizeTeachingStep(step: TeachingStepResponse): string {
  const label = step.label ? ` (${step.label})` : ""
  return `[${step.state}] ${step.instruction}${label}`
}

/** Build the actuation payload for an approved step. */
export function toTeachingActuation(
  step: TeachingStepResult
): TeachingActuation {
  return {
    action: step.action,
    point: dipRectCenter(step.target),
    ...(step.text !== undefined ? { text: step.text } : {}),
    ...(step.key !== undefined ? { key: step.key } : {}),
    ...(step.scroll !== undefined ? { scroll: step.scroll } : {}),
    ...(step.to !== undefined ? { to: dipRectCenter(step.to) } : {})
  }
}

function toTeachingResult(
  step: TeachingStepResponse,
  display: TeachingDisplayCaptureInfo
): TeachingResult {
  const label = step.label === undefined ? {} : { label: step.label }

  if (step.state === "step") {
    const dipTarget = normalizedTargetToDipRect(step.target, display)
    const dipTo =
      step.to === undefined
        ? undefined
        : normalizedTargetToDipRect(step.to, display)

    // DIAGNOSTIC (remove once the overlay offset is fixed): shows each layer of
    // the target conversion so a bad model box can be told apart from a bad
    // pixel->DIP mapping. Compare `dip center` against where the element
    // actually sits on screen.
    const center = dipRectCenter(dipTarget)
    console.log(
      `[teaching] model 0-1000 ${JSON.stringify(step.target)}` +
        ` | capture ${display.screenshotWidth}x${display.screenshotHeight}` +
        ` bounds ${display.bounds.width}x${display.bounds.height}@${display.bounds.x},${display.bounds.y}` +
        ` | dip rect ${dipTarget.width.toFixed(1)}x${dipTarget.height.toFixed(1)}@${dipTarget.x.toFixed(1)},${dipTarget.y.toFixed(1)}` +
        ` | dip center ${center.x.toFixed(1)},${center.y.toFixed(1)}` +
        ` | ${step.action}/${step.risk} "${step.instruction}"`
    )

    return {
      state: step.state,
      instruction: step.instruction,
      ...label,
      action: step.action,
      risk: step.risk,
      ...(step.text !== undefined ? { text: step.text } : {}),
      ...(step.key !== undefined ? { key: step.key } : {}),
      ...(step.scroll !== undefined ? { scroll: step.scroll } : {}),
      target: dipTarget,
      ...(dipTo !== undefined ? { to: dipTo } : {}),
      displayId: display.displayId,
      displayBounds: { ...display.bounds }
    }
  }

  return {
    state: step.state,
    instruction: step.instruction,
    ...label,
    displayId: display.displayId,
    displayBounds: { ...display.bounds }
  }
}

export class TeachingSessionCoordinator {
  private static readonly MAX_HISTORY = 8
  private session: {
    goal: string
    history: string[]
    operationInProgress: boolean
  } | null = null

  /** The last "step" result, retained so `execute()` can actuate it. */
  private pendingStep: TeachingStepResult | null = null

  constructor(private readonly dependencies: TeachingSessionDependencies) {}

  private rememberPending(result: TeachingResult): TeachingResult {
    this.pendingStep = result.state === "step" ? result : null
    return result
  }

  public getPendingStep(): TeachingStepResult | null {
    return this.pendingStep
  }

  /**
   * Append a note to the session history without generating. Autopilot uses
   * this to tell the model a step was declined, so the next capture doesn't
   * just propose the same thing again.
   */
  public noteHistory(entry: string): void {
    const session = this.session
    const note = entry.trim()
    if (!session || !note) {
      return
    }
    session.history = [...session.history, note].slice(
      -TeachingSessionCoordinator.MAX_HISTORY
    )
  }

  public isActive(): boolean {
    return this.session !== null
  }

  public async start(rawGoal: string): Promise<TeachingResult> {
    const goal = rawGoal.trim()
    if (!goal) {
      throw new Error("A teaching goal is required")
    }

    const session = {
      goal,
      history: [] as string[],
      operationInProgress: true
    }
    this.session = session

    let result: { step: TeachingStepResponse; result: TeachingResult }
    try {
      result = await this.generate(goal, [])
    } catch (error) {
      if (this.session !== session) {
        throw new TeachingSessionStaleError()
      }
      this.session = null
      throw error
    }

    if (this.session !== session) {
      throw new TeachingSessionStaleError()
    }
    session.history = [summarizeTeachingStep(result.step)]
    session.operationInProgress = false
    return this.rememberPending(result.result)
  }

  public async next(): Promise<TeachingResult> {
    const session = this.session
    if (!session) {
      throw new Error("No active teaching session")
    }
    if (session.operationInProgress) {
      throw new TeachingOperationInProgressError()
    }

    session.operationInProgress = true
    let result: { step: TeachingStepResponse; result: TeachingResult }
    try {
      result = await this.generate(session.goal, session.history.slice())
    } catch (error) {
      if (this.session !== session) {
        throw new TeachingSessionStaleError()
      }
      session.operationInProgress = false
      throw error
    }

    if (this.session !== session) {
      throw new TeachingSessionStaleError()
    }
    session.history = [
      ...session.history,
      summarizeTeachingStep(result.step)
    ].slice(-TeachingSessionCoordinator.MAX_HISTORY)
    session.operationInProgress = false
    return this.rememberPending(result.result)
  }

  /**
   * Actuate the pending step's confirmed action on the real screen, without
   * advancing. Split out of `execute()` because autopilot has to let the UI
   * settle between acting and re-capturing — a human's reaction time used to
   * provide that delay for free.
   */
  public async actuatePending(): Promise<void> {
    const session = this.session
    if (!session) {
      throw new Error("No active teaching session")
    }
    if (session.operationInProgress) {
      throw new TeachingOperationInProgressError()
    }

    const pending = this.pendingStep
    if (!pending) {
      throw new Error("No teaching action to run")
    }

    const actuate = this.dependencies.actuate
    if (!actuate) {
      throw new Error("Input automation is unavailable")
    }

    session.operationInProgress = true
    try {
      await actuate(toTeachingActuation(pending))
    } catch (error) {
      if (this.session !== session) {
        throw new TeachingSessionStaleError()
      }
      session.operationInProgress = false
      throw error
    }

    if (this.session !== session) {
      throw new TeachingSessionStaleError()
    }
    session.operationInProgress = false
  }

  /**
   * Actuate the pending step, then advance to the next one. This is the manual
   * ("Guide me") path, where the human's own pacing separates the two halves.
   */
  public async execute(): Promise<TeachingResult> {
    await this.actuatePending()
    return this.next()
  }

  public stop(): void {
    this.session = null
    this.pendingStep = null
  }

  private async generate(
    goal: string,
    history: string[]
  ): Promise<{ step: TeachingStepResponse; result: TeachingResult }> {
    const capture = await this.dependencies.capture()
    try {
      const step = await this.dependencies.generate(goal, history, capture.path, {
        width: capture.display.screenshotWidth,
        height: capture.display.screenshotHeight
      })
      return {
        step,
        result: toTeachingResult(step, capture.display)
      }
    } finally {
      try {
        await this.dependencies.remove(capture.path)
      } catch (error) {
        console.error("Failed to delete temporary teaching screenshot:", error)
      }
    }
  }
}
