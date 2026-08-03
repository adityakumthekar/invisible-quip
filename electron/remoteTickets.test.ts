import { describe, expect, it } from "vitest"
import {
  MAX_OUTSTANDING_TICKETS,
  RemoteTicketStore,
  TICKET_TTL_MS
} from "./remoteTickets"

/** A clock and a counter the test drives, so nothing here is random or slow. */
function store(start = 1_000) {
  let at = start
  let issued = 0
  const ticketStore = new RemoteTicketStore({
    now: () => at,
    randomTicket: () => `ticket-${(issued += 1)}`
  })
  return {
    tickets: ticketStore,
    advance: (ms: number) => {
      at += ms
    }
  }
}

describe("RemoteTicketStore", () => {
  it("issues a ticket bound to a device", () => {
    const { tickets } = store()
    const ticket = tickets.issue("device-a")

    expect(ticket.value).toBe("ticket-1")
    expect(ticket.deviceId).toBe("device-a")
    expect(ticket.expiresAt).toBe(1_000 + TICKET_TTL_MS)
  })

  it("redeems a ticket back to its device", () => {
    const { tickets } = store()
    const ticket = tickets.issue("device-a")
    expect(tickets.redeem(ticket.value)).toBe("device-a")
  })

  // The property the whole design rests on: what lands in a URL is worthless
  // the moment it has been used once.
  it("refuses a second redemption of the same ticket", () => {
    const { tickets } = store()
    const ticket = tickets.issue("device-a")

    expect(tickets.redeem(ticket.value)).toBe("device-a")
    expect(tickets.redeem(ticket.value)).toBeNull()
  })

  it("expires a ticket after the TTL", () => {
    const { tickets, advance } = store()
    const ticket = tickets.issue("device-a")

    advance(TICKET_TTL_MS - 1)
    expect(tickets.redeem(ticket.value)).toBe("device-a")

    const second = tickets.issue("device-a")
    advance(TICKET_TTL_MS + 1)
    expect(tickets.redeem(second.value)).toBeNull()
  })

  it("refuses junk without throwing", () => {
    const { tickets } = store()
    tickets.issue("device-a")

    for (const value of [undefined, null, "", 42, {}, [], "ticket-999"]) {
      expect(tickets.redeem(value)).toBeNull()
    }
  })

  // Two devices' tickets must not be interchangeable, or revoking one phone
  // would not stop it watching the screen.
  it("keeps each device's tickets distinct", () => {
    const { tickets } = store()
    const a = tickets.issue("device-a")
    const b = tickets.issue("device-b")

    expect(tickets.redeem(a.value)).toBe("device-a")
    expect(tickets.redeem(b.value)).toBe("device-b")
  })

  it("drops every outstanding ticket for a revoked device", () => {
    const { tickets } = store()
    const a1 = tickets.issue("device-a")
    const a2 = tickets.issue("device-a")
    const b = tickets.issue("device-b")

    tickets.revokeDevice("device-a")

    expect(tickets.redeem(a1.value)).toBeNull()
    expect(tickets.redeem(a2.value)).toBeNull()
    expect(tickets.redeem(b.value)).toBe("device-b")
  })

  it("clears everything on demand", () => {
    const { tickets } = store()
    const ticket = tickets.issue("device-a")
    tickets.clear()
    expect(tickets.redeem(ticket.value)).toBeNull()
  })

  describe("bounds", () => {
    it("sweeps expired tickets out rather than accumulating them", () => {
      const { tickets, advance } = store()
      tickets.issue("device-a")
      tickets.issue("device-a")
      expect(tickets.size).toBe(2)

      advance(TICKET_TTL_MS + 1)
      expect(tickets.size).toBe(0)
    })

    // A client looping on "issue, fail to connect" must not grow this without
    // bound; the oldest is dropped so a working client is never locked out.
    it("caps outstanding tickets and evicts the oldest", () => {
      const { tickets } = store()
      const first = tickets.issue("device-a")

      for (let index = 0; index < MAX_OUTSTANDING_TICKETS; index += 1) {
        tickets.issue("device-a")
      }

      expect(tickets.size).toBe(MAX_OUTSTANDING_TICKETS)
      expect(tickets.redeem(first.value)).toBeNull()
    })

    it("still honours the newest tickets after eviction", () => {
      const { tickets } = store()
      for (let index = 0; index < MAX_OUTSTANDING_TICKETS; index += 1) {
        tickets.issue("device-a")
      }
      const newest = tickets.issue("device-a")
      expect(tickets.redeem(newest.value)).toBe("device-a")
    })
  })
})
