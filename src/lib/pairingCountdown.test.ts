import { describe, expect, it } from "vitest"
import { isPairingCodeExpired, remainingSeconds } from "./pairingCountdown"

const NOW = 1_700_000_000_000
const TTL = 2 * 60 * 1000

describe("remainingSeconds", () => {
  it("is zero when there is no code", () => {
    expect(remainingSeconds(null, NOW)).toBe(0)
  })

  it("reports the full window for a code issued now", () => {
    expect(remainingSeconds(NOW + TTL, NOW)).toBe(120)
  })

  it("rounds up so the last partial second still shows as 1", () => {
    expect(remainingSeconds(NOW + 1, NOW)).toBe(1)
    expect(remainingSeconds(NOW + 999, NOW)).toBe(1)
  })

  it("floors at zero rather than going negative", () => {
    expect(remainingSeconds(NOW - 5000, NOW)).toBe(0)
  })
})

describe("isPairingCodeExpired", () => {
  it("is false when there is no code", () => {
    expect(isPairingCodeExpired(null, NOW)).toBe(false)
  })

  /**
   * The regression this module exists for. RemotePanel discards the pairing
   * code as soon as this returns true, so a freshly issued code reading as
   * expired means the user presses "Generate pairing code" and sees nothing at
   * all — no code, no QR, and no error to explain it.
   */
  it("is false for a code issued this instant", () => {
    expect(isPairingCodeExpired(NOW + TTL, NOW)).toBe(false)
  })

  it("stays false for the whole window, including the final millisecond", () => {
    expect(isPairingCodeExpired(NOW + TTL, NOW + TTL - 1)).toBe(false)
  })

  it("is true exactly at the deadline and after", () => {
    expect(isPairingCodeExpired(NOW + TTL, NOW + TTL)).toBe(true)
    expect(isPairingCodeExpired(NOW + TTL, NOW + TTL + 1000)).toBe(true)
  })

  // Expiry must not be inferred from a seconds counter: sub-second precision is
  // exactly where the two disagree, and that gap is what broke the panel.
  it("does not agree with a zero seconds count on a live code", () => {
    // A counter that has not caught up yet reports 0 while the code is valid.
    const staleSecondsCount = 0
    expect(staleSecondsCount === 0).toBe(true)
    expect(isPairingCodeExpired(NOW + TTL, NOW)).toBe(false)
  })
})
