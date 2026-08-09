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

export type AutopilotProvider = "gemini" | "ollama" | "qwen"

/**
 * How much a run is trusted to do without asking.
 *
 * "guarded" — everything that isn't pure navigation stops for a human. The
 * original behaviour, and the fail-safe default everywhere a level is missing
 * or unrecognised.
 *
 * "balanced" — only genuinely irreversible things stop: the danger lexicon, the
 * model's own flag, destructive key combos, credential-looking text, and the
 * sensitive-app gates. Ordinary clicking and typing runs on its own. This is
 * the level the automation story is built around.
 *
 * "handsoff" — drops the app gates too, so a run keeps going inside a terminal
 * or System Settings. Only the content rules remain.
 *
 * NOTE: every level above "guarded" assumes the user is at the machine while a
 * run happens — which is what the autopilot consent copy promises. If autopilot
 * ever becomes startable from the phone remote, that premise is gone and these
 * levels need revisiting: "balanced" would mean typing and clicking with nobody
 * at the keyboard.
 */
export type AutonomyLevel = "guarded" | "balanced" | "handsoff"

const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [
  "guarded",
  "balanced",
  "handsoff"
]

export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = "balanced"

/** Anything unrecognised falls back to the strictest level, never the loosest. */
export function parseAutonomyLevel(value: unknown): AutonomyLevel | null {
  return typeof value === "string" &&
    AUTONOMY_LEVELS.includes(value as AutonomyLevel)
    ? (value as AutonomyLevel)
    : null
}

export function describeAutonomyLevel(level: AutonomyLevel): string {
  switch (level) {
    case "guarded":
      return "Ask before anything but navigation"
    case "balanced":
      return "Ask only before irreversible actions"
    case "handsoff":
      return "Ask only before irreversible actions, in any app"
  }
}

/**
 * How well a provider grounds a coordinate on a real screen. Small local
 * checkpoints miss by enough that the bar for acting unattended is lower for
 * them; a hosted frontier model — Gemini, or Qwen3-VL on a remote vLLM — does
 * not need that handicap. Only consulted at "guarded".
 */
const PROVIDER_GROUNDING: Record<AutopilotProvider, "high" | "low"> = {
  gemini: "high",
  qwen: "high",
  ollama: "low"
}

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
  /** Present only when action is "key"; already normalised by parseKeyCombo. */
  key?: string
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

/**
 * True for key combos that destroy something whatever app is in front.
 *
 * Deliberately narrow. Plain Enter after typing into a search box is the bread
 * and butter of automation, and gating it would make "balanced" useless — the
 * Enter-in-a-compose-box case is already covered by the messaging app's
 * transmit gate. Deletion is different: cmd+delete moves a file to the Trash,
 * shift+delete skips it entirely, and neither is something to discover after
 * the fact.
 *
 * `key` arrives already lower-cased and "+"-joined from parseKeyCombo.
 */
export function isDestructiveKeyCombo(key: string | undefined): boolean {
  if (typeof key !== "string") {
    return false
  }

  const tokens = key.trim().toLowerCase().split("+")
  if (tokens.length < 2) {
    // A bare Delete just edits text; it needs a modifier to reach a filesystem.
    return false
  }

  const main = tokens[tokens.length - 1]
  return main === "delete" || main === "backspace"
}

/**
 * Patterns that mark a string as a secret. Kept as (name, pattern) pairs so the
 * reason we surface names the *kind* of thing matched and never echoes the
 * value itself — reasons are rendered in the panel and written to logs.
 */
const SECRET_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: "an API key", pattern: /\b(?:sk|pk)-[A-Za-z0-9_-]{16,}/ },
  { name: "a GitHub token", pattern: /\bgh[posu]_[A-Za-z0-9]{16,}/ },
  { name: "a Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{16,}/ },
  { name: "an AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "a social security number", pattern: /\b\d{3}-\d{2}-\d{4}\b/ }
]

/** Words that make an input field a credential field, whatever gets typed. */
const SECRET_FIELD_PATTERN =
  /\b(?:password|passcode|passphrase|secret|api[ _-]?key|access[ _-]?token|credit card|card number|cvv|social security)\b/i

function luhnValid(digits: string): boolean {
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48
    if (double) {
      digit *= 2
      if (digit > 9) {
        digit -= 9
      }
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

/** A 13–19 digit run, separators allowed, that passes Luhn — i.e. a card. */
function looksLikeCardNumber(text: string): boolean {
  const candidates = text.match(/\b(?:\d[ -]?){12,18}\d\b/g) ?? []
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, "")
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits)
  })
}

/**
 * Whether a step is about to type something that shouldn't be typed by a robot.
 * Only meaningful once typing runs unattended: the typed string is the surface
 * that the danger lexicon alone doesn't cover.
 */
export function findSecretIndicators(step: RiskAssessableStep): string[] {
  if (step.action !== "type") {
    return []
  }

  const found: string[] = []

  if (typeof step.text === "string") {
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(step.text)) {
        found.push(name)
      }
    }
    if (looksLikeCardNumber(step.text)) {
      found.push("a card number")
    }
  }

  if (
    found.length === 0 &&
    SECRET_FIELD_PATTERN.test(`${step.label ?? ""} ${step.instruction}`)
  ) {
    found.push("a credential field")
  }

  return found
}

export interface RiskContext {
  provider: AutopilotProvider
  /** How much this run may do unattended. Defaults to the strictest level. */
  autonomy?: AutonomyLevel
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
  // "handsoff" is exactly the level that trades these gates away.
  if ((context.autonomy ?? "guarded") === "handsoff") {
    return []
  }

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
  const autonomy = context.autonomy ?? "guarded"

  // App gates first, so the reason naming *where* we are leads the list.
  // classifyAppRisk applies its own "handsoff" carve-out.
  const reasons: string[] = [...classifyAppRisk(step, context)]

  // --- Rules that apply at every level: the irreversible ones. ---

  if (step.risk === "confirm") {
    reasons.push("The model flagged this step as needing your approval.")
  }

  const dangerTerms = findDangerTerms(step.label, step.instruction, step.text)
  if (dangerTerms.length > 0) {
    reasons.push(
      `This step mentions ${dangerTerms
        .map((term) => `“${term}”`)
        .join(", ")} — it may not be undoable.`
    )
  }

  if (step.action === "key" && isDestructiveKeyCombo(step.key)) {
    reasons.push(`“${step.key}” deletes something — that needs your approval.`)
  }

  const secrets = findSecretIndicators(step)
  if (secrets.length > 0) {
    reasons.push(
      `This step would type what looks like ${secrets.join(" and ")} — ` +
        "credentials always need your approval."
    )
  }

  // --- Rules that only apply at "guarded". ---

  if (autonomy === "guarded") {
    if (ALWAYS_CONFIRM_ACTIONS.includes(step.action)) {
      reasons.push(`“${step.action}” always needs your approval.`)
    }

    if (
      PROVIDER_GROUNDING[context.provider] === "low" &&
      !NAVIGATION_ACTIONS.includes(step.action)
    ) {
      reasons.push(
        "Local models locate on-screen elements less precisely, so this action needs a check."
      )
    }
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
