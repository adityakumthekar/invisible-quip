// autopilotPolicy.ts
//
// The rules that decide when an unattended run must stop and ask a human.
// Pure — no Electron, no I/O — so every branch is cheap to test, and so the
// safety envelope can't be changed by anything the model says. The model gets
// a vote (its own `risk` field) but never a veto: classifyStepRisk can only
// escalate its verdict, never downgrade it.

import type { DipRect } from "./teachingGeometry"
import type { TeachingAction, TeachingRisk, TeachingScroll } from "./teachingContract"
import type { FrontmostApp } from "./frontmostApp"
import {
  classifyAppSensitivity,
  describeSensitiveCategory,
  gateForCategory
} from "./sensitiveApps"

export type AutopilotProvider = "gemini" | "ollama"

/**
 * Words that mark an action as hard or impossible to undo. Matched on word
 * boundaries against the target's label, the instruction, and any text about
 * to be typed. Deliberately biased toward over-triggering: a false positive
 * costs one keystroke, a false negative costs a sent email.
 */
export const DANGER_LEXICON: readonly string[] = [
  "send",
  "resend",
  "reply all",
  "forward",
  "post",
  "publish",
  "share",
  "submit",
  "confirm",
  "delete",
  "remove",
  "trash",
  "erase",
  "discard",
  "archive",
  "overwrite",
  "format",
  "uninstall",
  "reset",
  "pay",
  "buy",
  "purchase",
  "checkout",
  "order",
  "subscribe",
  "transfer",
  "sign out",
  "log out",
  "block",
  "leave",
  "revoke"
]

/**
 * Actions that always need a human, whatever the model claims. Typing puts
 * arbitrary content somewhere; drag needs two accurate points instead of one
 * and is the least reliable thing a vision model grounds; right-click opens
 * menus whose contents we haven't seen yet.
 */
const ALWAYS_CONFIRM_ACTIONS: readonly TeachingAction[] = [
  "type",
  "drag",
  "right-click"
]

/**
 * Actions that only move around the screen: they don't put content anywhere and
 * they don't commit anything. Two rules lean on this list — the Ollama one,
 * because local vision models ground coordinates noticeably worse than Gemini
 * so the bar for "just do it" is lower; and the "transmit" app gate, because
 * reading a Slack thread is harmless while pressing Return in it is not.
 */
const NAVIGATION_ACTIONS: readonly TeachingAction[] = ["click", "scroll", "wait"]

export interface RiskAssessableStep {
  action: TeachingAction
  risk: TeachingRisk
  instruction: string
  label?: string
  text?: string
}

export interface RiskVerdict {
  requiresConfirmation: boolean
  /** Human-readable, shown in the confirmation prompt. Empty when unattended. */
  reasons: string[]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Word-boundary match, so "sender" doesn't trip the "send" rule. */
export function findDangerTerms(...haystacks: (string | undefined)[]): string[] {
  const text = haystacks
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()

  if (!text.trim()) {
    return []
  }

  return DANGER_LEXICON.filter((term) =>
    new RegExp(`\\b${escapeRegExp(term)}\\b`).test(text)
  )
}

export interface RiskContext {
  provider: AutopilotProvider
  /** The app that owns the screen right now; null when the probe couldn't say. */
  targetApp?: FrontmostApp | null
  /**
   * Whether this platform can identify the frontmost app at all. When it can,
   * a null `targetApp` means we lost the ability to tell — which escalates.
   * When it can't (non-macOS), the rule is skipped rather than confirming every
   * single step forever.
   */
  appProbeSupported?: boolean
}

/**
 * The app-identity rule on its own, so a step already approved by the user can
 * be re-checked against the app that is frontmost *now* without re-triggering
 * the action-based rules the user just answered for.
 *
 * Action-aware, because the two gate strengths differ in exactly that way:
 * terminals and settings stop everything, messaging apps stop only what can
 * transmit.
 */
export function classifyAppRisk(
  step: Pick<RiskAssessableStep, "action">,
  context: RiskContext
): string[] {
  const sensitivity = classifyAppSensitivity(context.targetApp)

  if (sensitivity) {
    const appName = context.targetApp?.name ?? "This app"

    if (gateForCategory(sensitivity) === "always") {
      return [
        `${appName} is off-limits unattended — ${describeSensitiveCategory(
          sensitivity
        ).toLowerCase()} always need your approval.`
      ]
    }

    if (!NAVIGATION_ACTIONS.includes(step.action)) {
      return [
        `“${step.action}” in ${appName} could send something — ${describeSensitiveCategory(
          sensitivity
        ).toLowerCase()} need your approval for this.`
      ]
    }

    return []
  }

  // Probe available but silent: we don't know where we are, so hold anything
  // that could commit something. Holding *every* step would make a blocked
  // Automation permission indistinguishable from autopilot being switched off.
  if (
    context.appProbeSupported &&
    !context.targetApp &&
    !NAVIGATION_ACTIONS.includes(step.action)
  ) {
    return [
      `Couldn't tell which app is in front, so “${step.action}” needs your approval.`
    ]
  }

  return []
}

export function classifyStepRisk(
  step: RiskAssessableStep,
  context: RiskContext
): RiskVerdict {
  const reasons: string[] = [...classifyAppRisk(step, context)]

  if (step.risk === "confirm") {
    reasons.push("The model flagged this step as needing your approval.")
  }

  if (ALWAYS_CONFIRM_ACTIONS.includes(step.action)) {
    reasons.push(`“${step.action}” always needs your approval.`)
  }

  const dangerTerms = findDangerTerms(step.label, step.instruction, step.text)
  if (dangerTerms.length > 0) {
    reasons.push(
      `This step mentions ${dangerTerms
        .map((term) => `“${term}”`)
        .join(", ")} — it may not be undoable.`
    )
  }

  if (
    context.provider === "ollama" &&
    !NAVIGATION_ACTIONS.includes(step.action)
  ) {
    reasons.push(
      "Local models locate on-screen elements less precisely, so this action needs a check."
    )
  }

  return { requiresConfirmation: reasons.length > 0, reasons }
}

export interface RepeatComparableStep {
  action: TeachingAction
  target: DipRect
  text?: string
  key?: string
  scroll?: TeachingScroll
}

/** Default tolerance, in DIP, for calling two targets "the same place". */
export const REPEAT_POSITION_TOLERANCE = 8

/**
 * True when a step is materially identical to the one before it. Two of these
 * in a row means the screen isn't responding to what we're doing — the cheap,
 * deterministic stall signal, with no image hashing involved.
 */
export function isRepeatOfPreviousStep(
  current: RepeatComparableStep,
  previous: RepeatComparableStep | null,
  tolerance: number = REPEAT_POSITION_TOLERANCE
): boolean {
  if (!previous || current.action !== previous.action) {
    return false
  }

  const sameSpot =
    Math.abs(current.target.x - previous.target.x) <= tolerance &&
    Math.abs(current.target.y - previous.target.y) <= tolerance
  if (!sameSpot) {
    return false
  }

  return (
    current.text === previous.text &&
    current.key === previous.key &&
    current.scroll?.direction === previous.scroll?.direction &&
    current.scroll?.amount === previous.scroll?.amount
  )
}

export type LoopDecision =
  | "continue"
  | "stop-complete"
  | "stop-blocked"
  | "stop-budget"
  | "stop-stalled"
  | "stop-errors"

export interface LoopState {
  /** Actions actuated so far this run. */
  stepIndex: number
  maxSteps: number
  resultState: "step" | "complete" | "blocked"
  /** Consecutive steps identical to their predecessor. */
  repeatCount: number
  maxRepeats: number
  consecutiveErrors: number
  maxConsecutiveErrors: number
}

export function evaluateLoopContinuation(state: LoopState): LoopDecision {
  if (state.resultState === "complete") {
    return "stop-complete"
  }
  if (state.resultState === "blocked") {
    return "stop-blocked"
  }
  if (state.consecutiveErrors >= state.maxConsecutiveErrors) {
    return "stop-errors"
  }
  if (state.repeatCount >= state.maxRepeats) {
    return "stop-stalled"
  }
  if (state.stepIndex >= state.maxSteps) {
    return "stop-budget"
  }
  return "continue"
}

export function describeLoopStop(decision: Exclude<LoopDecision, "continue">): string {
  switch (decision) {
    case "stop-complete":
      return "Finished the goal."
    case "stop-blocked":
      return "Stopped — no safe next action was visible."
    case "stop-budget":
      return "Stopped after reaching the step limit for this run."
    case "stop-stalled":
      return "Stopped — the screen stopped responding to the same action."
    case "stop-errors":
      return "Stopped after repeated errors talking to the model."
  }
}
