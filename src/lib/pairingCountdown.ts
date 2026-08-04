// Countdown arithmetic for the remote pairing code.
//
// Pulled out of RemotePanel because getting it wrong is not a cosmetic bug: the
// panel discards the pairing code once it reads as expired, so an "expired"
// answer that arrives one render too early makes the code vanish before it is
// ever shown. Both functions take `now` explicitly so that case is testable.

/** Whole seconds left, floored at zero. Returns 0 when there is no code. */
export function remainingSeconds(expiresAt: number | null, now: number): number {
  if (expiresAt === null) {
    return 0
  }
  return Math.max(0, Math.ceil((expiresAt - now) / 1000))
}

/**
 * Compare timestamps directly rather than asking whether `remainingSeconds` has
 * reached zero.
 *
 * The distinction is the whole point of this module. A seconds counter held in
 * React state lags the render in which `expiresAt` first appears, so "seconds
 * left === 0" is briefly true for a code that was issued milliseconds ago.
 * Comparing against the clock is never ambiguous.
 */
export function isPairingCodeExpired(
  expiresAt: number | null,
  now: number
): boolean {
  return expiresAt !== null && now >= expiresAt
}
