/**
 * Cmd+Enter costs a main → renderer → main round trip before the screenshot is
 * even requested: the shortcut only signals the renderer, which owns the chat
 * state, and the renderer calls back into `chat-with-screen`. That hop is dead
 * time we can spend capturing.
 *
 * So the shortcut kicks off the capture immediately and parks the promise here;
 * the IPC handler claims it moments later instead of starting its own. The
 * result is only reused while it is fresh — a stale frame would answer about a
 * screen the user has already navigated away from.
 */
export const PREWARM_MAX_AGE_MS = 2000

type Prewarmed = {
  promise: Promise<Buffer>
  startedAt: number
}

let pending: Prewarmed | null = null

/**
 * Start a capture now. Rejections are swallowed here so an unclaimed prewarm
 * can never surface as an unhandled rejection; the claimer still sees them.
 */
export function prewarmChatCapture(
  capture: () => Promise<Buffer>,
  now: number = Date.now()
): void {
  const promise = capture()
  promise.catch(() => {})
  pending = { promise, startedAt: now }
}

/**
 * Take the parked capture if one is still fresh, clearing it either way so a
 * frame is never handed to two requests.
 */
export function claimChatCapture(
  now: number = Date.now()
): Promise<Buffer> | null {
  const claimed = pending
  pending = null
  if (!claimed) return null
  if (now - claimed.startedAt > PREWARM_MAX_AGE_MS) return null
  return claimed.promise
}

/** Testing seam. */
export function resetChatCapturePrewarm(): void {
  pending = null
}
