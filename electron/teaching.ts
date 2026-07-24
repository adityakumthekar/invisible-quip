export type TeachingState = "step" | "complete" | "blocked"

/** What the assistant should do at a step's target once the user confirms. */
export type TeachingAction = "click" | "type"

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

/** Electron display metadata for a captured screenshot. */
export interface DisplayCaptureInfo {
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  scaleFactor: number
  screenshotWidth: number
  screenshotHeight: number
}

export interface TeachingDisplayCaptureInfo extends DisplayCaptureInfo {
  displayId: number
}

export interface TeachingCapture {
  path: string
  display: TeachingDisplayCaptureInfo
}

export interface TeachingDisplaySource {
  id: number
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  scaleFactor: number
}

export interface ImageDimensions {
  width?: number
  height?: number
}

export interface DipPoint {
  x: number
  y: number
}

export interface DipRect {
  x: number
  y: number
  width: number
  height: number
}

export type TeachingResult =
  | {
      state: "step"
      instruction: string
      label?: string
      action: TeachingAction
      text?: string
      target: DipRect
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

/**
 * A confirmed action to actuate on the real screen: where to click (the target
 * center, in global DIP coordinates) and, for "type", the text to enter.
 */
export interface TeachingActuation {
  action: TeachingAction
  point: DipPoint
  text?: string
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

const TEACHING_STATES: TeachingState[] = ["step", "complete", "blocked"]
const TEACHING_ACTIONS: TeachingAction[] = ["click", "type"]
const RESPONSE_KEYS = new Set([
  "state",
  "instruction",
  "target",
  "label",
  "action",
  "text"
])
const TARGET_KEYS = new Set(["x", "y", "width", "height"])
const MAX_INSTRUCTION_LENGTH = 500

export class TeachingValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TeachingValidationError"
  }
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
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

function parseTarget(value: unknown): TeachingTarget {
  if (!isPlainObject(value)) {
    throw new TeachingValidationError("target must be an object")
  }

  rejectUnknownKeys(value, TARGET_KEYS, "target")

  if (typeof value.x !== "number" || !Number.isFinite(value.x)) {
    throw new TeachingValidationError("target.x must be a finite number")
  }

  if (typeof value.y !== "number" || !Number.isFinite(value.y)) {
    throw new TeachingValidationError("target.y must be a finite number")
  }

  const target: TeachingTarget = {
    x: value.x,
    y: value.y
  }

  if (value.width !== undefined) {
    if (typeof value.width !== "number" || !Number.isFinite(value.width)) {
      throw new TeachingValidationError("target.width must be a finite number")
    }
    if (value.width < 0) {
      throw new TeachingValidationError("target.width must not be negative")
    }
    target.width = value.width
  }

  if (value.height !== undefined) {
    if (typeof value.height !== "number" || !Number.isFinite(value.height)) {
      throw new TeachingValidationError(
        "target.height must be a finite number"
      )
    }
    if (value.height < 0) {
      throw new TeachingValidationError("target.height must not be negative")
    }
    target.height = value.height
  }

  return target
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
    throw new TeachingValidationError("action must be one of: click, type")
  }

  return raw as TeachingAction
}

function parseTypeText(
  raw: unknown,
  action: TeachingAction
): string | undefined {
  if (action === "type") {
    if (typeof raw !== "string") {
      throw new TeachingValidationError("text is required when action is type")
    }
    if (!raw.trim()) {
      throw new TeachingValidationError("text must not be empty")
    }
    return raw
  }

  if (raw !== undefined) {
    throw new TeachingValidationError("text is only allowed when action is type")
  }

  return undefined
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
    const text = parseTypeText(raw.text, action)

    const step: TeachingStepResponseStep = {
      state,
      instruction,
      target: parseTarget(raw.target),
      action
    }

    if (label !== undefined) {
      step.label = label
    }
    if (text !== undefined) {
      step.text = text
    }

    return step
  }

  if (raw.target !== undefined) {
    throw new TeachingValidationError(
      "target is only allowed when state is step"
    )
  }
  if (raw.action !== undefined) {
    throw new TeachingValidationError(
      "action is only allowed when state is step"
    )
  }
  if (raw.text !== undefined) {
    throw new TeachingValidationError("text is only allowed when state is step")
  }

  const terminal: TeachingStepResponseComplete | TeachingStepResponseBlocked =
    {
      state,
      instruction
    }

  if (label !== undefined) {
    terminal.label = label
  }

  return terminal
}

export function screenshotPixelToDip(
  pixel: DipPoint,
  capture: DisplayCaptureInfo
): DipPoint {
  const { bounds, screenshotWidth, screenshotHeight } = capture

  const clampedX = clamp(pixel.x, 0, screenshotWidth)
  const clampedY = clamp(pixel.y, 0, screenshotHeight)

  const dipX = bounds.x + (clampedX * bounds.width) / screenshotWidth
  const dipY = bounds.y + (clampedY * bounds.height) / screenshotHeight

  return {
    x: clamp(dipX, bounds.x, bounds.x + bounds.width),
    y: clamp(dipY, bounds.y, bounds.y + bounds.height)
  }
}

/**
 * Convert Gemini's trained 0–1000 box space into screenshot pixels.
 * (0,0) is top-left; (1000,1000) is bottom-right of the image.
 */
export function normalizedTeachingTargetToPixels(
  target: TeachingTarget,
  screenshotWidth: number,
  screenshotHeight: number
): TeachingTarget {
  const toPixel = (value: number, size: number) => (value / 1000) * size

  const converted: TeachingTarget = {
    x: toPixel(target.x, screenshotWidth),
    y: toPixel(target.y, screenshotHeight)
  }
  if (target.width !== undefined) {
    converted.width = toPixel(target.width, screenshotWidth)
  }
  if (target.height !== undefined) {
    converted.height = toPixel(target.height, screenshotHeight)
  }
  return converted
}

export function screenshotTargetToDipRect(
  target: TeachingTarget,
  capture: DisplayCaptureInfo
): DipRect {
  const { bounds, screenshotWidth, screenshotHeight } = capture
  const origin = screenshotPixelToDip({ x: target.x, y: target.y }, capture)

  const maxX = bounds.x + bounds.width
  const maxY = bounds.y + bounds.height

  const width = clamp(
    ((target.width ?? 0) * bounds.width) / screenshotWidth,
    0,
    maxX - origin.x
  )
  const height = clamp(
    ((target.height ?? 0) * bounds.height) / screenshotHeight,
    0,
    maxY - origin.y
  )

  return {
    x: origin.x,
    y: origin.y,
    width,
    height
  }
}

/** Center of a DIP rect in the same (global) coordinate space as the rect. */
export function dipRectCenter(rect: DipRect): DipPoint {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  }
}

export function createTeachingDisplayCaptureInfo(
  display: TeachingDisplaySource,
  image: ImageDimensions
): TeachingDisplayCaptureInfo {
  if (
    typeof image.width !== "number" ||
    !Number.isFinite(image.width) ||
    image.width <= 0 ||
    typeof image.height !== "number" ||
    !Number.isFinite(image.height) ||
    image.height <= 0
  ) {
    throw new Error("Captured PNG dimensions are unavailable")
  }

  return {
    displayId: display.id,
    bounds: { ...display.bounds },
    scaleFactor: display.scaleFactor,
    screenshotWidth: image.width,
    screenshotHeight: image.height
  }
}

function summarizeTeachingStep(step: TeachingStepResponse): string {
  const label = step.label ? ` (${step.label})` : ""
  return `[${step.state}] ${step.instruction}${label}`
}

function toTeachingResult(
  step: TeachingStepResponse,
  display: TeachingDisplayCaptureInfo
): TeachingResult {
  const label = step.label === undefined ? {} : { label: step.label }

  if (step.state === "step") {
    const text = step.text === undefined ? {} : { text: step.text }
    const pixelTarget = normalizedTeachingTargetToPixels(
      step.target,
      display.screenshotWidth,
      display.screenshotHeight
    )
    const dipTarget = screenshotTargetToDipRect(pixelTarget, display)
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
        ` | "${step.instruction}"`
    )
    return {
      state: step.state,
      instruction: step.instruction,
      ...label,
      action: step.action,
      ...text,
      target: dipTarget,
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
  private pendingStep: Extract<TeachingResult, { state: "step" }> | null = null

  constructor(private readonly dependencies: TeachingSessionDependencies) {}

  private rememberPending(result: TeachingResult): TeachingResult {
    this.pendingStep = result.state === "step" ? result : null
    return result
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
   * Actuate the pending step's confirmed action on the real screen, then
   * advance to the next step. Requires an `actuate` dependency and a pending
   * "step" result. Reuses the same lifecycle/stale guards as `next()`.
   */
  public async execute(): Promise<TeachingResult> {
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
      await actuate({
        action: pending.action,
        point: dipRectCenter(pending.target),
        ...(pending.text !== undefined ? { text: pending.text } : {})
      })
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
