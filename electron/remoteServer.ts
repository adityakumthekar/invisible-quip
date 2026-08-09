// remoteServer.ts
//
// The LAN-only HTTP surface the phone talks to. Node's built-in `http` plus
// Server-Sent Events — no WebSocket library, because the traffic here is a
// one-way push of run state with occasional small commands coming back, which
// is exactly what SSE is for.
//
// Auth is deliberately split by direction:
//
//   * POST /api/command carries `Authorization: Bearer <token>`. Browsers never
//     attach custom headers to cross-site requests, so a malicious page the
//     phone happens to have open cannot forge a command. No CORS headers are
//     ever sent, so it cannot read a response either. The Capacitor client
//     routes fetch through native code, which sends no Origin at all — the case
//     `isSameOrigin` already admits for non-browser clients.
//   * GET /api/events and GET /api/screen/stream carry a single-use ticket in
//     the query string, because `EventSource` and `<img>` are opened by the
//     browser and cannot set headers. A cookie used to fill this role, but the
//     client is no longer same-origin with the server, so `SameSite=Strict`
//     means it is never sent. See remoteTickets.ts for why a nonce in a URL is
//     acceptable where the long-lived token would not be.
//
// Everything is off unless `start()` is called, which only happens when the
// user enables it in Settings.

import { app } from "electron"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import {
  bearerToken,
  contentTypeFor,
  findLanAddress,
  isSameOrigin,
  resolveStaticPath
} from "./remoteHttp"
import {
  RemoteTicketStore,
  TICKET_REQUIRED_MESSAGE,
  type RemoteTicketDependencies
} from "./remoteTickets"
import {
  formatServerSentEvent,
  parseRemoteCommand,
  parseScreenPreset,
  REMOTE_PROTOCOL_VERSION,
  SCREEN_PRESETS,
  type RemoteEvent
} from "./remoteProtocol"
import { routeRemoteCommand, type RemoteCapabilities } from "./remoteCommands"
import type { RemotePairingService } from "./remotePairing"

export const DEFAULT_REMOTE_PORT = 41777
const PORT_ATTEMPTS = 10
const SSE_HEARTBEAT_MS = 25_000
const MAX_BODY_BYTES = 64 * 1024
const STREAM_BOUNDARY = "quipframe"
/** Each stream is a full-screen grab plus a JPEG encode per frame. */
const MAX_CONCURRENT_STREAMS = 2

export interface RemoteServerInfo {
  running: boolean
  port: number | null
  /** The LAN URL to show in the QR code, or null when not running. */
  url: string | null
  connectedDevices: number
}

export interface RemoteServerDependencies {
  pairing: RemotePairingService
  capabilities: RemoteCapabilities
  /** Read per-request: consent can be granted while the server is running. */
  isControlEnabled: () => boolean
  /**
   * Read per-request for the same reason, and one more: the desktop kill switch
   * revokes input mid-session, so a value captured at start-up would keep a
   * phone typing after the user had already cut it off.
   */
  isInputEnabled: () => boolean
  isAutopilotRunning: () => boolean
  /** Fired when the connected-client count changes, for the overlay indicator. */
  onConnectionsChanged?: (count: number) => void
  /** Injected only by tests; production uses a real clock and crypto nonce. */
  ticketDependencies?: RemoteTicketDependencies
}

interface SseClient {
  response: http.ServerResponse
  deviceId: string
}

export class RemoteServer {
  private server: http.Server | null = null
  private port: number | null = null
  private clients = new Set<SseClient>()
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private streams = 0
  private readonly tickets: RemoteTicketStore

  constructor(private readonly dependencies: RemoteServerDependencies) {
    this.tickets = new RemoteTicketStore(
      dependencies.ticketDependencies ?? {
        now: () => Date.now(),
        randomTicket: () => randomBytes(32).toString("hex")
      }
    )
  }

  public isRunning(): boolean {
    return this.server !== null
  }

  public getInfo(): RemoteServerInfo {
    const address = findLanAddress(os.networkInterfaces())
    return {
      running: this.isRunning(),
      port: this.port,
      url:
        this.isRunning() && address && this.port
          ? `http://${address}:${this.port}`
          : null,
      connectedDevices: this.clients.size
    }
  }

  /**
   * @param preferredPort Pass 0 to bind an OS-assigned ephemeral port. Only
   * tests do that; the app wants the fixed default so a phone's bookmark keeps
   * working across restarts.
   */
  public async start(
    preferredPort: number = DEFAULT_REMOTE_PORT
  ): Promise<RemoteServerInfo> {
    if (this.server) {
      return this.getInfo()
    }

    const server = http.createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        console.error("[remote] request failed:", error)
        this.sendJson(response, 500, { error: "Internal error" })
      })
    })

    this.port = await listenOnFreePort(server, preferredPort)
    this.server = server

    this.heartbeat = setInterval(() => {
      // A bare SSE comment: keeps proxies and phone radios from dropping an
      // idle stream during the long "thinking" gaps between steps.
      for (const client of this.clients) {
        client.response.write(": ping\n\n")
      }
    }, SSE_HEARTBEAT_MS)

    console.log(`[remote] listening on ${this.getInfo().url ?? `:${this.port}`}`)
    return this.getInfo()
  }

  public async stop(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    for (const client of this.clients) {
      client.response.end()
    }
    this.clients.clear()
    // Any ticket outstanding when the server goes down must not still work if
    // it comes back up.
    this.tickets.clear()
    this.notifyConnections()

    const server = this.server
    this.server = null
    this.port = null
    if (!server) {
      return
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
    console.log("[remote] stopped")
  }

  /**
   * Drop a revoked device's outstanding tickets.
   *
   * Belt and braces: `deviceForStream` already re-checks the pairing store, so
   * a revoked device cannot open a stream even holding a valid ticket. This
   * makes the credential itself dead rather than merely unusable.
   */
  public revokeDeviceTickets(deviceId: string): void {
    this.tickets.revokeDevice(deviceId)
  }

  /** Push an event to every connected phone. No-op when none are. */
  public broadcast(event: RemoteEvent): void {
    if (this.clients.size === 0) {
      return
    }
    const frame = formatServerSentEvent(event)
    for (const client of this.clients) {
      try {
        client.response.write(frame)
      } catch (error) {
        console.error("[remote] dropping client after write error:", error)
        this.dropClient(client)
      }
    }
  }

  // -------------------------------------------------------------------------

  private async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    // No CORS headers anywhere: the phone loads the page from this same origin,
    // so same-origin requests work, and any other site's script is blocked by
    // the browser from reading a response.
    const url = new URL(request.url ?? "/", "http://localhost")

    if (url.pathname === "/api/pair" && request.method === "POST") {
      return this.handlePair(request, response)
    }
    if (url.pathname === "/api/stream-ticket" && request.method === "POST") {
      return this.handleStreamTicket(request, response)
    }
    if (url.pathname === "/api/events" && request.method === "GET") {
      return this.handleEvents(url, request, response)
    }
    if (url.pathname === "/api/screen/stream" && request.method === "GET") {
      return this.handleScreenStream(url, request, response)
    }
    if (url.pathname === "/api/command" && request.method === "POST") {
      return this.handleCommand(request, response)
    }
    if (url.pathname.startsWith("/api/")) {
      return this.sendJson(response, 404, { error: "Not found" })
    }

    return this.handleStatic(url.pathname, response)
  }

  private async handlePair(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    if (!isSameOrigin(request.headers.origin, request.headers.host)) {
      return this.sendJson(response, 403, { error: "Bad origin" })
    }

    const body = await this.readJsonBody(request)
    if (body === null) {
      return this.sendJson(response, 400, { error: "Invalid body" })
    }

    const device = await this.dependencies.pairing.redeem(
      (body as Record<string, unknown>).code,
      (body as Record<string, unknown>).deviceName
    )
    if (!device) {
      // One message for wrong, expired, and already-used, so a caller can't
      // distinguish "close" from "no".
      return this.sendJson(response, 401, {
        error: "That pairing code is not valid. Generate a new one on the laptop."
      })
    }

    return this.sendJson(response, 200, {
      token: device.token,
      deviceId: device.id,
      name: device.name,
      protocolVersion: REMOTE_PROTOCOL_VERSION
    })
  }

  /**
   * Trade a Bearer token for a single-use ticket the stream URLs can carry.
   *
   * This is the only place the two auth schemes meet, and it is a plain
   * authenticated POST — so the token itself never leaves a header.
   */
  private async handleStreamTicket(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    if (!isSameOrigin(request.headers.origin, request.headers.host)) {
      return this.sendJson(response, 403, { error: "Bad origin" })
    }

    const device = await this.dependencies.pairing.verifyToken(
      bearerToken(request.headers.authorization)
    )
    if (!device) {
      return this.sendJson(response, 401, { error: "Not paired" })
    }

    const ticket = this.tickets.issue(device.id)
    return this.sendJson(response, 200, {
      ticket: ticket.value,
      expiresAt: ticket.expiresAt
    })
  }

  /**
   * Resolve the `?ticket=` on a stream URL to the device that asked for it.
   *
   * Re-verifies the device against the pairing store rather than trusting the
   * ticket alone: a phone revoked in the seconds between minting a ticket and
   * opening the stream must not get in on a credential issued before it was cut
   * off.
   */
  private async deviceForStream(url: URL) {
    const deviceId = this.tickets.redeem(url.searchParams.get("ticket"))
    if (!deviceId) {
      return null
    }
    const devices = await this.dependencies.pairing.listDevices()
    return devices.find((device) => device.id === deviceId) ?? null
  }

  private async handleEvents(
    url: URL,
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    const device = await this.deviceForStream(url)
    if (!device) {
      return this.sendJson(response, 401, { error: TICKET_REQUIRED_MESSAGE })
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    })
    response.write(": connected\n\n")

    const client: SseClient = { response, deviceId: device.id }
    this.clients.add(client)
    this.notifyConnections()
    void this.dependencies.pairing.touch(device.id)

    request.on("close", () => this.dropClient(client))

    // Seed the phone with current state so it renders immediately rather than
    // waiting for whatever happens next.
    try {
      response.write(
        formatServerSentEvent({
          type: "status",
          status: await this.dependencies.capabilities.getStatus()
        })
      )
    } catch (error) {
      console.error("[remote] failed to send initial status:", error)
    }
  }

  /**
   * Stream the screen as `multipart/x-mixed-replace` — an MJPEG stream, which a
   * plain `<img src>` renders natively with hardware JPEG decode and no client
   * JavaScript at all.
   *
   * Two things keep this from taking the app down:
   *
   *   * **Back-pressure.** A frame is captured only once the previous one has
   *     been flushed to the socket. A phone on weak Wi-Fi otherwise accumulates
   *     an unbounded write buffer inside the main process while capture keeps
   *     running at full rate.
   *   * **A concurrency cap.** Each stream costs a full-screen grab and a JPEG
   *     encode per frame, so the number of them has to be bounded by something
   *     other than how many tabs the user opened.
   */
  private async handleScreenStream(
    url: URL,
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    const device = await this.deviceForStream(url)
    if (!device) {
      return this.sendJson(response, 401, { error: TICKET_REQUIRED_MESSAGE })
    }
    if (this.streams >= MAX_CONCURRENT_STREAMS) {
      return this.sendJson(response, 503, {
        error: "Too many screen streams are already open."
      })
    }

    const preset = SCREEN_PRESETS[parseScreenPreset(url.searchParams.get("preset"))]
    const minimumFrameMs = 1000 / preset.fps

    this.streams += 1
    response.writeHead(200, {
      "Content-Type": `multipart/x-mixed-replace; boundary=${STREAM_BOUNDARY}`,
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    })

    let open = true
    const close = () => {
      open = false
    }
    request.on("close", close)
    response.on("error", close)

    void this.dependencies.pairing.touch(device.id)

    try {
      while (open && this.server) {
        const startedAt = Date.now()

        let frame: { jpeg: Buffer; displayId: number }
        try {
          frame = await this.dependencies.capabilities.captureJpeg({
            width: preset.width,
            quality: preset.quality
          })
        } catch (error) {
          // A revoked Screen Recording permission, or a display that vanished
          // mid-stream. Ending cleanly lets the <img> fire onerror and the
          // client show why, instead of hanging on a half-written part.
          console.error("[remote] stream capture failed:", error)
          break
        }
        if (!open) {
          break
        }

        const flushed = response.write(
          `--${STREAM_BOUNDARY}\r\n` +
            "Content-Type: image/jpeg\r\n" +
            `Content-Length: ${frame.jpeg.length}\r\n` +
            `X-Quip-Display: ${frame.displayId}\r\n\r\n`
        )
        response.write(frame.jpeg)
        response.write("\r\n")

        // Only wait when the socket actually asked us to. Awaiting "drain"
        // unconditionally would stall on a fast connection that never emits it.
        if (!flushed) {
          await new Promise<void>((resolve) => {
            const done = () => {
              response.off("drain", done)
              resolve()
            }
            response.on("drain", done)
            request.on("close", done)
          })
        }

        const remaining = minimumFrameMs - (Date.now() - startedAt)
        if (open && remaining > 0) {
          await new Promise((resolve) => setTimeout(resolve, remaining))
        }
      }
    } finally {
      this.streams -= 1
      request.off("close", close)
      response.end()
    }
  }

  private async handleCommand(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    if (!isSameOrigin(request.headers.origin, request.headers.host)) {
      return this.sendJson(response, 403, { error: "Bad origin" })
    }

    const device = await this.dependencies.pairing.verifyToken(
      bearerToken(request.headers.authorization)
    )
    if (!device) {
      return this.sendJson(response, 401, { error: "Not paired" })
    }

    const body = await this.readJsonBody(request)
    if (body === null) {
      return this.sendJson(response, 400, { error: "Invalid body" })
    }

    const parsed = parseRemoteCommand(body)
    // `=== false` rather than `!parsed.ok`: electron/tsconfig.json is not in
    // strict mode, and without strictNullChecks a boolean discriminant only
    // narrows on an explicit comparison. Same below for the command outcome.
    if (parsed.ok === false) {
      return this.sendJson(response, 400, { error: parsed.error })
    }

    const outcome = await routeRemoteCommand(
      parsed.command,
      this.dependencies.capabilities,
      {
        controlEnabled: this.dependencies.isControlEnabled(),
        inputEnabled: this.dependencies.isInputEnabled(),
        autopilotRunning: this.dependencies.isAutopilotRunning()
      }
    )
    if (outcome.ok === false) {
      return this.sendJson(response, outcome.status, { error: outcome.error })
    }
    return this.sendJson(response, 200, { data: outcome.data ?? null })
  }

  private handleStatic(urlPath: string, response: http.ServerResponse): void {
    const root = getRemoteBundleRoot()
    const resolved = resolveStaticPath(root, urlPath)
    if (!resolved) {
      return this.sendJson(response, 400, { error: "Bad path" })
    }

    // Unknown paths fall back to index.html so the phone client can own its
    // own routing without the server knowing the routes.
    const candidate =
      fs.existsSync(resolved) && fs.statSync(resolved).isFile()
        ? resolved
        : path.join(root, "index.html")

    if (!fs.existsSync(candidate)) {
      return this.sendJson(response, 503, {
        error: "The phone client is not built. Run `npm run build:remote`."
      })
    }

    response.writeHead(200, {
      "Content-Type": contentTypeFor(candidate),
      // The bundle is fingerprinted by Vite, but index.html must not be
      // cached or a rebuilt client is never picked up.
      "Cache-Control": candidate.endsWith("index.html")
        ? "no-store"
        : "public, max-age=3600"
    })
    fs.createReadStream(candidate).pipe(response)
  }

  private dropClient(client: SseClient): void {
    if (this.clients.delete(client)) {
      this.notifyConnections()
    }
  }

  private notifyConnections(): void {
    this.dependencies.onConnectionsChanged?.(this.clients.size)
  }

  private async readJsonBody(
    request: http.IncomingMessage
  ): Promise<unknown | null> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        return null
      }
      chunks.push(chunk as Buffer)
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"))
    } catch {
      return null
    }
  }

  private sendJson(
    response: http.ServerResponse,
    status: number,
    payload: unknown
  ): void {
    if (response.headersSent) {
      return
    }
    const body = JSON.stringify(payload)
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      // Nothing served here should ever be indexed or stored by an intermediary.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    })
    response.end(body)
  }
}

/**
 * Where the phone client's built files live. In dev this is the project root;
 * packaged, it's inside the asar.
 *
 * The installed Android app bundles its own copy of these files, so this route
 * only serves the browser fallback — useful for development, and for pairing
 * from a laptop or a second phone without installing anything.
 */
export function getRemoteBundleRoot(): string {
  return path.join(app.getAppPath(), "dist-remote")
}

/**
 * Bind the first free port at or above `preferred`. A fixed port keeps a
 * previously-paired phone's bookmark working; the walk covers the case where
 * something else grabbed it first.
 */
async function listenOnFreePort(
  server: http.Server,
  preferred: number
): Promise<number> {
  if (preferred === 0) {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind an ephemeral port")
    }
    return address.port
  }

  for (let offset = 0; offset < PORT_ATTEMPTS; offset += 1) {
    const port = preferred + offset
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.removeListener("listening", onListening)
          reject(error)
        }
        const onListening = () => {
          server.removeListener("error", onError)
          resolve()
        }
        server.once("error", onError)
        server.once("listening", onListening)
        server.listen(port, "0.0.0.0")
      })
      return port
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") {
        throw error
      }
    }
  }
  throw new Error(
    `No free port between ${preferred} and ${preferred + PORT_ATTEMPTS - 1}`
  )
}
