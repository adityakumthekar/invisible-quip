// remoteTickets.ts
//
// Short-lived, single-use credentials for the two endpoints that cannot carry a
// header: the MJPEG `<img>` and the SSE `EventSource`.
//
// Why this exists at all: those two are opened by the browser, not by our code,
// so neither can set `Authorization`. They previously authenticated by cookie,
// which worked while the client was served from the same origin as the server.
// The Capacitor client is not — it runs at http://localhost and talks to
// http://<lan-ip>:41777 — so a `SameSite=Strict` cookie is never sent, and the
// setting that would fix that (`SameSite=None`) requires `Secure`, i.e. TLS.
//
// A ticket sidesteps the whole problem. The device trades its Bearer token for
// a nonce over an authenticated POST, then puts the nonce in the stream URL.
// The long-lived token still never appears in a URL — that was the real
// objection to query-string auth, and it is preserved. What ends up in a URL is
// worthless seconds later and worthless immediately after one use.
//
// Clock and randomness are injected, the same arrangement as RemotePairingService,
// so expiry and single-use are testable without a real thirty seconds.

/** Long enough to survive a slow reconnect, short enough to be worthless. */
export const TICKET_TTL_MS = 30 * 1000

/**
 * A cap on outstanding tickets, so a paired-but-buggy client looping on
 * "get ticket, fail to connect" cannot grow this map without bound.
 */
export const MAX_OUTSTANDING_TICKETS = 32

export interface StreamTicket {
  value: string
  deviceId: string
  expiresAt: number
}

export interface RemoteTicketDependencies {
  now: () => number
  /** High-entropy nonce. Must be unguessable within the TTL. */
  randomTicket: () => string
}

/**
 * Compare in time independent of where the first difference falls.
 *
 * Duplicated from remotePairing rather than shared, because importing across
 * these two modules to save six lines would couple the pairing store to the
 * ticket store for no reason. Both are self-contained on purpose.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

export class RemoteTicketStore {
  private tickets: StreamTicket[] = []

  constructor(private readonly dependencies: RemoteTicketDependencies) {}

  /** Mint a ticket for a device that has already proved it holds the token. */
  public issue(deviceId: string): StreamTicket {
    this.sweep()

    // Drop the oldest rather than refuse: a client that legitimately reopens
    // both streams repeatedly must not be locked out by its own history.
    if (this.tickets.length >= MAX_OUTSTANDING_TICKETS) {
      this.tickets.shift()
    }

    const ticket: StreamTicket = {
      value: this.dependencies.randomTicket(),
      deviceId,
      expiresAt: this.dependencies.now() + TICKET_TTL_MS
    }
    this.tickets.push(ticket)
    return ticket
  }

  /**
   * Spend a ticket, returning the device it belonged to.
   *
   * Burned whether or not the connection that follows succeeds. A ticket that
   * survived a failed connect would be a ticket an observer had already seen.
   */
  public redeem(value: unknown): string | null {
    this.sweep()
    if (typeof value !== "string" || value.length === 0) {
      return null
    }

    // Scan every entry even after a match, so the work does not depend on which
    // ticket matched or whether one did.
    let matchedIndex = -1
    for (let index = 0; index < this.tickets.length; index += 1) {
      if (constantTimeEquals(this.tickets[index].value, value)) {
        matchedIndex = index
      }
    }
    if (matchedIndex === -1) {
      return null
    }

    const [ticket] = this.tickets.splice(matchedIndex, 1)
    return ticket.deviceId
  }

  /** Invalidate every outstanding ticket — used when a device is revoked. */
  public revokeDevice(deviceId: string): void {
    this.tickets = this.tickets.filter((ticket) => ticket.deviceId !== deviceId)
  }

  public clear(): void {
    this.tickets = []
  }

  public get size(): number {
    this.sweep()
    return this.tickets.length
  }

  private sweep(): void {
    const at = this.dependencies.now()
    this.tickets = this.tickets.filter((ticket) => ticket.expiresAt > at)
  }
}

export const TICKET_REQUIRED_MESSAGE = "A valid stream ticket is required."
