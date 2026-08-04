// remoteInput.ts
//
// The arithmetic between a tap on a phone and a click on a real screen, plus
// the rate limit that stands in front of it. Pure — no Electron, no nut-js — so
// the coordinate mapping, which is the part that will silently click the wrong
// thing if it is wrong, can be tested without a display or a cursor.
//
// The phone speaks fractions of a frame (see NormalizedPoint). This module is
// the only place those become pixels the OS will act on, and it deliberately
// resolves them against the display's *current* geometry rather than anything
// the phone sent: a frame in flight while a monitor changes resolution must
// land in the right place or not at all.

import type { NormalizedPoint, RemoteDisplay } from "./remoteProtocol"
import type { DisplayDescriptor } from "./displayTopology"
import { screenshotPixelToDip, type DipPoint } from "./teachingGeometry"

/** Wheel steps per unit of scroll delta the phone reports. */
const SCROLL_PIXELS_PER_STEP = 40

/**
 * Resolve a normalized point to a global DIP coordinate — what Electron's
 * screen API and nut-js both speak.
 *
 * Reuses `screenshotPixelToDip` rather than repeating `bounds.x + x * width`,
 * because that function already owns the clamping rules and is already tested
 * against multi-display offsets. Passing unit screenshot dimensions makes a
 * normalized coordinate *be* the pixel coordinate, so the two spaces coincide
 * and the existing conversion applies unchanged.
 */
export function normalizedPointToDip(
  point: { x: number; y: number },
  display: DisplayDescriptor
): DipPoint {
  return screenshotPixelToDip(
    { x: point.x, y: point.y },
    {
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      screenshotWidth: 1,
      screenshotHeight: 1
    }
  )
}

/**
 * Find the display a point names, or null when it names one that is gone.
 *
 * Returning null rather than falling back to the primary display is the whole
 * point: a phone holding a stale frame of an unplugged monitor must have its
 * taps refused, not redirected onto whatever screen happens to remain.
 */
export function findDisplay(
  displays: DisplayDescriptor[],
  displayId: number
): DisplayDescriptor | null {
  return displays.find((display) => display.id === displayId) ?? null
}

export const UNKNOWN_DISPLAY_MESSAGE =
  "That display is no longer available. Pull a fresh frame and try again."

/** Resolve a point against live topology, throwing the actionable error. */
export function resolvePoint(
  point: NormalizedPoint,
  displays: DisplayDescriptor[]
): DipPoint {
  const display = findDisplay(displays, point.displayId)
  if (!display) {
    throw new Error(UNKNOWN_DISPLAY_MESSAGE)
  }
  return normalizedPointToDip(point, display)
}

/**
 * Split a two-axis scroll delta into the discrete steps nut-js takes, dropping
 * axes that round to nothing.
 *
 * A phone reports a flick as a pixel distance; nut-js counts wheel notches. The
 * rounding matters at the low end — without the `Math.max(1, …)` floor a slow,
 * deliberate scroll of a few pixels would round to zero steps and feel broken,
 * while `Math.round` alone on a large flick would be indistinguishable from a
 * small one.
 */
export function scrollDeltaToSteps(delta: {
  dx: number
  dy: number
}): { direction: "up" | "down" | "left" | "right"; steps: number }[] {
  const axes: { direction: "up" | "down" | "left" | "right"; steps: number }[] = []

  if (delta.dy !== 0) {
    axes.push({
      direction: delta.dy > 0 ? "down" : "up",
      steps: Math.max(1, Math.round(Math.abs(delta.dy) / SCROLL_PIXELS_PER_STEP))
    })
  }
  if (delta.dx !== 0) {
    axes.push({
      direction: delta.dx > 0 ? "right" : "left",
      steps: Math.max(1, Math.round(Math.abs(delta.dx) / SCROLL_PIXELS_PER_STEP))
    })
  }

  return axes
}

/** Electron's Display, trimmed to what the phone needs to render a picker. */
export function toRemoteDisplay(
  display: DisplayDescriptor & { label?: string },
  primaryId: number
): RemoteDisplay {
  return {
    id: display.id,
    label: display.label?.trim() || `Display ${display.id}`,
    width: display.bounds.width,
    height: display.bounds.height,
    primary: display.id === primaryId
  }
}

/**
 * A token bucket over the input path.
 *
 * Not for fairness — there is one client — but for blast radius. A bug in the
 * gesture layer or a hostile paired device should not be able to issue
 * thousands of clicks a second at a machine whose owner is not watching it. The
 * capacity allows a real gesture burst (a drag is a handful of events) while the
 * refill rate caps the sustained load well under what a human hand produces.
 */
export class TokenBucket {
  private tokens: number
  private lastRefillAt: number

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = () => Date.now()
  ) {
    this.tokens = capacity
    this.lastRefillAt = now()
  }

  /** Take one token, or report that the caller is going too fast. */
  public tryTake(): boolean {
    this.refill()
    if (this.tokens < 1) {
      return false
    }
    this.tokens -= 1
    return true
  }

  private refill(): void {
    const at = this.now()
    const elapsed = at - this.lastRefillAt
    // A clock that jumps backwards (NTP, sleep/wake) must not mint tokens or
    // freeze the bucket; treat it as no time having passed.
    if (elapsed <= 0) {
      this.lastRefillAt = at
      return
    }
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (elapsed / 1000) * this.refillPerSecond
    )
    this.lastRefillAt = at
  }
}

export const INPUT_RATE_LIMIT_MESSAGE =
  "Too many input events. Slow down and try again."
