// autopilot.ts
//
// Drives an unattended run: capture → decide → (ask) → act → settle → repeat.
//
// The loop lives in main rather than the renderer for two reasons. The kill
// switch has to work when the renderer is unfocused, hidden, or wedged; and a
// run that is halfway through actuating must never be left dangling by a
// window event. Everything the loop *decides* lives in autopilotPolicy.ts;
// this file only sequences those decisions and owns the abort flag.

import {
  classifyAppRisk,
  classifyStepRisk,
  describeLoopStop,
  evaluateLoopContinuation,
  isRepeatOfPreviousStep,
  type AutopilotProvider,
  type LoopDecision,
  type RepeatComparableStep
} from "./autopilotPolicy"
import type { FrontmostApp, FrontmostAppProbe } from "./frontmostApp"
import type { TeachingResult, TeachingStepResult } from "./teaching"

export type AutopilotPhase =
  | "idle"
  | "thinking"
  | "acting"
  | "awaiting-confirmation"
  | "complete"
  | "blocked"
  | "stopped"
  | "error"

export interface AutopilotUpdate {
  phase: AutopilotPhase
  runId: number
  goal: string
  /** Actions actuated so far this run. */
  stepIndex: number
  maxSteps: number
  result?: TeachingResult
  /** Why we paused; populated only in "awaiting-confirmation". */
  reasons?: string[]
  /** Human-readable outcome; populated on terminal phases. */
  stopReason?: string
  error?: string
}

export interface AutopilotSession {
  start: (goal: string) => Promise<TeachingResult>
  next: () => Promise<TeachingResult>
  actuatePending: () => Promise<void>
  noteHistory: (entry: string) => void
  stop: () => void
}

export interface AutopilotDependencies {
  session: AutopilotSession
  /** Read at the start of each run, so a mid-run provider switch can't apply. */
  getProvider: () => AutopilotProvider
  /** Show the highlight for a pending step. */
  showTarget: (step: TeachingStepResult) => void
  /** Hide the highlight — always called before capturing or actuating. */
  clearTarget: () => void
  emit: (update: AutopilotUpdate) => void
  sleep: (ms: number) => Promise<void>
  /** Which app owns the screen; null when unknown. */
  getFrontmostApp: FrontmostAppProbe
  /** False on platforms with no probe, so "unknown" isn't treated as a red flag. */
  appProbeSupported: boolean
}

export interface AutopilotOptions {
  maxSteps?: number
  /** Pause after acting so UI animations finish before the next capture. */
  settleMs?: number
  /** Longer pause for an explicit "wait" step. */
  waitMs?: number
  /** Backoff before retrying a failed generate. */
  retryDelayMs?: number
  maxRepeats?: number
  maxConsecutiveErrors?: number
}

type Decision = "confirm" | "reject" | "stop"

type ResolvedOptions = Required<AutopilotOptions>

const DEFAULTS = {
  maxSteps: 25,
  settleMs: 700,
  waitMs: 1800,
  retryDelayMs: 800,
  maxRepeats: 2,
  maxConsecutiveErrors: 2
} as const

function isSameApp(
  a: FrontmostApp | null,
  b: FrontmostApp | null
): boolean {
  if (!a || !b) {
    return a === b
  }
  return a.bundleId === b.bundleId
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

export class AutopilotCoordinator {
  private runId = 0
  private running = false
  private goal = ""
  private stepIndex = 0
  private provider: AutopilotProvider = "gemini"
  private options: ResolvedOptions = { ...DEFAULTS }
  private pendingDecision: ((answer: Decision) => void) | null = null

  constructor(private readonly dependencies: AutopilotDependencies) {}

  public isRunning(): boolean {
    return this.running
  }

  public getMaxSteps(): number {
    return this.options.maxSteps
  }

  /** True while a step is parked waiting for the user to approve or skip. */
  public isAwaitingConfirmation(): boolean {
    return this.pendingDecision !== null
  }

  public confirm(): void {
    this.settleDecision("confirm")
  }

  public reject(): void {
    this.settleDecision("reject")
  }

  /**
   * Hard stop. Safe to call at any time, including from a global shortcut while
   * the loop is mid-await — the run id bump makes every in-flight continuation
   * a no-op.
   */
  public stop(): void {
    const wasRunning = this.running
    this.runId += 1
    this.running = false
    this.settleDecision("stop")
    this.dependencies.session.stop()
    this.dependencies.clearTarget()

    if (wasRunning) {
      this.dependencies.emit({
        phase: "stopped",
        runId: this.runId,
        goal: this.goal,
        stepIndex: this.stepIndex,
        maxSteps: this.options.maxSteps,
        stopReason: "Stopped."
      })
    }
  }

  public async start(
    rawGoal: string,
    provider: AutopilotProvider,
    options: AutopilotOptions = {}
  ): Promise<void> {
    const goal = rawGoal.trim()
    if (!goal) {
      throw new Error("An autopilot goal is required")
    }

    // Tear down any previous run before adopting this one's id.
    this.stop()

    const runId = ++this.runId
    this.running = true
    this.goal = goal
    this.stepIndex = 0
    this.provider = provider
    this.options = {
      maxSteps: Math.round(positiveNumber(options.maxSteps, DEFAULTS.maxSteps)),
      settleMs: positiveNumber(options.settleMs, DEFAULTS.settleMs),
      waitMs: positiveNumber(options.waitMs, DEFAULTS.waitMs),
      retryDelayMs: positiveNumber(options.retryDelayMs, DEFAULTS.retryDelayMs),
      maxRepeats: Math.round(
        positiveNumber(options.maxRepeats, DEFAULTS.maxRepeats)
      ),
      maxConsecutiveErrors: Math.round(
        positiveNumber(options.maxConsecutiveErrors, DEFAULTS.maxConsecutiveErrors)
      )
    }

    this.emit(runId, { phase: "thinking" })

    let result: TeachingResult
    try {
      this.dependencies.clearTarget()
      result = await this.dependencies.session.start(goal)
    } catch (error) {
      if (this.isCurrent(runId)) {
        this.fail(runId, error)
      }
      return
    }

    await this.run(runId, result)
  }

  private async run(runId: number, first: TeachingResult): Promise<void> {
    let result = first
    let previousStep: RepeatComparableStep | null = null
    let repeatCount = 0
    let consecutiveErrors = 0

    while (this.isCurrent(runId)) {
      if (result.state === "step") {
        repeatCount = isRepeatOfPreviousStep(result, previousStep)
          ? repeatCount + 1
          : 0
        previousStep = result
      }

      const decision = evaluateLoopContinuation({
        stepIndex: this.stepIndex,
        maxSteps: this.options.maxSteps,
        resultState: result.state,
        repeatCount,
        maxRepeats: this.options.maxRepeats,
        consecutiveErrors,
        maxConsecutiveErrors: this.options.maxConsecutiveErrors
      })

      if (decision !== "continue") {
        this.finish(runId, decision, result)
        return
      }

      const step = result as TeachingStepResult
      this.dependencies.showTarget(step)

      const targetApp = await this.dependencies.getFrontmostApp()
      if (!this.isCurrent(runId)) {
        return
      }

      const verdict = classifyStepRisk(step, {
        provider: this.provider,
        targetApp,
        appProbeSupported: this.dependencies.appProbeSupported
      })
      if (verdict.requiresConfirmation) {
        const answer = await this.confirmStep(
          runId,
          step,
          verdict.reasons,
          targetApp
        )
        if (!this.isCurrent(runId) || answer === "stop") {
          return
        }

        if (answer === "reject") {
          // Tell the model it was turned down, so the next capture doesn't
          // simply propose the same action again.
          this.dependencies.session.noteHistory(
            `[declined] The user declined this action: ${step.instruction}`
          )
          const regenerated = await this.generateNext(runId, consecutiveErrors)
          if (!regenerated) {
            return
          }
          result = regenerated.result
          consecutiveErrors = regenerated.consecutiveErrors
          continue
        }
      }

      this.emit(runId, { phase: "acting", result: step })

      // Never actuate under our own highlight, and never let it reach the next
      // capture (content protection covers the invisible build, not INVISIBLE=false).
      this.dependencies.clearTarget()

      if (step.action !== "wait") {
        try {
          await this.dependencies.session.actuatePending()
        } catch (error) {
          if (this.isCurrent(runId)) {
            this.fail(runId, error)
          }
          return
        }
        if (!this.isCurrent(runId)) {
          return
        }
        this.stepIndex += 1
      }

      await this.dependencies.sleep(
        step.action === "wait" ? this.options.waitMs : this.options.settleMs
      )
      if (!this.isCurrent(runId)) {
        return
      }

      const generated = await this.generateNext(runId, consecutiveErrors)
      if (!generated) {
        return
      }
      result = generated.result
      consecutiveErrors = generated.consecutiveErrors
    }
  }

  /**
   * Capture and generate the next step, retrying transient model failures.
   * Returns null when the run ended (stale, or out of retries) — the caller
   * should simply return.
   */
  private async generateNext(
    runId: number,
    consecutiveErrors: number
  ): Promise<{ result: TeachingResult; consecutiveErrors: number } | null> {
    let errors = consecutiveErrors

    while (this.isCurrent(runId)) {
      this.emit(runId, { phase: "thinking" })
      try {
        const result = await this.dependencies.session.next()
        if (!this.isCurrent(runId)) {
          return null
        }
        return { result, consecutiveErrors: 0 }
      } catch (error) {
        if (!this.isCurrent(runId)) {
          return null
        }

        errors += 1
        if (errors >= this.options.maxConsecutiveErrors) {
          this.fail(runId, error, "stop-errors")
          return null
        }

        await this.dependencies.sleep(this.options.retryDelayMs)
      }
    }

    return null
  }

  /**
   * Park the step until the user answers — then, on approval, make sure focus
   * hasn't moved somewhere we're not allowed to act unattended. The wait is
   * unbounded, so the app that was frontmost when we classified the step is not
   * necessarily the app that will receive the click.
   */
  private async confirmStep(
    runId: number,
    step: TeachingStepResult,
    initialReasons: string[],
    initialApp: FrontmostApp | null
  ): Promise<Decision> {
    let reasons = initialReasons
    let approvedApp = initialApp

    while (this.isCurrent(runId)) {
      this.emit(runId, {
        phase: "awaiting-confirmation",
        result: step,
        reasons
      })

      const answer = await this.awaitDecision()
      if (!this.isCurrent(runId) || answer !== "confirm") {
        return answer
      }

      const currentApp = await this.dependencies.getFrontmostApp(true)
      if (!this.isCurrent(runId)) {
        return "stop"
      }

      if (isSameApp(currentApp, approvedApp)) {
        return "confirm"
      }

      // Only the app-identity rule can re-open a decision the user just made;
      // re-running the action rules would ask the same question forever.
      const appReasons = classifyAppRisk(step, {
        provider: this.provider,
        targetApp: currentApp,
        appProbeSupported: this.dependencies.appProbeSupported
      })
      if (appReasons.length === 0) {
        return "confirm"
      }

      approvedApp = currentApp
      reasons = [
        `Focus moved to ${currentApp?.name ?? "another app"} while you were deciding.`,
        ...appReasons
      ]
    }

    return "stop"
  }

  private awaitDecision(): Promise<Decision> {
    return new Promise<Decision>((resolve) => {
      this.pendingDecision = resolve
    })
  }

  private settleDecision(answer: Decision): void {
    const resolve = this.pendingDecision
    this.pendingDecision = null
    resolve?.(answer)
  }

  private isCurrent(runId: number): boolean {
    return this.running && this.runId === runId
  }

  private finish(
    runId: number,
    decision: Exclude<LoopDecision, "continue">,
    result: TeachingResult
  ): void {
    this.running = false
    this.settleDecision("stop")
    this.dependencies.clearTarget()

    const phase: AutopilotPhase =
      decision === "stop-complete"
        ? "complete"
        : decision === "stop-blocked"
          ? "blocked"
          : "stopped"

    this.dependencies.emit({
      phase,
      runId,
      goal: this.goal,
      stepIndex: this.stepIndex,
      maxSteps: this.options.maxSteps,
      result,
      stopReason: describeLoopStop(decision)
    })
  }

  private fail(
    runId: number,
    error: unknown,
    decision: Extract<LoopDecision, "stop-errors"> | null = null
  ): void {
    this.running = false
    this.settleDecision("stop")
    this.dependencies.clearTarget()

    this.dependencies.emit({
      phase: "error",
      runId,
      goal: this.goal,
      stepIndex: this.stepIndex,
      maxSteps: this.options.maxSteps,
      error: error instanceof Error ? error.message : String(error),
      ...(decision ? { stopReason: describeLoopStop(decision) } : {})
    })
  }

  private emit(
    runId: number,
    update: Omit<AutopilotUpdate, "runId" | "goal" | "stepIndex" | "maxSteps">
  ): void {
    if (!this.isCurrent(runId)) {
      return
    }
    this.dependencies.emit({
      runId,
      goal: this.goal,
      stepIndex: this.stepIndex,
      maxSteps: this.options.maxSteps,
      ...update
    })
  }
}
