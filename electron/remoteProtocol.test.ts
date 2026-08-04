import { describe, expect, it } from "vitest"
import {
  formatServerSentEvent,
  INPUT_COMMAND_TYPES,
  isAllowedBeforeConsent,
  isInputCommand,
  MAX_AUTOPILOT_STEPS,
  MAX_GOAL_LENGTH,
  MAX_INPUT_TEXT_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_SCROLL_DELTA,
  parseRemoteCommand,
  PRE_CONSENT_COMMAND_TYPES,
  type RemoteCommandType
} from "./remoteProtocol"

const POINT = { x: 0.5, y: 0.5, displayId: 1 }

describe("parseRemoteCommand — rejection", () => {
  it("rejects non-objects", () => {
    for (const raw of [null, undefined, 42, "status/get", [], true]) {
      expect(parseRemoteCommand(raw).ok).toBe(false)
    }
  })

  it("rejects an unknown command type", () => {
    const result = parseRemoteCommand({ type: "shell/exec", cmd: "rm -rf /" })
    expect(result).toEqual({
      ok: false,
      error: "Unsupported command: shell/exec"
    })
  })

  // The whole point of the allow-list: near-misses of real commands must not
  // slip through on a prefix or casing match.
  it("rejects near-miss command names", () => {
    for (const type of [
      "autopilot/start ",
      "Autopilot/start",
      "autopilot/startup",
      "autopilot",
      "",
      "__proto__"
    ]) {
      expect(parseRemoteCommand({ type, goal: "x" }).ok).toBe(false)
    }
  })

  it("rejects a non-string type", () => {
    expect(parseRemoteCommand({ type: 7 }).ok).toBe(false)
    expect(parseRemoteCommand({ type: { toString: "x" } }).ok).toBe(false)
  })

  it("does not treat inherited properties as a command", () => {
    const hostile = Object.create({ type: "autopilot/stop" })
    expect(parseRemoteCommand(hostile).ok).toBe(false)
  })
})

describe("parseRemoteCommand — no-argument commands", () => {
  it("accepts the bare commands and drops extra fields", () => {
    const types: RemoteCommandType[] = [
      "status/get",
      "screen/frame",
      "autopilot/confirm",
      "autopilot/reject",
      "autopilot/stop"
    ]
    for (const type of types) {
      expect(parseRemoteCommand({ type, extra: "ignored" })).toEqual({
        ok: true,
        command: { type }
      })
    }
  })
})

describe("parseRemoteCommand — autopilot/start", () => {
  it("accepts a goal and trims it", () => {
    expect(parseRemoteCommand({ type: "autopilot/start", goal: "  open mail  " }))
      .toEqual({ ok: true, command: { type: "autopilot/start", goal: "open mail" } })
  })

  it("requires a non-empty goal", () => {
    expect(parseRemoteCommand({ type: "autopilot/start" }).ok).toBe(false)
    expect(parseRemoteCommand({ type: "autopilot/start", goal: "" }).ok).toBe(false)
    expect(parseRemoteCommand({ type: "autopilot/start", goal: "   " }).ok).toBe(false)
    expect(parseRemoteCommand({ type: "autopilot/start", goal: 12 }).ok).toBe(false)
  })

  it("caps goal length", () => {
    const goal = "a".repeat(MAX_GOAL_LENGTH)
    expect(parseRemoteCommand({ type: "autopilot/start", goal }).ok).toBe(true)
    expect(
      parseRemoteCommand({ type: "autopilot/start", goal: goal + "a" }).ok
    ).toBe(false)
  })

  it("accepts an in-range maxSteps and omits it when absent", () => {
    expect(
      parseRemoteCommand({ type: "autopilot/start", goal: "g", maxSteps: 5 })
    ).toEqual({
      ok: true,
      command: { type: "autopilot/start", goal: "g", maxSteps: 5 }
    })
    const bare = parseRemoteCommand({ type: "autopilot/start", goal: "g" })
    expect(bare.ok && "maxSteps" in bare.command).toBe(false)
  })

  it("rejects an out-of-range or non-integer maxSteps", () => {
    for (const maxSteps of [0, -1, 1.5, MAX_AUTOPILOT_STEPS + 1, NaN, "5", null]) {
      expect(
        parseRemoteCommand({ type: "autopilot/start", goal: "g", maxSteps }).ok
      ).toBe(false)
    }
  })
})

describe("parseRemoteCommand — chat", () => {
  it("accepts a chat send and defaults withScreen to false", () => {
    expect(
      parseRemoteCommand({
        type: "chat/send",
        requestId: "r1",
        message: "hello"
      })
    ).toEqual({
      ok: true,
      command: {
        type: "chat/send",
        requestId: "r1",
        message: "hello",
        withScreen: false
      }
    })
  })

  it("only treats an explicit true as withScreen", () => {
    const result = parseRemoteCommand({
      type: "chat/send",
      requestId: "r1",
      message: "hi",
      withScreen: true
    })
    expect(result.ok && result.command).toMatchObject({ withScreen: true })
  })

  it("rejects a non-boolean withScreen rather than coercing it", () => {
    expect(
      parseRemoteCommand({
        type: "chat/send",
        requestId: "r1",
        message: "hi",
        withScreen: "yes"
      }).ok
    ).toBe(false)
  })

  it("requires requestId and message", () => {
    expect(parseRemoteCommand({ type: "chat/send", message: "hi" }).ok).toBe(false)
    expect(parseRemoteCommand({ type: "chat/send", requestId: "r" }).ok).toBe(false)
    expect(parseRemoteCommand({ type: "chat/cancel" }).ok).toBe(false)
  })

  it("caps message length", () => {
    const message = "m".repeat(MAX_MESSAGE_LENGTH + 1)
    expect(
      parseRemoteCommand({ type: "chat/send", requestId: "r", message }).ok
    ).toBe(false)
  })
})

// Mode selection is deliberately not a command: the phone imports the pure
// MODES list and sends the persona text with each chat instead, so main never
// has to mirror renderer mode state.
describe("retired commands", () => {
  it("refuses mode/set", () => {
    expect(parseRemoteCommand({ type: "mode/set", modeId: "interview" }).ok).toBe(
      false
    )
  })
})

describe("pre-consent allow-list", () => {
  it("permits only observation plus stop", () => {
    expect([...PRE_CONSENT_COMMAND_TYPES].sort()).toEqual([
      "autopilot/stop",
      "screen/frame",
      "status/get"
    ])
  })

  // Stop must never be gated: a phone that can watch a run must be able to
  // halt it, whatever the consent state.
  it("always permits stop", () => {
    expect(isAllowedBeforeConsent("autopilot/stop")).toBe(true)
  })

  it("withholds every actuating command", () => {
    for (const type of [
      "autopilot/start",
      "autopilot/confirm",
      "autopilot/reject",
      "chat/send",
      "chat/cancel"
    ] as RemoteCommandType[]) {
      expect(isAllowedBeforeConsent(type)).toBe(false)
    }
  })
})

describe("formatServerSentEvent", () => {
  it("emits a terminated SSE data frame", () => {
    expect(
      formatServerSentEvent({
        type: "chat-chunk",
        requestId: "r1",
        delta: "hi"
      })
    ).toBe('data: {"type":"chat-chunk","requestId":"r1","delta":"hi"}\n\n')
  })

  // A newline inside the payload would end the frame early and desync the
  // stream; JSON escaping is what prevents that, so pin it.
  it("escapes newlines in the payload", () => {
    const frame = formatServerSentEvent({
      type: "chat-chunk",
      requestId: "r1",
      delta: "line one\nline two"
    })
    expect(frame.endsWith("\n\n")).toBe(true)
    expect(frame.slice(0, -2)).not.toContain("\n")
  })
})

describe("parseRemoteCommand — input coordinates", () => {
  it("accepts a point at each corner and the middle", () => {
    for (const [x, y] of [[0, 0], [1, 1], [0, 1], [1, 0], [0.5, 0.5]]) {
      const result = parseRemoteCommand({
        type: "input/click",
        point: { x, y, displayId: 2 }
      })
      expect(result).toEqual({
        ok: true,
        command: {
          type: "input/click",
          point: { x, y, displayId: 2 },
          button: "left",
          clicks: 1
        }
      })
    }
  })

  // The reason coordinates are normalized at all: anything outside the frame
  // must be unrepresentable, not clamped somewhere downstream.
  it("rejects coordinates outside 0..1", () => {
    for (const point of [
      { x: -0.01, y: 0.5, displayId: 1 },
      { x: 1.01, y: 0.5, displayId: 1 },
      { x: 0.5, y: -1, displayId: 1 },
      { x: 0.5, y: 2, displayId: 1 },
      { x: 500, y: 300, displayId: 1 }
    ]) {
      expect(parseRemoteCommand({ type: "input/click", point }).ok).toBe(false)
    }
  })

  // NaN fails every comparison, so a bare range check would let it through to
  // arithmetic that silently produces NaN pixels.
  it("rejects NaN and Infinity coordinates", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(
        parseRemoteCommand({
          type: "input/click",
          point: { x: value, y: 0.5, displayId: 1 }
        }).ok
      ).toBe(false)
      expect(
        parseRemoteCommand({
          type: "input/click",
          point: { x: 0.5, y: value, displayId: 1 }
        }).ok
      ).toBe(false)
    }
  })

  it("rejects a malformed or missing point", () => {
    for (const point of [
      undefined,
      null,
      "0.5,0.5",
      [0.5, 0.5],
      {},
      { x: 0.5, y: 0.5 },
      { x: "0.5", y: 0.5, displayId: 1 },
      { x: 0.5, y: 0.5, displayId: "1" },
      { x: 0.5, y: 0.5, displayId: 1.5 }
    ]) {
      expect(parseRemoteCommand({ type: "input/click", point }).ok).toBe(false)
    }
  })
})

describe("parseRemoteCommand — input/click", () => {
  it("defaults to a single left click", () => {
    const result = parseRemoteCommand({ type: "input/click", point: POINT })
    expect(result).toEqual({
      ok: true,
      command: { type: "input/click", point: POINT, button: "left", clicks: 1 }
    })
  })

  it("accepts a right click and a double click", () => {
    const result = parseRemoteCommand({
      type: "input/click",
      point: POINT,
      button: "right",
      clicks: 2
    })
    expect(result).toEqual({
      ok: true,
      command: { type: "input/click", point: POINT, button: "right", clicks: 2 }
    })
  })

  it("rejects an unknown button or click count", () => {
    expect(
      parseRemoteCommand({ type: "input/click", point: POINT, button: "middle" }).ok
    ).toBe(false)
    expect(
      parseRemoteCommand({ type: "input/click", point: POINT, clicks: 3 }).ok
    ).toBe(false)
    expect(
      parseRemoteCommand({ type: "input/click", point: POINT, clicks: 0 }).ok
    ).toBe(false)
  })
})

describe("parseRemoteCommand — input/drag", () => {
  it("accepts a drag within one display", () => {
    const from = { x: 0.1, y: 0.2, displayId: 1 }
    const to = { x: 0.8, y: 0.9, displayId: 1 }
    expect(parseRemoteCommand({ type: "input/drag", from, to })).toEqual({
      ok: true,
      command: { type: "input/drag", from, to }
    })
  })

  // Two displays means two geometries; there is no single correct answer, so
  // the parser refuses rather than picking one.
  it("rejects a drag that spans two displays", () => {
    const result = parseRemoteCommand({
      type: "input/drag",
      from: { x: 0.1, y: 0.2, displayId: 1 },
      to: { x: 0.8, y: 0.9, displayId: 2 }
    })
    expect(result).toEqual({ ok: false, error: "A drag must stay on one display" })
  })

  it("rejects a drag missing an endpoint", () => {
    expect(parseRemoteCommand({ type: "input/drag", from: POINT }).ok).toBe(false)
    expect(parseRemoteCommand({ type: "input/drag", to: POINT }).ok).toBe(false)
  })
})

describe("parseRemoteCommand — input/scroll", () => {
  it("accepts deltas at the bound in both directions", () => {
    const result = parseRemoteCommand({
      type: "input/scroll",
      point: POINT,
      dx: -MAX_SCROLL_DELTA,
      dy: MAX_SCROLL_DELTA
    })
    expect(result).toEqual({
      ok: true,
      command: {
        type: "input/scroll",
        point: POINT,
        dx: -MAX_SCROLL_DELTA,
        dy: MAX_SCROLL_DELTA
      }
    })
  })

  it("rejects deltas past the bound, and non-finite ones", () => {
    for (const [dx, dy] of [
      [MAX_SCROLL_DELTA + 1, 0],
      [0, -MAX_SCROLL_DELTA - 1],
      [Number.NaN, 0],
      [0, Number.POSITIVE_INFINITY]
    ]) {
      expect(
        parseRemoteCommand({ type: "input/scroll", point: POINT, dx, dy }).ok
      ).toBe(false)
    }
  })

  it("requires both deltas", () => {
    expect(parseRemoteCommand({ type: "input/scroll", point: POINT, dx: 5 }).ok).toBe(
      false
    )
  })
})

describe("parseRemoteCommand — input/text", () => {
  it("accepts text and preserves surrounding whitespace", () => {
    // Unlike a goal or a chat message, this is a keystroke reproduction: the
    // spaces are the payload, so trimming would drop real input.
    expect(parseRemoteCommand({ type: "input/text", text: "  hi  " })).toEqual({
      ok: true,
      command: { type: "input/text", text: "  hi  " }
    })
    expect(parseRemoteCommand({ type: "input/text", text: " " }).ok).toBe(true)
  })

  it("rejects empty, oversized, and non-string text", () => {
    expect(parseRemoteCommand({ type: "input/text", text: "" }).ok).toBe(false)
    expect(
      parseRemoteCommand({
        type: "input/text",
        text: "a".repeat(MAX_INPUT_TEXT_LENGTH + 1)
      }).ok
    ).toBe(false)
    expect(parseRemoteCommand({ type: "input/text", text: 42 }).ok).toBe(false)
    expect(
      parseRemoteCommand({
        type: "input/text",
        text: "a".repeat(MAX_INPUT_TEXT_LENGTH)
      }).ok
    ).toBe(true)
  })
})

describe("parseRemoteCommand — input/key", () => {
  it("normalizes an accepted combo", () => {
    expect(parseRemoteCommand({ type: "input/key", combo: "  CMD+A  " })).toEqual({
      ok: true,
      command: { type: "input/key", combo: "cmd+a" }
    })
    expect(parseRemoteCommand({ type: "input/key", combo: "Enter" })).toEqual({
      ok: true,
      command: { type: "input/key", combo: "enter" }
    })
  })

  // Whatever the shared allow-list refuses never reaches nut-js.
  it("rejects unknown keys and modifiers", () => {
    for (const combo of [
      "hyper+a",
      "cmd+notakey",
      "",
      "cmd+",
      "+a",
      undefined,
      null,
      42
    ]) {
      expect(parseRemoteCommand({ type: "input/key", combo }).ok).toBe(false)
    }
  })
})

describe("parseRemoteCommand — screen/select", () => {
  it("accepts an integer display id", () => {
    expect(parseRemoteCommand({ type: "screen/select", displayId: 7 })).toEqual({
      ok: true,
      command: { type: "screen/select", displayId: 7 }
    })
  })

  it("rejects a non-integer display id", () => {
    for (const displayId of [undefined, "1", 1.5, Number.NaN]) {
      expect(parseRemoteCommand({ type: "screen/select", displayId }).ok).toBe(false)
    }
  })
})

describe("input command classification", () => {
  it("names every command that moves the real mouse or keyboard", () => {
    expect([...INPUT_COMMAND_TYPES].sort()).toEqual([
      "input/click",
      "input/drag",
      "input/key",
      "input/scroll",
      "input/text"
    ])
  })

  // Input is the one thing that must never be reachable before consent; an
  // overlap between these two lists would silently grant it.
  it("shares nothing with the pre-consent list", () => {
    for (const type of INPUT_COMMAND_TYPES) {
      expect(isInputCommand(type)).toBe(true)
      expect(isAllowedBeforeConsent(type)).toBe(false)
    }
  })

  it("does not classify observation or autopilot commands as input", () => {
    for (const type of [
      "status/get",
      "screen/frame",
      "screen/select",
      "autopilot/start",
      "autopilot/stop",
      "chat/send"
    ] as RemoteCommandType[]) {
      expect(isInputCommand(type)).toBe(false)
    }
  })
})
