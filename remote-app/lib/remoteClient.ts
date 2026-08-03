// remoteClient.ts
//
// The app's side of the transport.
//
//   * Commands are POSTs carrying `Authorization: Bearer <token>`. Under
//     Capacitor these are routed through native code, so they are not subject
//     to CORS and send no Origin header — which the server already accepts, as
//     the case it makes for non-browser clients.
//   * State arrives on one long-lived EventSource, and the screen on an MJPEG
//     <img>. Neither can set a header, so both authenticate with a single-use
//     ticket in the URL. The token itself never appears in one.
//
// Every URL goes through `apiUrl`, because the installed app is not served by
// the laptop and has to be told where it is. See config.ts.

import type { RemoteCommand, RemoteEvent } from "../../src/lib/remoteProtocol"
import { apiUrl } from "./config"

const TOKEN_KEY = "quipRemoteToken"
const DEVICE_NAME_KEY = "quipRemoteDeviceName"

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // Storage blocked: treat as unpaired rather than crashing on first render.
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Non-fatal: the session still works until the app is closed.
  }
}

export function getStoredToken(): string | null {
  return readStorage(TOKEN_KEY)
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing to do — the caller is unpairing anyway.
  }
}

export function getDeviceName(): string {
  return readStorage(DEVICE_NAME_KEY) || "Phone"
}

export function setDeviceName(name: string): void {
  writeStorage(DEVICE_NAME_KEY, name)
}

export class RemoteError extends Error {
  constructor(
    message: string,
    /** HTTP status, so callers can tell "unpaired" from "refused". */
    public readonly status: number
  ) {
    super(message)
    this.name = "RemoteError"
  }
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json()
    if (body && typeof body.error === "string") {
      return body.error
    }
  } catch {
    // Non-JSON error body; use the fallback.
  }
  return fallback
}

/** Exchange a pairing code for a device token. */
export async function pair(code: string, deviceName: string): Promise<void> {
  const response = await fetch(apiUrl("/api/pair"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim(), deviceName })
  })

  if (!response.ok) {
    throw new RemoteError(
      await readError(response, "Pairing failed."),
      response.status
    )
  }

  const body = await response.json()
  if (typeof body?.token !== "string") {
    throw new RemoteError("The laptop sent an unexpected pairing response.", 500)
  }
  writeStorage(TOKEN_KEY, body.token)
  setDeviceName(deviceName)
}

/**
 * Trade the stored token for a single-use ticket.
 *
 * Every stream open needs its own: the server burns a ticket the moment it is
 * presented, so one cannot be cached and reused for a reconnect.
 */
export async function fetchStreamTicket(): Promise<string | null> {
  const token = getStoredToken()
  if (!token) {
    return null
  }
  try {
    const response = await fetch(apiUrl("/api/stream-ticket"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    })
    if (response.status === 401) {
      clearStoredToken()
      return null
    }
    if (!response.ok) {
      return null
    }
    const body = await response.json()
    return typeof body?.ticket === "string" ? body.ticket : null
  } catch {
    // Laptop asleep or off the network. The caller retries.
    return null
  }
}

/** A ticketed MJPEG URL, or null when we could not get a ticket. */
export async function screenStreamUrl(
  preset: "low" | "medium" | "high"
): Promise<string | null> {
  const ticket = await fetchStreamTicket()
  if (!ticket) {
    return null
  }
  return apiUrl(
    `/api/screen/stream?preset=${preset}&ticket=${encodeURIComponent(ticket)}`
  )
}

export async function sendCommand<T = unknown>(
  command: RemoteCommand
): Promise<T> {
  const token = getStoredToken()
  if (!token) {
    throw new RemoteError("This phone is not paired.", 401)
  }

  const response = await fetch(apiUrl("/api/command"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(command)
  })

  if (response.status === 401) {
    clearStoredToken()
    throw new RemoteError("This phone is no longer paired with the laptop.", 401)
  }
  if (!response.ok) {
    throw new RemoteError(
      await readError(response, "The laptop refused that request."),
      response.status
    )
  }

  const body = await response.json()
  return body?.data as T
}

export interface EventStreamHandlers {
  onEvent: (event: RemoteEvent) => void
  onOpen: () => void
  onClose: () => void
}

/**
 * Hold open the event stream, reconnecting on drop.
 *
 * EventSource retries on its own, but its stored URL carries a ticket that was
 * burned when it first connected — so its own retry is always refused. Every
 * attempt therefore mints a fresh ticket, and EventSource's built-in retry is
 * pre-empted by closing the source on error. Returns a disposer.
 */
export function openEventStream(handlers: EventStreamHandlers): () => void {
  let source: EventSource | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let backoffMs = 1000

  const connect = (ticket: string | null) => {
    if (disposed) {
      return
    }
    if (!ticket) {
      scheduleReconnect()
      return
    }

    source = new EventSource(
      apiUrl(`/api/events?ticket=${encodeURIComponent(ticket)}`)
    )

    source.onopen = () => {
      backoffMs = 1000
      handlers.onOpen()
    }

    source.onmessage = (message) => {
      try {
        handlers.onEvent(JSON.parse(message.data) as RemoteEvent)
      } catch {
        // A frame we can't parse is not worth tearing the stream down for.
      }
    }

    source.onerror = () => {
      source?.close()
      source = null
      handlers.onClose()
      scheduleReconnect()
    }
  }

  /** Back off to a few seconds: a sleeping laptop shouldn't be hammered. */
  function scheduleReconnect(): void {
    if (disposed || retryTimer) {
      return
    }
    retryTimer = setTimeout(() => {
      retryTimer = null
      void fetchStreamTicket().then(connect)
    }, backoffMs)
    backoffMs = Math.min(backoffMs * 2, 8000)
  }

  void fetchStreamTicket().then(connect)

  return () => {
    disposed = true
    if (retryTimer) {
      clearTimeout(retryTimer)
    }
    source?.close()
  }
}
