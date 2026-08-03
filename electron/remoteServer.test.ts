import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"

// remoteServer imports `electron` only for app.getAppPath(). Stub it so the
// server can be exercised over a real socket in a plain Node test.
const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quip-phone-"))
fs.writeFileSync(path.join(bundleRoot, "index.html"), "<!doctype html>hello")
fs.writeFileSync(path.join(bundleRoot, "app.js"), "console.log(1)")
fs.writeFileSync(path.join(os.tmpdir(), "quip-secret-outside.txt"), "TOPSECRET")

vi.mock("electron", () => ({
  app: { getAppPath: () => path.dirname(bundleRoot) }
}))

const { RemoteServer } = await import("./remoteServer")
const { RemotePairingService } = await import("./remotePairing")
const { CONTROL_NOT_CONSENTED_MESSAGE } = await import("./remoteCommands")
import type { RemoteCapabilities } from "./remoteCommands"

// getRemoteBundleRoot() is dirname(bundleRoot)/dist-remote, so mirror the files
// there instead of guessing at the mock's shape.
const servedRoot = path.join(path.dirname(bundleRoot), "dist-remote")
fs.mkdirSync(servedRoot, { recursive: true })
fs.writeFileSync(path.join(servedRoot, "index.html"), "<!doctype html>hello")

/** Shared so a test can assert the OS was never touched. */
let inputSpies: Record<string, ReturnType<typeof vi.fn>>
/** Counts stream frames so a test can prove capture is demand-driven. */
let captureCount = 0

function capabilities(): RemoteCapabilities {
  inputSpies = {
    inputClick: vi.fn(async () => {}),
    inputDrag: vi.fn(async () => {}),
    inputScroll: vi.fn(async () => {}),
    inputText: vi.fn(async () => {}),
    inputKey: vi.fn(async () => {})
  }
  return {
    getStatus: async () => ({
      protocolVersion: 2,
      controlEnabled: true,
      inputEnabled: true,
      gateBlockedBy: null,
      autopilotRunning: false,
      deviceName: "Quip",
      displays: [
        { id: 1, label: "Built-in", width: 1512, height: 982, primary: true }
      ],
      activeDisplayId: 1
    }),
    captureFrame: async () => ({
      dataUrl: "data:image/jpeg;base64,AAA",
      width: 900,
      height: 500,
      capturedAt: new Date().toISOString(),
      displayId: 1
    }),
    captureJpeg: async () => {
      captureCount += 1
      return { jpeg: Buffer.from("fake-jpeg-bytes"), displayId: 1 }
    },
    selectDisplay: vi.fn(async () => {}),
    autopilotStart: async () => ({ started: true, maxSteps: 25 }),
    autopilotConfirm: vi.fn(),
    autopilotReject: vi.fn(),
    autopilotStop: vi.fn(),
    chatSend: async () => {},
    chatCancel: vi.fn(),
    ...inputSpies
  } as RemoteCapabilities
}

describe("RemoteServer", () => {
  let server: InstanceType<typeof RemoteServer>
  let pairing: InstanceType<typeof RemotePairingService>
  let base: string
  let controlEnabled = true
  let inputEnabled = true
  let autopilotRunning = false
  let storeFile: string

  const post = (
    urlPath: string,
    body: unknown,
    headers: Record<string, string> = {}
  ) =>
    fetch(`${base}${urlPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    })

  /** Pair a fresh device and return its Bearer token. */
  const pairDevice = async () => {
    const { code } = pairing.issueCode()
    const response = await post("/api/pair", { code, deviceName: "Test" })
    expect(response.status).toBe(200)
    const { token } = await response.json()
    return { token }
  }

  /** Trade a token for a single-use stream ticket, as the client does. */
  const streamTicket = async (token: string) => {
    const response = await post(
      "/api/stream-ticket",
      {},
      { Authorization: `Bearer ${token}` }
    )
    expect(response.status).toBe(200)
    return (await response.json()).ticket as string
  }

  beforeEach(async () => {
    controlEnabled = true
    inputEnabled = true
    autopilotRunning = false
    captureCount = 0
    storeFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "quip-devices-")),
      "devices.json"
    )
    pairing = new RemotePairingService(storeFile, {
      now: () => Date.now(),
      randomCode: () => "123456",
      randomToken: () => `token-${Math.random().toString(16).slice(2)}`,
      randomId: () => `device-${Math.random().toString(16).slice(2)}`,
      readFile: (file) => fs.promises.readFile(file, "utf8"),
      writeFile: (file, contents) => fs.promises.writeFile(file, contents, "utf8")
    })

    server = new RemoteServer({
      pairing,
      capabilities: capabilities(),
      isControlEnabled: () => controlEnabled,
      isInputEnabled: () => inputEnabled,
      isAutopilotRunning: () => autopilotRunning
    })
    // Port 0: each test gets its own ephemeral port. Reusing one fixed port
    // makes undici hand the next test a pooled socket from the server that
    // just closed, which surfaces as a spurious ECONNRESET.
    const info = await server.start(0)
    base = `http://127.0.0.1:${info.port}`
  })

  afterEach(async () => {
    await server.stop()
  })

  describe("authentication", () => {
    it("refuses a command with no token", async () => {
      const response = await post("/api/command", { type: "status/get" })
      expect(response.status).toBe(401)
    })

    it("refuses a command with a bogus token", async () => {
      const response = await post(
        "/api/command",
        { type: "status/get" },
        { Authorization: "Bearer not-a-real-token" }
      )
      expect(response.status).toBe(401)
    })

    it("refuses the event stream with no ticket", async () => {
      const response = await fetch(`${base}/api/events`)
      expect(response.status).toBe(401)
      await response.body?.cancel()
    })

    it("refuses a stream ticket to an unpaired caller", async () => {
      const response = await post("/api/stream-ticket", {}, {
        Authorization: "Bearer nope"
      })
      expect(response.status).toBe(401)
    })

    it("accepts a command from a paired device", async () => {
      const { token } = await pairDevice()
      const response = await post(
        "/api/command",
        { type: "status/get" },
        { Authorization: `Bearer ${token}` }
      )
      expect(response.status).toBe(200)
      expect((await response.json()).data).toMatchObject({ deviceName: "Quip" })
    })

    // Revocation has to bite immediately, not at the next restart.
    it("refuses a revoked device's token", async () => {
      const { token } = await pairDevice()
      const [device] = await pairing.listDevices()
      await pairing.revoke(device.id)

      const response = await post(
        "/api/command",
        { type: "status/get" },
        { Authorization: `Bearer ${token}` }
      )
      expect(response.status).toBe(401)
    })
  })

  describe("pairing", () => {
    it("refuses a wrong code without revealing why", async () => {
      pairing.issueCode()
      const response = await post("/api/pair", {
        code: "000000",
        deviceName: "Attacker"
      })
      expect(response.status).toBe(401)
      expect((await response.json()).error).not.toMatch(/expired|used|wrong/i)
    })

    it("refuses a code that was already redeemed", async () => {
      const { code } = pairing.issueCode()
      expect((await post("/api/pair", { code, deviceName: "A" })).status).toBe(200)
      expect((await post("/api/pair", { code, deviceName: "B" })).status).toBe(401)
    })

    // The token is the only long-lived credential and it belongs in a header,
    // never in a cookie the browser will attach to requests we did not make.
    it("returns the token in the body and sets no cookie", async () => {
      const { code } = pairing.issueCode()
      const response = await post("/api/pair", { code, deviceName: "A" })
      expect((await response.json()).token).toBeTruthy()
      expect(response.headers.get("set-cookie")).toBeNull()
    })
  })

  describe("command allow-list", () => {
    it("rejects an unknown command type", async () => {
      const { token } = await pairDevice()
      const response = await post(
        "/api/command",
        { type: "shell/exec", cmd: "rm -rf /" },
        { Authorization: `Bearer ${token}` }
      )
      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain("Unsupported command")
    })

    it("rejects a malformed body", async () => {
      const { token } = await pairDevice()
      const response = await fetch(`${base}/api/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: "not json"
      })
      expect(response.status).toBe(400)
    })

    it("refuses control commands until consent is given", async () => {
      controlEnabled = false
      const { token } = await pairDevice()
      const response = await post(
        "/api/command",
        { type: "autopilot/start", goal: "open mail" },
        { Authorization: `Bearer ${token}` }
      )
      expect(response.status).toBe(403)
      expect((await response.json()).error).toBe(CONTROL_NOT_CONSENTED_MESSAGE)
    })

    // The input gate, exercised over a real socket rather than through the
    // router directly: a phone that is fully paired and fully control-consented
    // must still be refused until screen control is separately enabled.
    it("refuses input when input is not enabled", async () => {
      const { token } = await pairDevice()
      inputEnabled = false

      const response = await post(
        "/api/command",
        { type: "input/click", point: { x: 0.5, y: 0.5, displayId: 1 } },
        { Authorization: `Bearer ${token}` }
      )

      expect(response.status).toBe(403)
      expect(inputSpies.inputClick).not.toHaveBeenCalled()
    })

    it("refuses input while autopilot is running", async () => {
      const { token } = await pairDevice()
      autopilotRunning = true

      const response = await post(
        "/api/command",
        { type: "input/key", combo: "cmd+a" },
        { Authorization: `Bearer ${token}` }
      )

      expect(response.status).toBe(409)
      expect(inputSpies.inputKey).not.toHaveBeenCalled()
    })

    it("passes a normalized click through to the capability", async () => {
      const { token } = await pairDevice()

      const response = await post(
        "/api/command",
        {
          type: "input/click",
          point: { x: 0.25, y: 0.75, displayId: 1 },
          button: "right"
        },
        { Authorization: `Bearer ${token}` }
      )

      expect(response.status).toBe(200)
      expect(inputSpies.inputClick).toHaveBeenCalledWith(
        { x: 0.25, y: 0.75, displayId: 1 },
        { button: "right", clicks: 1 }
      )
    })

    // Raw screen pixels are not a thing the protocol speaks; a client that
    // sends them gets a 400, not a click somewhere near the top-left corner.
    it("rejects a click sent in screen pixels", async () => {
      const { token } = await pairDevice()

      const response = await post(
        "/api/command",
        { type: "input/click", point: { x: 640, y: 400, displayId: 1 } },
        { Authorization: `Bearer ${token}` }
      )

      expect(response.status).toBe(400)
      expect(inputSpies.inputClick).not.toHaveBeenCalled()
    })

    it("still allows stop before consent", async () => {
      controlEnabled = false
      const { token } = await pairDevice()
      const response = await post(
        "/api/command",
        { type: "autopilot/stop" },
        { Authorization: `Bearer ${token}` }
      )
      expect(response.status).toBe(200)
    })
  })

  describe("cross-origin", () => {
    it("refuses a command carrying a foreign Origin", async () => {
      const { token } = await pairDevice()
      const response = await post(
        "/api/command",
        { type: "status/get" },
        { Authorization: `Bearer ${token}`, Origin: "http://evil.example" }
      )
      expect(response.status).toBe(403)
    })

    it("never sends CORS headers", async () => {
      const { token } = await pairDevice()
      const response = await post(
        "/api/command",
        { type: "status/get" },
        { Authorization: `Bearer ${token}` }
      )
      expect(response.headers.get("access-control-allow-origin")).toBeNull()
    })
  })

  describe("stream tickets", () => {
    it("issues a ticket to a paired device", async () => {
      const { token } = await pairDevice()
      const ticket = await streamTicket(token)
      expect(typeof ticket).toBe("string")
      expect(ticket.length).toBeGreaterThan(16)
    })

    // The property that makes a nonce in a URL acceptable at all.
    it("burns a ticket after one use", async () => {
      const { token } = await pairDevice()
      const ticket = await streamTicket(token)

      const first = await fetch(`${base}/api/events?ticket=${ticket}`)
      expect(first.status).toBe(200)
      await first.body?.cancel()

      const second = await fetch(`${base}/api/events?ticket=${ticket}`)
      expect(second.status).toBe(401)
      await second.body?.cancel()
    })

    it("refuses a forged ticket", async () => {
      await pairDevice()
      const response = await fetch(`${base}/api/events?ticket=made-up`)
      expect(response.status).toBe(401)
      await response.body?.cancel()
    })

    // Revocation has to bite a credential minted before the phone was cut off.
    it("refuses a ticket belonging to a revoked device", async () => {
      const { token } = await pairDevice()
      const ticket = await streamTicket(token)
      const [device] = await pairing.listDevices()
      await pairing.revoke(device.id)

      const response = await fetch(`${base}/api/events?ticket=${ticket}`)
      expect(response.status).toBe(401)
      await response.body?.cancel()
    })
  })

  describe("event stream", () => {
    it("delivers a broadcast to a connected device", async () => {
      const { token } = await pairDevice()
      const response = await fetch(
        `${base}/api/events?ticket=${await streamTicket(token)}`
      )
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/event-stream")

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      // Wait for the client to be registered before broadcasting, otherwise
      // the event is sent to nobody and the read below hangs.
      const readUntil = async (needle: string) => {
        let buffer = ""
        while (!buffer.includes(needle)) {
          const { value, done } = await reader.read()
          if (done) {
            throw new Error(`stream ended before "${needle}": ${buffer}`)
          }
          buffer += decoder.decode(value, { stream: true })
        }
        return buffer
      }

      await readUntil("connected")
      server.broadcast({ type: "chat-chunk", requestId: "r1", delta: "hello" })
      const seen = await readUntil("chat-chunk")
      expect(seen).toContain('"delta":"hello"')

      await reader.cancel()
    })

    it("counts connections for the desktop indicator", async () => {
      expect(server.getInfo().connectedDevices).toBe(0)
      const { token } = await pairDevice()
      const response = await fetch(
        `${base}/api/events?ticket=${await streamTicket(token)}`
      )
      const reader = response.body!.getReader()
      await reader.read()
      expect(server.getInfo().connectedDevices).toBe(1)
      await reader.cancel()
    })
  })

  describe("screen stream", () => {
    it("refuses without a ticket", async () => {
      const response = await fetch(`${base}/api/screen/stream`)
      expect(response.status).toBe(401)
      await response.body?.cancel()
    })

    it("streams multipart JPEG frames to a ticketed client", async () => {
      const { token } = await pairDevice()
      const response = await fetch(
        `${base}/api/screen/stream?ticket=${await streamTicket(token)}`
      )

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain(
        "multipart/x-mixed-replace"
      )
      expect(response.headers.get("content-type")).toContain("boundary=quipframe")

      const reader = response.body!.getReader()
      let buffer = ""
      const decoder = new TextDecoder()
      while (!buffer.includes("fake-jpeg-bytes")) {
        const { value, done } = await reader.read()
        if (done) throw new Error(`stream ended early: ${buffer}`)
        buffer += decoder.decode(value, { stream: true })
      }

      expect(buffer).toContain("--quipframe")
      expect(buffer).toContain("Content-Type: image/jpeg")
      // The display stamp is what lets a tap on this frame resolve against the
      // geometry that produced it.
      expect(buffer).toContain("X-Quip-Display: 1")
      await reader.cancel()
    })

    // The loop must stop when the client walks away, or the laptop keeps
    // grabbing and encoding the screen for nobody.
    it("stops capturing once the client disconnects", async () => {
      const { token } = await pairDevice()
      const response = await fetch(
        `${base}/api/screen/stream?ticket=${await streamTicket(token)}&preset=high`
      )
      const reader = response.body!.getReader()
      await reader.read()
      await reader.cancel()

      await new Promise((resolve) => setTimeout(resolve, 150))
      const settled = captureCount
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(captureCount).toBe(settled)
    })

    it("caps concurrent streams", async () => {
      const { token } = await pairDevice()
      const open = []
      for (let index = 0; index < 2; index += 1) {
        const response = await fetch(
          `${base}/api/screen/stream?ticket=${await streamTicket(token)}`
        )
        expect(response.status).toBe(200)
        const reader = response.body!.getReader()
        await reader.read()
        open.push(reader)
      }

      const refused = await fetch(
        `${base}/api/screen/stream?ticket=${await streamTicket(token)}`
      )
      expect(refused.status).toBe(503)
      await refused.body?.cancel()

      for (const reader of open) {
        await reader.cancel()
      }
    })
  })

  describe("static files", () => {
    it("serves the phone bundle", async () => {
      const response = await fetch(`${base}/`)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain("hello")
    })

    // The process can read the user's whole home directory, so an escape here
    // is a file-disclosure bug. Only percent-encoded separators are worth
    // asserting a 400 on: fetch collapses a literal "/../" before it ever
    // reaches the server, so those arrive already normalized. Every variant is
    // still checked for the secret's contents.
    it("rejects percent-encoded traversal", async () => {
      for (const attack of [
        "/..%2Fquip-secret-outside.txt",
        "/assets%2F..%2F..%2Fquip-secret-outside.txt",
        "/%2e%2e%2fquip-secret-outside.txt"
      ]) {
        const response = await fetch(`${base}${attack}`, { redirect: "manual" })
        expect(response.status).toBe(400)
        expect(await response.text()).not.toContain("TOPSECRET")
      }
    })

    it("never serves a file outside the bundle", async () => {
      for (const attack of [
        "/../quip-secret-outside.txt",
        "/assets/../../quip-secret-outside.txt",
        "/..%2Fquip-secret-outside.txt"
      ]) {
        const response = await fetch(`${base}${attack}`, { redirect: "manual" })
        expect(await response.text()).not.toContain("TOPSECRET")
      }
    })

    it("falls back to index.html for unknown routes", async () => {
      const response = await fetch(`${base}/some/spa/route`)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain("hello")
    })

    it("404s an unknown api route rather than falling back", async () => {
      const response = await fetch(`${base}/api/nope`)
      expect(response.status).toBe(404)
    })
  })

  describe("lifecycle", () => {
    it("stops listening after stop()", async () => {
      const stopped = `${base}/api/command`
      await server.stop()
      await expect(fetch(stopped, { method: "POST" })).rejects.toThrow()
    })
  })
})
