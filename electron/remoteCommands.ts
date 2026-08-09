// remoteCommands.ts
//
// The allow-list router: the only path from a network request to anything Quip
// can do. It takes an already-validated `RemoteCommand` (see remoteProtocol.ts)
// and dispatches it to a capability object supplied by ipcHandlers.
//
// Two properties make this the security boundary rather than a switch
// statement that happens to sit near one:
//
//   1. It is pure. No Electron, no `ipcMain`, no filesystem. The capability
//      object is the entire surface the network can reach, so reviewing this
//      file plus that object is a complete audit of remote access.
//   2. It never falls through. There is no default branch that forwards an
//      unrecognized command anywhere; the switch is exhaustive over the union,
//      so adding a command type is a compile error until it is routed here
//      deliberately.
//
// Raw click/keystroke injection *is* reachable from here, through the
// `input/*` commands — but only through a gate of its own. Everything else on
// this router tops out at what autopilot would agree to do, because autopilot
// classifies each step's risk and stops to ask before anything hard to undo.
// Direct input has no such ceiling: it is the user's own hands, so it requires
// a separate consent (REMOTE_INPUT_CONSENT_TEXT) plus a live toggle the laptop
// kill switch can drop, and it is refused outright while autopilot is running.

import {
  isAllowedBeforeConsent,
  isInputCommand,
  type NormalizedPoint,
  type RemoteCommand,
  type RemoteScreenFrame,
  type RemoteStatus
} from "./remoteProtocol"

export interface RemoteChatRequest {
  requestId: string
  message: string
  withScreen: boolean
  persona?: string
}

/** Everything the network is permitted to reach. Nothing else is wired in. */
export interface RemoteCapabilities {
  getStatus: () => Promise<RemoteStatus>
  captureFrame: () => Promise<RemoteScreenFrame>
  /**
   * Raw JPEG bytes for the MJPEG stream. Separate from `captureFrame` because
   * that one base64-encodes into a data URL, and paying a 33% size penalty ten
   * times a second to satisfy a format the stream does not use would be pure
   * waste. Not reachable as a command — the server calls it directly.
   */
  captureJpeg: (options: {
    width: number
    quality: number
  }) => Promise<{ jpeg: Buffer; displayId: number }>
  selectDisplay: (displayId: number) => Promise<void>
  autopilotStart: (
    goal: string,
    options: { maxSteps?: number }
  ) => Promise<{ started: boolean; maxSteps: number }>
  autopilotConfirm: () => void
  autopilotReject: () => void
  autopilotStop: () => void
  chatSend: (request: RemoteChatRequest) => Promise<void>
  chatCancel: (requestId: string) => void
  // The hands. Each resolves a normalized point against the named display's
  // live geometry before touching the OS — see remoteInput.ts.
  inputClick: (
    point: NormalizedPoint,
    options: { button: "left" | "right"; clicks: 1 | 2 }
  ) => Promise<void>
  inputDrag: (from: NormalizedPoint, to: NormalizedPoint) => Promise<void>
  inputScroll: (
    point: NormalizedPoint,
    delta: { dx: number; dy: number }
  ) => Promise<void>
  inputText: (text: string) => Promise<void>
  inputKey: (combo: string) => Promise<void>
}

export interface RemoteCommandContext {
  /** False until the user accepts the remote-control consent on the laptop. */
  controlEnabled: boolean
  /**
   * False until the user accepts the remote-*input* consent and leaves the
   * "Allow phone input" toggle on. Read per request, because the laptop kill
   * switch flips it mid-session.
   */
  inputEnabled: boolean
  /** Autopilot is currently driving the cursor itself. */
  autopilotRunning: boolean
}

export type RemoteCommandOutcome =
  | { ok: true; data?: unknown }
  | { ok: false; status: number; error: string }

export const CONTROL_NOT_CONSENTED_MESSAGE =
  "Remote control is not enabled. Open Settings → Remote on the laptop and accept the remote-control notice."

export const INPUT_NOT_ENABLED_MESSAGE =
  "Screen control is off. Open Settings → Remote on the laptop, accept the screen-control notice, and turn on Allow phone input."

export const INPUT_DURING_AUTOPILOT_MESSAGE =
  "Autopilot is driving the screen right now. Stop the run before taking over."

export async function routeRemoteCommand(
  command: RemoteCommand,
  capabilities: RemoteCapabilities,
  context: RemoteCommandContext
): Promise<RemoteCommandOutcome> {
  // Checked ahead of the control gate, and independently of it: consenting to
  // remote autopilot is not consenting to a phone typing on this keyboard, so
  // `controlEnabled` must never be able to satisfy this on its own.
  if (isInputCommand(command.type)) {
    if (!context.inputEnabled) {
      return { ok: false, status: 403, error: INPUT_NOT_ENABLED_MESSAGE }
    }
    // Two things steering one cursor produce actions neither asked for, and
    // autopilot's confirmation prompts are written assuming it is the only
    // thing moving the mouse.
    if (context.autopilotRunning) {
      return { ok: false, status: 409, error: INPUT_DURING_AUTOPILOT_MESSAGE }
    }
  }

  if (!context.controlEnabled && !isAllowedBeforeConsent(command.type)) {
    return { ok: false, status: 403, error: CONTROL_NOT_CONSENTED_MESSAGE }
  }

  try {
    switch (command.type) {
      case "status/get":
        return { ok: true, data: await capabilities.getStatus() }

      case "screen/frame":
        return { ok: true, data: await capabilities.captureFrame() }

      case "screen/select":
        await capabilities.selectDisplay(command.displayId)
        return { ok: true }

      case "autopilot/start":
        return {
          ok: true,
          data: await capabilities.autopilotStart(command.goal, {
            ...(command.maxSteps === undefined
              ? {}
              : { maxSteps: command.maxSteps })
          })
        }

      case "autopilot/confirm":
        capabilities.autopilotConfirm()
        return { ok: true }

      case "autopilot/reject":
        capabilities.autopilotReject()
        return { ok: true }

      case "autopilot/stop":
        capabilities.autopilotStop()
        return { ok: true }

      case "chat/send":
        await capabilities.chatSend({
          requestId: command.requestId,
          message: command.message,
          withScreen: command.withScreen,
          ...(command.persona === undefined ? {} : { persona: command.persona })
        })
        return { ok: true }

      case "chat/cancel":
        capabilities.chatCancel(command.requestId)
        return { ok: true }

      case "input/click":
        await capabilities.inputClick(command.point, {
          button: command.button,
          clicks: command.clicks
        })
        return { ok: true }

      case "input/drag":
        await capabilities.inputDrag(command.from, command.to)
        return { ok: true }

      case "input/scroll":
        await capabilities.inputScroll(command.point, {
          dx: command.dx,
          dy: command.dy
        })
        return { ok: true }

      case "input/text":
        await capabilities.inputText(command.text)
        return { ok: true }

      case "input/key":
        await capabilities.inputKey(command.combo)
        return { ok: true }
    }
  } catch (error) {
    // Capability failures are surfaced verbatim: the messages that matter most
    // here come from the privacy gate and autopilot consent checks, and they
    // tell the user exactly what to go and do on the laptop.
    return {
      ok: false,
      status: 400,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
