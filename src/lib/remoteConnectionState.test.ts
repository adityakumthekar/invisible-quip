import { describe, expect, it } from "vitest"
import type { RemoteState } from "../types/electron"
import { applyRemoteConnectionEvent } from "./remoteConnectionState"

function stateWith(
  overrides: {
    allowed?: boolean
    consented?: boolean
    connectedDevices?: number
  } = {}
): RemoteState {
  return {
    server: {
      running: true,
      port: 41777,
      url: "http://192.168.1.3:41777",
      connectedDevices: overrides.connectedDevices ?? 1
    },
    consent: { consented: true, text: "remote control notice", version: 1 },
    inputConsent: {
      consented: overrides.consented ?? true,
      allowed: overrides.allowed ?? true,
      text: "screen control notice",
      version: 1
    },
    devices: [
      {
        id: "device-1",
        name: "Phone",
        pairedAt: "2026-07-30T00:00:00.000Z",
        lastSeenAt: null
      }
    ],
    pairingCode: null,
    displays: []
  }
}

describe("applyRemoteConnectionEvent", () => {
  /**
   * The regression this module exists for.
   *
   * The kill switch (Cmd/Ctrl+Shift+Backspace) revokes phone input in main and
   * pushes the new state down this channel. The panel used to read only `count`
   * off that push, so it went on rendering "Your phone can tap and type here"
   * over a laptop that was refusing every tap — and because the button then
   * reads "Turn off", recovering took two clicks instead of one.
   */
  it("clears `allowed` when the laptop reports input is off", () => {
    const next = applyRemoteConnectionEvent(stateWith({ allowed: true }), {
      count: 1,
      inputEnabled: false
    })

    expect(next?.inputConsent.allowed).toBe(false)
  })

  it("restores `allowed` when the laptop reports input is back on", () => {
    const next = applyRemoteConnectionEvent(stateWith({ allowed: false }), {
      count: 1,
      inputEnabled: true
    })

    expect(next?.inputConsent.allowed).toBe(true)
  })

  /**
   * `consented` is durable and belongs to the acknowledgement store alone. The
   * event carries the live toggle only, so inferring consent from it would let
   * a kill switch silently retract a notice the user really did read — and the
   * panel would then demand they read it again.
   */
  it("never touches `consented`", () => {
    const off = applyRemoteConnectionEvent(stateWith({ consented: true }), {
      count: 0,
      inputEnabled: false
    })
    expect(off?.inputConsent.consented).toBe(true)

    const on = applyRemoteConnectionEvent(
      stateWith({ consented: false, allowed: false }),
      { count: 0, inputEnabled: true }
    )
    expect(on?.inputConsent.consented).toBe(false)
  })

  it("lands the device count on the server info the panel renders", () => {
    const next = applyRemoteConnectionEvent(stateWith({ connectedDevices: 0 }), {
      count: 2,
      inputEnabled: true
    })

    expect(next?.server.connectedDevices).toBe(2)
  })

  // The panel shows "Checking remote status…" until its first refresh lands. An
  // event arriving in that window has no snapshot to merge into and must not
  // conjure one out of two fields.
  it("leaves a state that has not loaded yet as null", () => {
    expect(
      applyRemoteConnectionEvent(null, { count: 1, inputEnabled: true })
    ).toBeNull()
  })

  it("carries the rest of the snapshot through untouched", () => {
    const before = stateWith()
    const next = applyRemoteConnectionEvent(before, {
      count: 3,
      inputEnabled: false
    })

    expect(next?.devices).toEqual(before.devices)
    expect(next?.consent).toEqual(before.consent)
    expect(next?.server.url).toBe(before.server.url)
    expect(next?.server.running).toBe(true)
    expect(next?.inputConsent.text).toBe(before.inputConsent.text)
  })

  // React state: mutating in place would leave `setState` comparing a snapshot
  // against itself and skipping the re-render this whole fix depends on.
  it("does not mutate the state it was given", () => {
    const before = stateWith({ allowed: true, connectedDevices: 1 })

    applyRemoteConnectionEvent(before, { count: 5, inputEnabled: false })

    expect(before.inputConsent.allowed).toBe(true)
    expect(before.server.connectedDevices).toBe(1)
  })
})
