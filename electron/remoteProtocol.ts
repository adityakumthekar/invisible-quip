// remoteProtocol.ts
//
// The wire format between the phone and the laptop, plus the validator that
// every inbound message must survive. Pure — no Electron, no I/O — so the phone
// bundle imports it directly (via src/lib/remoteProtocol.ts) and gets the same
// types the server enforces.
//
// This file is half of the security boundary. `parseRemoteCommand` is the only
// way a command type enters the system: anything not named in its switch is
// refused, so the set of things a paired phone can ask for is exactly the set
// enumerated here. Widening it is a deliberate act, not an accident of routing.

import type { AutopilotUpdate } from "./autopilot"
import { parseKeyCombo } from "./teachingContract"

/** Bumped when the message shapes change incompatibly. */
export const REMOTE_PROTOCOL_VERSION = 2

/** Rejected beyond this so a paired device can't push an unbounded prompt. */
export const MAX_GOAL_LENGTH = 2000
export const MAX_MESSAGE_LENGTH = 8000
export const MAX_REQUEST_ID_LENGTH = 128
export const MAX_AUTOPILOT_STEPS = 50

/** One `input/text` burst. The soft keyboard sends far less than this. */
export const MAX_INPUT_TEXT_LENGTH = 2000
/** Per-event scroll delta, in the same units nut-js scroll steps use. */
export const MAX_SCROLL_DELTA = 2000

/**
 * Stream quality, chosen on the phone and named in the stream URL.
 *
 * Three presets rather than free-form width/quality/fps parameters: the client
 * picks a trade-off, not three numbers whose bad combinations (1440p at 30fps)
 * would only be discovered by melting the laptop. Every value here is also a
 * per-frame cost on the *capture* side, which is the real budget — see the
 * capture note in remoteServer.handleScreenStream.
 */
export type ScreenPreset = "low" | "medium" | "high"

export const SCREEN_PRESETS: Record<
  ScreenPreset,
  { width: number; quality: number; fps: number }
> = {
  low: { width: 640, quality: 45, fps: 6 },
  medium: { width: 900, quality: 60, fps: 10 },
  high: { width: 1280, quality: 70, fps: 12 }
}

export const DEFAULT_SCREEN_PRESET: ScreenPreset = "medium"

/** Unknown or absent falls back rather than failing — this is a URL param. */
export function parseScreenPreset(raw: string | null | undefined): ScreenPreset {
  return raw === "low" || raw === "medium" || raw === "high"
    ? raw
    : DEFAULT_SCREEN_PRESET
}

// ---------------------------------------------------------------------------
// Laptop → phone (SSE)
// ---------------------------------------------------------------------------

export interface RemoteScreenFrame {
  /** JPEG data URL, already downscaled for a phone screen. */
  dataUrl: string
  width: number
  height: number
  capturedAt: string
  /** Which display this frame shows, so a tap on it maps back correctly. */
  displayId: number
}

/** A display the phone may watch and drive. Bounds are in DIPs. */
export interface RemoteDisplay {
  id: number
  label: string
  width: number
  height: number
  primary: boolean
}

export interface RemoteStatus {
  protocolVersion: number
  /** Whether the user has accepted the separate remote-control consent. */
  controlEnabled: boolean
  /**
   * Whether the phone may drive the mouse and keyboard directly. Distinct from
   * `controlEnabled`: this needs its own consent *and* a toggle that the laptop
   * kill switch can flip without revoking anything.
   */
  inputEnabled: boolean
  /** Blocking reason from the existing privacy gate, if it isn't satisfied. */
  gateBlockedBy: "acknowledgement" | "preflight" | "autopilot-consent" | null
  autopilotRunning: boolean
  deviceName: string
  displays: RemoteDisplay[]
  activeDisplayId: number | null
}

export type RemoteEvent =
  | { type: "status"; status: RemoteStatus }
  | { type: "autopilot-update"; update: AutopilotUpdate }
  | { type: "screen-frame"; frame: RemoteScreenFrame }
  | { type: "chat-chunk"; requestId: string; delta: string }
  | { type: "chat-done"; requestId: string; text: string }
  | { type: "chat-error"; requestId: string; message: string }

// ---------------------------------------------------------------------------
// Phone → laptop (POST /api/command)
// ---------------------------------------------------------------------------

/**
 * A point on a captured frame, as a fraction of that frame's width and height.
 *
 * The phone never sends screen pixels. It cannot know the display's real
 * resolution or scale factor, and if it could, a pixel pair would be a number
 * the laptop had to trust and bounds-check against a display that may have
 * changed size since the frame was taken. A fraction in [0,1] against a named
 * display is checkable on its face, and the laptop resolves it with the same
 * geometry it used to capture.
 */
export interface NormalizedPoint {
  x: number
  y: number
  displayId: number
}

export type RemoteCommand =
  | { type: "status/get" }
  | { type: "screen/frame" }
  | { type: "screen/select"; displayId: number }
  | { type: "autopilot/start"; goal: string; maxSteps?: number }
  | { type: "autopilot/confirm" }
  | { type: "autopilot/reject" }
  | { type: "autopilot/stop" }
  | { type: "chat/send"; requestId: string; message: string; withScreen: boolean; persona?: string }
  | { type: "chat/cancel"; requestId: string }
  | { type: "input/click"; point: NormalizedPoint; button: "left" | "right"; clicks: 1 | 2 }
  | { type: "input/drag"; from: NormalizedPoint; to: NormalizedPoint }
  | { type: "input/scroll"; point: NormalizedPoint; dx: number; dy: number }
  | { type: "input/text"; text: string }
  | { type: "input/key"; combo: string }

export type RemoteCommandType = RemoteCommand["type"]

/**
 * The commands that move the real mouse and keyboard.
 *
 * These are the ones that make a paired phone equivalent to sitting at the
 * machine, so they are gated separately from everything else — see
 * REMOTE_INPUT_CONSENT_TEXT and routeRemoteCommand. Nothing may be added here
 * without a matching entry in RemoteCapabilities and a look at that consent.
 */
export const INPUT_COMMAND_TYPES: readonly RemoteCommandType[] = [
  "input/click",
  "input/drag",
  "input/scroll",
  "input/text",
  "input/key"
]

export function isInputCommand(type: RemoteCommandType): boolean {
  return INPUT_COMMAND_TYPES.includes(type)
}

/**
 * Commands a paired device may issue before the remote-control consent has been
 * accepted. Everything else is refused by the router — see routeRemoteCommand.
 *
 * Status and screen frames are observation, not actuation: neither can move the
 * cursor. `autopilot/stop` is here for the opposite reason — it only ever
 * *reduces* what the machine is doing, and a stop button that can be gated off
 * is worse than useless. A phone must always be able to halt a run it can see,
 * including one started at the laptop.
 */
export const PRE_CONSENT_COMMAND_TYPES: readonly RemoteCommandType[] = [
  "status/get",
  "screen/frame",
  "autopilot/stop"
]

export function isAllowedBeforeConsent(type: RemoteCommandType): boolean {
  return PRE_CONSENT_COMMAND_TYPES.includes(type)
}

export type ParseResult =
  | { ok: true; command: RemoteCommand }
  | { ok: false; error: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * A required string field, trimmed, non-empty, and length-capped. Returns null
 * rather than throwing so each caller can name the field in its own error.
 */
function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return null
  }
  return trimmed
}

/**
 * A finite number within an inclusive range.
 *
 * `Number.isFinite` first, and deliberately not a bare `value >= min && <= max`:
 * NaN fails both comparisons so it would be caught, but `Infinity` against an
 * unbounded side would not, and neither would survive the arithmetic downstream.
 */
function readBoundedNumber(
  value: unknown,
  min: number,
  max: number
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null
  }
  if (value < min || value > max) {
    return null
  }
  return value
}

function readDisplayId(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null
  }
  return value
}

/** A `{ x, y, displayId }` with both coordinates inside the frame. */
function readNormalizedPoint(value: unknown): NormalizedPoint | null {
  if (!isPlainObject(value)) {
    return null
  }
  const x = readBoundedNumber(value.x, 0, 1)
  const y = readBoundedNumber(value.y, 0, 1)
  const displayId = readDisplayId(value.displayId)
  if (x === null || y === null || displayId === null) {
    return null
  }
  return { x, y, displayId }
}

/**
 * Validate an untrusted payload into a `RemoteCommand`.
 *
 * Written as a total function over `unknown` because the input arrives from the
 * network: anything that isn't an exact match — unknown type, wrong field type,
 * oversized string, prototype-polluting key — comes back as `ok: false` and is
 * refused by the caller. There is deliberately no passthrough branch.
 */
export function parseRemoteCommand(input: unknown): ParseResult {
  if (!isPlainObject(input)) {
    return { ok: false, error: "Command must be an object" }
  }

  // Read only own properties, from a null-prototype copy. A field inherited
  // through the prototype chain is never something the sender legitimately
  // put on the wire, so it must not be able to stand in for a real one.
  const raw: Record<string, unknown> = Object.assign(
    Object.create(null),
    Object.fromEntries(Object.entries(input))
  )

  const type = raw.type
  if (typeof type !== "string") {
    return { ok: false, error: "Command type must be a string" }
  }

  switch (type) {
    case "status/get":
    case "screen/frame":
    case "autopilot/confirm":
    case "autopilot/reject":
    case "autopilot/stop":
      return { ok: true, command: { type } }

    case "autopilot/start": {
      const goal = readText(raw.goal, MAX_GOAL_LENGTH)
      if (!goal) {
        return { ok: false, error: "A goal is required" }
      }

      if (raw.maxSteps === undefined) {
        return { ok: true, command: { type, goal } }
      }
      const maxSteps = raw.maxSteps
      if (
        typeof maxSteps !== "number" ||
        !Number.isInteger(maxSteps) ||
        maxSteps < 1 ||
        maxSteps > MAX_AUTOPILOT_STEPS
      ) {
        return {
          ok: false,
          error: `maxSteps must be an integer between 1 and ${MAX_AUTOPILOT_STEPS}`
        }
      }
      return { ok: true, command: { type, goal, maxSteps } }
    }

    case "chat/send": {
      const requestId = readText(raw.requestId, MAX_REQUEST_ID_LENGTH)
      if (!requestId) {
        return { ok: false, error: "A requestId is required" }
      }
      const message = readText(raw.message, MAX_MESSAGE_LENGTH)
      if (!message) {
        return { ok: false, error: "A message is required" }
      }
      if (raw.withScreen !== undefined && typeof raw.withScreen !== "boolean") {
        return { ok: false, error: "withScreen must be a boolean" }
      }
      if (raw.persona !== undefined && typeof raw.persona !== "string") {
        return { ok: false, error: "persona must be a string" }
      }
      return {
        ok: true,
        command: {
          type,
          requestId,
          message,
          withScreen: raw.withScreen === true,
          ...(typeof raw.persona === "string" ? { persona: raw.persona } : {})
        }
      }
    }

    case "chat/cancel": {
      const requestId = readText(raw.requestId, MAX_REQUEST_ID_LENGTH)
      if (!requestId) {
        return { ok: false, error: "A requestId is required" }
      }
      return { ok: true, command: { type, requestId } }
    }

    case "screen/select": {
      const displayId = readDisplayId(raw.displayId)
      if (displayId === null) {
        return { ok: false, error: "displayId must be an integer" }
      }
      return { ok: true, command: { type, displayId } }
    }

    case "input/click": {
      const point = readNormalizedPoint(raw.point)
      if (!point) {
        return { ok: false, error: "point must be {x, y} in 0..1 with a displayId" }
      }
      if (raw.button !== undefined && raw.button !== "left" && raw.button !== "right") {
        return { ok: false, error: "button must be 'left' or 'right'" }
      }
      if (raw.clicks !== undefined && raw.clicks !== 1 && raw.clicks !== 2) {
        return { ok: false, error: "clicks must be 1 or 2" }
      }
      return {
        ok: true,
        command: {
          type,
          point,
          button: raw.button === "right" ? "right" : "left",
          clicks: raw.clicks === 2 ? 2 : 1
        }
      }
    }

    case "input/drag": {
      const from = readNormalizedPoint(raw.from)
      const to = readNormalizedPoint(raw.to)
      if (!from || !to) {
        return { ok: false, error: "from and to must be {x, y} in 0..1 with a displayId" }
      }
      // A drag that starts on one display and ends on another would have to be
      // resolved against two different geometries; the gesture layer never
      // produces one, so refuse it rather than guess which display wins.
      if (from.displayId !== to.displayId) {
        return { ok: false, error: "A drag must stay on one display" }
      }
      return { ok: true, command: { type, from, to } }
    }

    case "input/scroll": {
      const point = readNormalizedPoint(raw.point)
      if (!point) {
        return { ok: false, error: "point must be {x, y} in 0..1 with a displayId" }
      }
      const dx = readBoundedNumber(raw.dx, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA)
      const dy = readBoundedNumber(raw.dy, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA)
      if (dx === null || dy === null) {
        return {
          ok: false,
          error: `dx and dy must be numbers within ±${MAX_SCROLL_DELTA}`
        }
      }
      return { ok: true, command: { type, point, dx, dy } }
    }

    case "input/text": {
      // Not `readText`: leading and trailing spaces are meaningful when the
      // point is to reproduce keystrokes, and " " is a legitimate send.
      if (typeof raw.text !== "string") {
        return { ok: false, error: "text must be a string" }
      }
      if (raw.text.length === 0 || raw.text.length > MAX_INPUT_TEXT_LENGTH) {
        return {
          ok: false,
          error: `text must be 1 to ${MAX_INPUT_TEXT_LENGTH} characters`
        }
      }
      return { ok: true, command: { type, text: raw.text } }
    }

    case "input/key": {
      // Reuses the Teach Me allow-list rather than repeating it: whatever
      // parseKeyCombo refuses to normalize never reaches nut-js, and there is
      // only one place where the set of pressable keys is defined.
      try {
        return { ok: true, command: { type, combo: parseKeyCombo(raw.combo) } }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unsupported key combo"
        }
      }
    }

    default:
      return { ok: false, error: `Unsupported command: ${type}` }
  }
}

/** Serialize an event as an SSE frame. */
export function formatServerSentEvent(event: RemoteEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}
