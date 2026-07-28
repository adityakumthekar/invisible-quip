// A session mixes typed questions, voice notes and screen glances. Without a
// source and an identity on each turn they all render as the same anonymous
// bubble, which is unreadable once a session runs long.
export type ChatSource = "typed" | "voice" | "screen" | "system"

export interface ChatMessage {
  id: string
  role: "user" | "gemini"
  text: string
  source: ChatSource
  at: number
  /** Clip length, voice turns only. */
  durationSec?: number
}

let counter = 0

export function createMessage(init: {
  role: ChatMessage["role"]
  text: string
  source: ChatSource
  durationSec?: number
  at?: number
}): ChatMessage {
  counter += 1
  return {
    id: `msg-${Date.now()}-${counter}`,
    at: init.at ?? Date.now(),
    role: init.role,
    text: init.text,
    source: init.source,
    durationSec: init.durationSec
  }
}

/**
 * Whether a hairline rule belongs above this message. An exchange is a user
 * turn plus the answer it produced; the rule separates exchanges, not the two
 * halves of one. An assistant turn with no user turn before it (a screen glance
 * or an audio failure) also opens its own exchange.
 */
export function startsExchange(
  prev: ChatMessage | undefined,
  curr: ChatMessage
): boolean {
  if (!prev) return false
  if (curr.source === "system") return true
  if (curr.role === "user") return true
  return prev.role === "gemini"
}

export function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60)
  const secs = Math.floor(totalSeconds % 60)
  return `${mins}:${String(secs).padStart(2, "0")}`
}

export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })
}
