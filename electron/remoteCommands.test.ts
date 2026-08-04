import { describe, expect, it, vi } from "vitest"
import {
  CONTROL_NOT_CONSENTED_MESSAGE,
  INPUT_DURING_AUTOPILOT_MESSAGE,
  INPUT_NOT_ENABLED_MESSAGE,
  routeRemoteCommand,
  type RemoteCapabilities
} from "./remoteCommands"
import {
  INPUT_COMMAND_TYPES,
  isInputCommand,
  parseRemoteCommand,
  PRE_CONSENT_COMMAND_TYPES,
  type RemoteCommand,
  type RemoteStatus
} from "./remoteProtocol"

const STATUS: RemoteStatus = {
  protocolVersion: 2,
  controlEnabled: true,
  inputEnabled: true,
  gateBlockedBy: null,
  autopilotRunning: false,
  deviceName: "Phone",
  displays: [{ id: 1, label: "Built-in", width: 1512, height: 982, primary: true }],
  activeDisplayId: 1
}

function capabilities(): RemoteCapabilities & {
  [K in keyof RemoteCapabilities]: ReturnType<typeof vi.fn>
} {
  return {
    getStatus: vi.fn(async () => STATUS),
    captureFrame: vi.fn(async () => ({
      dataUrl: "data:image/jpeg;base64,AAA",
      width: 900,
      height: 500,
      capturedAt: "2026-07-30T00:00:00.000Z",
      displayId: 1
    })),
    selectDisplay: vi.fn(async () => {}),
    autopilotStart: vi.fn(async () => ({ started: true, maxSteps: 25 })),
    autopilotConfirm: vi.fn(),
    autopilotReject: vi.fn(),
    autopilotStop: vi.fn(),
    chatSend: vi.fn(async () => {}),
    chatCancel: vi.fn(),
    inputClick: vi.fn(async () => {}),
    inputDrag: vi.fn(async () => {}),
    inputScroll: vi.fn(async () => {}),
    inputText: vi.fn(async () => {}),
    inputKey: vi.fn(async () => {})
  } as never
}

const CONSENTED = {
  controlEnabled: true,
  inputEnabled: true,
  autopilotRunning: false
}
const NOT_CONSENTED = {
  controlEnabled: false,
  inputEnabled: false,
  autopilotRunning: false
}
/** Remote autopilot accepted, but the phone may not touch the keyboard. */
const CONTROL_WITHOUT_INPUT = {
  controlEnabled: true,
  inputEnabled: false,
  autopilotRunning: false
}

const POINT = { x: 0.5, y: 0.5, displayId: 1 }

/** Every command the protocol defines, for exhaustive gate checks. */
const ALL_COMMANDS: RemoteCommand[] = [
  { type: "status/get" },
  { type: "screen/frame" },
  { type: "screen/select", displayId: 1 },
  { type: "autopilot/start", goal: "open mail" },
  { type: "autopilot/confirm" },
  { type: "autopilot/reject" },
  { type: "autopilot/stop" },
  { type: "chat/send", requestId: "r1", message: "hi", withScreen: false },
  { type: "chat/cancel", requestId: "r1" },
  { type: "input/click", point: POINT, button: "left", clicks: 1 },
  { type: "input/drag", from: POINT, to: { x: 0.9, y: 0.9, displayId: 1 } },
  { type: "input/scroll", point: POINT, dx: 0, dy: 120 },
  { type: "input/text", text: "hello" },
  { type: "input/key", combo: "cmd+a" }
]

const INPUT_COMMANDS = ALL_COMMANDS.filter((command) =>
  isInputCommand(command.type)
)

describe("consent gate", () => {
  it("refuses every actuating command before consent", async () => {
    // Input commands are excluded because they are refused *earlier*, by their
    // own gate with its own message — see the "input gate" block. Everything
    // else that actuates must fall to this one.
    const gated = ALL_COMMANDS.filter(
      (command) =>
        !PRE_CONSENT_COMMAND_TYPES.includes(command.type) &&
        !isInputCommand(command.type)
    )
    expect(gated.length).toBeGreaterThan(0)

    for (const command of gated) {
      const caps = capabilities()
      const outcome = await routeRemoteCommand(command, caps, NOT_CONSENTED)

      expect(outcome).toEqual({
        ok: false,
        status: 403,
        error: CONTROL_NOT_CONSENTED_MESSAGE
      })
      // Refused means untouched — not "called and then rejected".
      for (const capability of Object.values(caps)) {
        expect(capability).not.toHaveBeenCalled()
      }
    }
  })

  it("allows observation before consent", async () => {
    const caps = capabilities()
    expect(
      (await routeRemoteCommand({ type: "status/get" }, caps, NOT_CONSENTED)).ok
    ).toBe(true)
    expect(
      (await routeRemoteCommand({ type: "screen/frame" }, caps, NOT_CONSENTED)).ok
    ).toBe(true)
  })

  // The kill switch is the one thing that must never be gated.
  it("allows stop before consent", async () => {
    const caps = capabilities()
    const outcome = await routeRemoteCommand(
      { type: "autopilot/stop" },
      caps,
      NOT_CONSENTED
    )
    expect(outcome.ok).toBe(true)
    expect(caps.autopilotStop).toHaveBeenCalledTimes(1)
  })
})

describe("input gate", () => {
  it("covers every input command the protocol defines", () => {
    expect(INPUT_COMMANDS).toHaveLength(INPUT_COMMAND_TYPES.length)
  })

  // The distinction the fourth consent exists to draw: accepting remote
  // autopilot is not accepting a phone that types on this keyboard.
  it("refuses input when only remote control is consented", async () => {
    for (const command of INPUT_COMMANDS) {
      const caps = capabilities()
      const outcome = await routeRemoteCommand(command, caps, CONTROL_WITHOUT_INPUT)

      expect(outcome).toEqual({
        ok: false,
        status: 403,
        error: INPUT_NOT_ENABLED_MESSAGE
      })
      for (const capability of Object.values(caps)) {
        expect(capability).not.toHaveBeenCalled()
      }
    }
  })

  it("refuses input while autopilot is running, even fully consented", async () => {
    for (const command of INPUT_COMMANDS) {
      const caps = capabilities()
      const outcome = await routeRemoteCommand(command, caps, {
        ...CONSENTED,
        autopilotRunning: true
      })

      expect(outcome).toEqual({
        ok: false,
        status: 409,
        error: INPUT_DURING_AUTOPILOT_MESSAGE
      })
      for (const capability of Object.values(caps)) {
        expect(capability).not.toHaveBeenCalled()
      }
    }
  })

  // Losing the ability to stop a run because you tried to tap the screen would
  // be exactly backwards.
  it("still allows stop and status while autopilot is running", async () => {
    const caps = capabilities()
    const context = { ...CONSENTED, autopilotRunning: true }

    expect((await routeRemoteCommand({ type: "autopilot/stop" }, caps, context)).ok).toBe(true)
    expect((await routeRemoteCommand({ type: "status/get" }, caps, context)).ok).toBe(true)
    expect((await routeRemoteCommand({ type: "screen/frame" }, caps, context)).ok).toBe(true)
  })

  it("allows input once consented and idle", async () => {
    for (const command of INPUT_COMMANDS) {
      const caps = capabilities()
      expect((await routeRemoteCommand(command, caps, CONSENTED)).ok).toBe(true)
    }
  })

  // inputEnabled must be sufficient on its own for input, and never sufficient
  // for anything else — the two gates are independent, not nested.
  it("does not let inputEnabled unlock non-input commands", async () => {
    const caps = capabilities()
    const outcome = await routeRemoteCommand(
      { type: "autopilot/start", goal: "g" },
      caps,
      { controlEnabled: false, inputEnabled: true, autopilotRunning: false }
    )
    expect(outcome).toEqual({
      ok: false,
      status: 403,
      error: CONTROL_NOT_CONSENTED_MESSAGE
    })
    expect(caps.autopilotStart).not.toHaveBeenCalled()
  })
})

describe("input routing", () => {
  it("forwards a click with its button and count", async () => {
    const caps = capabilities()
    await routeRemoteCommand(
      { type: "input/click", point: POINT, button: "right", clicks: 2 },
      caps,
      CONSENTED
    )
    expect(caps.inputClick).toHaveBeenCalledWith(POINT, {
      button: "right",
      clicks: 2
    })
  })

  it("forwards both drag endpoints", async () => {
    const caps = capabilities()
    const to = { x: 0.9, y: 0.1, displayId: 1 }
    await routeRemoteCommand({ type: "input/drag", from: POINT, to }, caps, CONSENTED)
    expect(caps.inputDrag).toHaveBeenCalledWith(POINT, to)
  })

  it("forwards scroll deltas", async () => {
    const caps = capabilities()
    await routeRemoteCommand(
      { type: "input/scroll", point: POINT, dx: -30, dy: 120 },
      caps,
      CONSENTED
    )
    expect(caps.inputScroll).toHaveBeenCalledWith(POINT, { dx: -30, dy: 120 })
  })

  it("forwards text and key combos", async () => {
    const caps = capabilities()
    await routeRemoteCommand({ type: "input/text", text: "hi " }, caps, CONSENTED)
    await routeRemoteCommand({ type: "input/key", combo: "cmd+a" }, caps, CONSENTED)
    expect(caps.inputText).toHaveBeenCalledWith("hi ")
    expect(caps.inputKey).toHaveBeenCalledWith("cmd+a")
  })

  it("routes display selection", async () => {
    const caps = capabilities()
    await routeRemoteCommand({ type: "screen/select", displayId: 3 }, caps, CONSENTED)
    expect(caps.selectDisplay).toHaveBeenCalledWith(3)
  })
})

describe("routing", () => {
  it("returns status", async () => {
    const caps = capabilities()
    expect(
      await routeRemoteCommand({ type: "status/get" }, caps, CONSENTED)
    ).toEqual({ ok: true, data: STATUS })
  })

  it("returns a captured frame", async () => {
    const caps = capabilities()
    const outcome = await routeRemoteCommand(
      { type: "screen/frame" },
      caps,
      CONSENTED
    )
    expect(outcome.ok && outcome.data).toMatchObject({ width: 900 })
  })

  it("passes the goal through and omits maxSteps when absent", async () => {
    const caps = capabilities()
    await routeRemoteCommand(
      { type: "autopilot/start", goal: "open mail" },
      caps,
      CONSENTED
    )
    expect(caps.autopilotStart).toHaveBeenCalledWith("open mail", {})
  })

  it("forwards maxSteps when present", async () => {
    const caps = capabilities()
    await routeRemoteCommand(
      { type: "autopilot/start", goal: "open mail", maxSteps: 5 },
      caps,
      CONSENTED
    )
    expect(caps.autopilotStart).toHaveBeenCalledWith("open mail", { maxSteps: 5 })
  })

  it("routes confirm, reject, and stop to distinct capabilities", async () => {
    const caps = capabilities()
    await routeRemoteCommand({ type: "autopilot/confirm" }, caps, CONSENTED)
    await routeRemoteCommand({ type: "autopilot/reject" }, caps, CONSENTED)
    await routeRemoteCommand({ type: "autopilot/stop" }, caps, CONSENTED)

    expect(caps.autopilotConfirm).toHaveBeenCalledTimes(1)
    expect(caps.autopilotReject).toHaveBeenCalledTimes(1)
    expect(caps.autopilotStop).toHaveBeenCalledTimes(1)
  })

  it("forwards a chat request", async () => {
    const caps = capabilities()
    await routeRemoteCommand(
      {
        type: "chat/send",
        requestId: "r1",
        message: "hi",
        withScreen: true,
        persona: "You are terse."
      },
      caps,
      CONSENTED
    )
    expect(caps.chatSend).toHaveBeenCalledWith({
      requestId: "r1",
      message: "hi",
      withScreen: true,
      persona: "You are terse."
    })
  })

  it("omits persona when absent rather than sending undefined", async () => {
    const caps = capabilities()
    await routeRemoteCommand(
      { type: "chat/send", requestId: "r1", message: "hi", withScreen: false },
      caps,
      CONSENTED
    )
    expect(caps.chatSend).toHaveBeenCalledWith({
      requestId: "r1",
      message: "hi",
      withScreen: false
    })
  })

  it("routes chat cancel", async () => {
    const caps = capabilities()
    await routeRemoteCommand({ type: "chat/cancel", requestId: "r1" }, caps, CONSENTED)
    expect(caps.chatCancel).toHaveBeenCalledWith("r1")
  })

  it("calls exactly one capability per command", async () => {
    for (const command of ALL_COMMANDS) {
      const caps = capabilities()
      await routeRemoteCommand(command, caps, CONSENTED)
      const called = Object.values(caps).filter(
        (capability) => capability.mock.calls.length > 0
      )
      expect(called).toHaveLength(1)
    }
  })
})

describe("capability failures", () => {
  // The privacy-gate and autopilot-consent errors thrown by the capability are
  // the actionable ones ("acknowledge the notice, then try again"), so they
  // must reach the phone intact rather than becoming a generic 500.
  it("surfaces the error message verbatim", async () => {
    const caps = capabilities()
    caps.autopilotStart.mockRejectedValue(
      new Error("Privacy preflight check required before autopilot.")
    )

    expect(
      await routeRemoteCommand(
        { type: "autopilot/start", goal: "g" },
        caps,
        CONSENTED
      )
    ).toEqual({
      ok: false,
      status: 400,
      error: "Privacy preflight check required before autopilot."
    })
  })

  it("stringifies a non-Error throw", async () => {
    const caps = capabilities()
    caps.chatCancel.mockImplementation(() => {
      throw "boom"
    })
    const outcome = await routeRemoteCommand(
      { type: "chat/cancel", requestId: "r1" },
      caps,
      CONSENTED
    )
    expect(outcome).toEqual({ ok: false, status: 400, error: "boom" })
  })
})

describe("parse + route together", () => {
  // The end-to-end property that matters: a hostile payload never reaches a
  // capability, because it never becomes a RemoteCommand in the first place.
  it("never routes an unparseable payload", async () => {
    const caps = capabilities()
    for (const raw of [
      { type: "shell/exec", cmd: "rm -rf /" },
      // A real command type, but the raw-pixel shape the protocol refuses to
      // speak — coordinates only ever arrive normalized against a display.
      { type: "input/click", x: 10, y: 10 },
      { type: "file/read", path: "/etc/passwd" },
      { type: "autopilot/start" },
      "autopilot/stop",
      null
    ]) {
      const parsed = parseRemoteCommand(raw)
      expect(parsed.ok).toBe(false)
      if (parsed.ok) {
        await routeRemoteCommand(parsed.command, caps, CONSENTED)
      }
    }

    for (const capability of Object.values(caps)) {
      expect(capability).not.toHaveBeenCalled()
    }
  })
})
