// A session mixes typed questions, voice notes and screen glances. Without a
// source and an identity on each turn they all render as the same anonymous
// bubble, which is unreadable once a session runs long.
export type ChatSource = "typed" | "voice" | "screen" | "system"

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  text: string
  source: ChatSource
  at: number
  /** Clip length, voice turns only. */
  durationSec?: number
  /**
   * Which voice a turn came from when system audio is being captured too.
   * `role` stays "user" for both — it means "not the assistant", and the
   * provider contract has no third side. Undefined means "you", so every
   * pre-existing turn keeps its meaning.
   */
  speaker?: "you" | "them"
}

let counter = 0

export function createMessage(init: {
  role: ChatMessage["role"]
  text: string
  source: ChatSource
  durationSec?: number
  at?: number
  speaker?: ChatMessage["speaker"]
}): ChatMessage {
  counter += 1
  return {
    id: `msg-${Date.now()}-${counter}`,
    at: init.at ?? Date.now(),
    role: init.role,
    text: init.text,
    source: init.source,
    durationSec: init.durationSec,
    speaker: init.speaker
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
  // One two-speaker clip lands as several user turns. They are one question,
  // so no rule goes between them — but a voice turn after a typed one still
  // opens its own exchange, which is why this is narrowed to voice-on-voice.
  if (curr.role === "user")
    return !(
      prev.role === "user" &&
      prev.source === "voice" &&
      curr.source === "voice"
    )
  return prev.role === "assistant"
}

/**
 * Index of the message that opens the newest exchange — the scroll anchor the
 * answer panel pins to the top. Element 0 opens the first exchange by
 * definition; startsExchange says otherwise only because it has no predecessor
 * to compare against.
 */
export function lastExchangeStart(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i > 0; i--) {
    if (startsExchange(messages[i - 1], messages[i])) return i
  }
  return 0
}

/** A turn as it goes over the wire — the model has no use for ids or clocks. */
export interface ChatTurn {
  role: "user" | "assistant"
  text: string
}

/**
 * The part of the transcript that counts as conversation. System notices are
 * app chrome, and empty turns are streaming placeholders or the header-only
 * turns a screen glance / silent clip leaves behind — sending either would put
 * an empty part in the request, which the model rejects.
 */
export function toHistory(messages: ChatMessage[]): ChatTurn[] {
  const kept = messages.filter(
    (m) => m.source !== "system" && m.text.trim().length > 0
  )

  const turns: ChatTurn[] = []
  for (let i = 0; i < kept.length; ) {
    if (kept[i].role !== "user") {
      turns.push({ role: kept[i].role, text: kept[i].text })
      i += 1
      continue
    }
    // A run of consecutive user turns is one two-speaker clip, or just
    // unrelated turns that happen to be adjacent.
    let end = i
    while (end < kept.length && kept[end].role === "user") end += 1
    const run = kept.slice(i, end)
    if (run.some((m) => m.speaker === "them")) {
      // Collapsed into one turn: two consecutive user `contents` is not a shape
      // worth relying on, and the labels are what carry the attribution.
      turns.push({
        role: "user",
        text: run
          .map(
            (m) => `${m.speaker === "them" ? "Interviewer" : "Me"}: ${m.text}`
          )
          .join("\n")
      })
    } else {
      // Byte-identical to what typed and mic-only sessions have always sent.
      for (const m of run) turns.push({ role: m.role, text: m.text })
    }
    i = end
  }
  return turns
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
