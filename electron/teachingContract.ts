// teachingContract.ts
//
// The wire contract between the vision model and the app: what a single step
// may look like, and a strict parser that rejects anything else. Split out of
// teaching.ts (which re-exports it) when the action vocabulary grew past
// click/type — the parser is the part that has to stay paranoid, so it lives
// on its own with its own tests.

export type TeachingState = "step" | "complete" | "blocked"

/** What the assistant should do at a step's target once the step is approved. */
export type TeachingAction =
  | "click"
  | "double-click"
  | "right-click"
  | "type"
  | "scroll"
  | "key"
  | "drag"
  | "wait"

/**
 * The model's own read on whether a step needs a human. Advisory only: the
 * local rules in autopilotPolicy.ts can escalate a "safe" step, never the
 * reverse (see classifyStepRisk).
 */
export type TeachingRisk = "safe" | "confirm"

export type ScrollDirection = "up" | "down" | "left" | "right"

export interface TeachingScroll {
  direction: ScrollDirection
  /** Scroll notches. Capped so one step can't fling a page into orbit. */
  amount: number
}

export interface TeachingTarget {
  /**
   * Model output uses Gemini's normalized 0–1000 space (see
   * `normalizedTeachingTargetToPixels`). After conversion, values are
   * screenshot pixels before DIP mapping.
   */
  x: number
  y: number
  width?: number
  height?: number
}

interface TeachingStepResponseBase {
  instruction: string
  label?: string
}

export interface TeachingStepResponseStep extends TeachingStepResponseBase {
  state: "step"
  target: TeachingTarget
  /** Defaults to "click" when the model omits it. */
  action: TeachingAction
  /** Text to type; present only when action is "type". */
  text?: string
  /** Key combo to press; present only when action is "key". */
  key?: string
  /** Scroll vector; present only when action is "scroll". */
  scroll?: TeachingScroll
  /** Drag destination; present only when action is "drag". */
  to?: TeachingTarget
  /** Defaults to "safe" when the model omits it. */
  risk: TeachingRisk
}

export interface TeachingStepResponseComplete extends TeachingStepResponseBase {
  state: "complete"
}

export interface TeachingStepResponseBlocked extends TeachingStepResponseBase {
  state: "blocked"
}

export type TeachingStepResponse =
  | TeachingStepResponseStep
  | TeachingStepResponseComplete
  | TeachingStepResponseBlocked

const TEACHING_STATES: TeachingState[] = ["step", "complete", "blocked"]
const TEACHING_ACTIONS: TeachingAction[] = [
  "click",
  "double-click",
  "right-click",
  "type",
  "scroll",
  "key",
  "drag",
  "wait"
]
const TEACHING_RISKS: TeachingRisk[] = ["safe", "confirm"]
const SCROLL_DIRECTIONS: ScrollDirection[] = ["up", "down", "left", "right"]

const RESPONSE_KEYS = new Set([
  "state",
  "instruction",
  "target",
  "label",
  "action",
  "text",
  "key",
  "scroll",
  "to",
  "risk"
])
const TARGET_KEYS = new Set(["x", "y", "width", "height"])
const SCROLL_KEYS = new Set(["direction", "amount"])

const MAX_INSTRUCTION_LENGTH = 500
const MAX_TEXT_LENGTH = 2000
const MAX_SCROLL_AMOUNT = 25

/**
 * Per-action payload fields. A field listed here is required for that action;
 * a field listed for any *other* action is rejected. This is what stops the
 * model from, say, smuggling `text` onto a click.
 */
type StepPayloadField = "text" | "key" | "scroll" | "to"

const ACTION_PAYLOAD: Record<TeachingAction, readonly StepPayloadField[]> = {
  click: [],
  "double-click": [],
  "right-click": [],
  type: ["text"],
  scroll: ["scroll"],
  key: ["key"],
  drag: ["to"],
  wait: []
}

const ALL_PAYLOAD_FIELDS: readonly StepPayloadField[] = [
  "text",
  "key",
  "scroll",
  "to"
]

/**
 * Key combos we're willing to hand to the OS. Deliberately a small allowlist:
 * an unrecognized token from the model should fail parsing loudly rather than
 * reach nut-js and either throw or press something unintended.
 */
const KEY_MODIFIERS = new Set(["cmd", "command", "ctrl", "control", "alt", "option", "shift", "meta"])
const NAMED_KEYS = new Set([
  "enter",
  "return",
  "tab",
  "escape",
  "esc",
  "space",
  "backspace",
  "delete",
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "pageup",
  "pagedown",
  ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`)
])

export class TeachingValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TeachingValidationError"
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  context: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TeachingValidationError(`unknown ${context} property: ${key}`)
    }
  }
}

function parseFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TeachingValidationError(`${field} must be a finite number`)
  }
  return value
}

function parseTargetNamed(value: unknown, context: string): TeachingTarget {
  if (!isPlainObject(value)) {
    throw new TeachingValidationError(`${context} must be an object`)
  }

  rejectUnknownKeys(value, TARGET_KEYS, context)

  const target: TeachingTarget = {
    x: parseFiniteNumber(value.x, `${context}.x`),
    y: parseFiniteNumber(value.y, `${context}.y`)
  }

  if (value.width !== undefined) {
    const width = parseFiniteNumber(value.width, `${context}.width`)
    if (width < 0) {
      throw new TeachingValidationError(`${context}.width must not be negative`)
    }
    target.width = width
  }

  if (value.height !== undefined) {
    const height = parseFiniteNumber(value.height, `${context}.height`)
    if (height < 0) {
      throw new TeachingValidationError(`${context}.height must not be negative`)
    }
    target.height = height
  }

  return target
}

export function parseTarget(value: unknown): TeachingTarget {
  return parseTargetNamed(value, "target")
}

function parseLabel(raw: unknown): string | undefined {
  if (raw === undefined) {
    return undefined
  }

  if (typeof raw !== "string") {
    throw new TeachingValidationError("label must be a string")
  }

  const label = raw.trim()
  if (!label) {
    throw new TeachingValidationError("label must not be empty")
  }

  return label
}

function parseAction(raw: unknown): TeachingAction {
  if (raw === undefined) {
    return "click"
  }

  if (
    typeof raw !== "string" ||
    !TEACHING_ACTIONS.includes(raw as TeachingAction)
  ) {
    throw new TeachingValidationError(
      `action must be one of: ${TEACHING_ACTIONS.join(", ")}`
    )
  }

  return raw as TeachingAction
}

function parseRisk(raw: unknown): TeachingRisk {
  if (raw === undefined) {
    return "safe"
  }

  if (typeof raw !== "string" || !TEACHING_RISKS.includes(raw as TeachingRisk)) {
    throw new TeachingValidationError("risk must be one of: safe, confirm")
  }

  return raw as TeachingRisk
}

function parseText(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new TeachingValidationError("text is required when action is type")
  }
  if (!raw.trim()) {
    throw new TeachingValidationError("text must not be empty")
  }
  if (raw.length > MAX_TEXT_LENGTH) {
    throw new TeachingValidationError(
      `text must be at most ${MAX_TEXT_LENGTH} characters`
    )
  }
  return raw
}

/** Validate a combo like "Enter", "cmd+a", "ctrl+shift+n" against the allowlist. */
export function parseKeyCombo(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new TeachingValidationError("key is required when action is key")
  }

  const combo = raw.trim().toLowerCase()
  if (!combo) {
    throw new TeachingValidationError("key must not be empty")
  }

  const tokens = combo.split("+").map((token) => token.trim())
  if (tokens.some((token) => !token)) {
    throw new TeachingValidationError(`key combo is malformed: ${raw}`)
  }

  const main = tokens[tokens.length - 1]
  const modifiers = tokens.slice(0, -1)

  for (const modifier of modifiers) {
    if (!KEY_MODIFIERS.has(modifier)) {
      throw new TeachingValidationError(`unsupported key modifier: ${modifier}`)
    }
  }

  const isSingleCharacter = /^[a-z0-9]$/.test(main)
  if (!isSingleCharacter && !NAMED_KEYS.has(main)) {
    throw new TeachingValidationError(`unsupported key: ${main}`)
  }

  return [...modifiers, main].join("+")
}

function parseScroll(raw: unknown): TeachingScroll {
  if (!isPlainObject(raw)) {
    throw new TeachingValidationError(
      "scroll is required when action is scroll"
    )
  }

  rejectUnknownKeys(raw, SCROLL_KEYS, "scroll")

  if (
    typeof raw.direction !== "string" ||
    !SCROLL_DIRECTIONS.includes(raw.direction as ScrollDirection)
  ) {
    throw new TeachingValidationError(
      `scroll.direction must be one of: ${SCROLL_DIRECTIONS.join(", ")}`
    )
  }

  const amount = parseFiniteNumber(raw.amount, "scroll.amount")
  if (!Number.isInteger(amount) || amount < 1) {
    throw new TeachingValidationError(
      "scroll.amount must be an integer of at least 1"
    )
  }

  return {
    direction: raw.direction as ScrollDirection,
    amount: Math.min(amount, MAX_SCROLL_AMOUNT)
  }
}

function parseStepPayload(
  raw: Record<string, unknown>,
  action: TeachingAction
): Pick<TeachingStepResponseStep, "text" | "key" | "scroll" | "to"> {
  const required = ACTION_PAYLOAD[action]

  for (const field of ALL_PAYLOAD_FIELDS) {
    if (!required.includes(field) && raw[field] !== undefined) {
      throw new TeachingValidationError(
        `${field} is not allowed when action is ${action}`
      )
    }
  }

  const payload: Pick<
    TeachingStepResponseStep,
    "text" | "key" | "scroll" | "to"
  > = {}

  for (const field of required) {
    switch (field) {
      case "text":
        payload.text = parseText(raw.text)
        break
      case "key":
        payload.key = parseKeyCombo(raw.key)
        break
      case "scroll":
        payload.scroll = parseScroll(raw.scroll)
        break
      case "to":
        if (raw.to === undefined) {
          throw new TeachingValidationError("to is required when action is drag")
        }
        payload.to = parseTargetNamed(raw.to, "to")
        break
    }
  }

  return payload
}

export function parseTeachingResponse(raw: unknown): TeachingStepResponse {
  if (!isPlainObject(raw)) {
    throw new TeachingValidationError("response must be an object")
  }

  rejectUnknownKeys(raw, RESPONSE_KEYS, "response")

  if (
    typeof raw.state !== "string" ||
    !TEACHING_STATES.includes(raw.state as TeachingState)
  ) {
    throw new TeachingValidationError(
      "state must be one of: step, complete, blocked"
    )
  }

  const state = raw.state as TeachingState

  if (typeof raw.instruction !== "string") {
    throw new TeachingValidationError("instruction must be a string")
  }

  const instruction = raw.instruction.trim()
  if (!instruction) {
    throw new TeachingValidationError("instruction must not be empty")
  }

  if (instruction.length > MAX_INSTRUCTION_LENGTH) {
    throw new TeachingValidationError(
      `instruction must be at most ${MAX_INSTRUCTION_LENGTH} characters`
    )
  }

  const label = parseLabel(raw.label)

  if (state === "step") {
    if (raw.target === undefined) {
      throw new TeachingValidationError("step responses must include a target")
    }

    const action = parseAction(raw.action)

    const step: TeachingStepResponseStep = {
      state,
      instruction,
      target: parseTarget(raw.target),
      action,
      risk: parseRisk(raw.risk),
      ...parseStepPayload(raw, action)
    }

    if (label !== undefined) {
      step.label = label
    }

    return step
  }

  for (const field of ["target", "action", "risk", ...ALL_PAYLOAD_FIELDS]) {
    if (raw[field] !== undefined) {
      throw new TeachingValidationError(
        `${field} is only allowed when state is step`
      )
    }
  }

  const terminal: TeachingStepResponseComplete | TeachingStepResponseBlocked = {
    state,
    instruction
  }

  if (label !== undefined) {
    terminal.label = label
  }

  return terminal
}
