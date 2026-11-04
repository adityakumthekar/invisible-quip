// The voice reply is asked for as two labelled sections so the spoken words can
// be shown as the user's own turn. A model that ignores the format must still
// produce a usable answer, so every failure path degrades to "all answer".
// Label-only: the transcript runs to the ANSWER: label, not to the end of its
// own line. A dual-speaker clip puts one turn per line under this label.
const TRANSCRIPT = /^[ \t]*transcript:[ \t]*/im
const ANSWER = /^[ \t]*answer:[ \t]*/im

const NO_SPEECH = /^\(?no speech\)?\.?$/i

export function parseAudioAnswer(raw: string): {
  transcript: string
  answer: string
} {
  const answerMatch = ANSWER.exec(raw)
  if (!answerMatch) {
    return { transcript: "", answer: raw.trim() }
  }

  const head = raw.slice(0, answerMatch.index)
  const answer = raw.slice(answerMatch.index + answerMatch[0].length).trim()

  const transcriptMatch = TRANSCRIPT.exec(head)
  const spoken = transcriptMatch
    ? head.slice(transcriptMatch.index + transcriptMatch[0].length).trim()
    : ""
  const transcript = NO_SPEECH.test(spoken) ? "" : spoken

  return { transcript, answer }
}

/** Which side of the conversation a spoken turn came from. */
export interface TranscriptTurn {
  speaker: "you" | "them"
  text: string
}

// Aliases because the model reaches for the natural word as often as the one it
// was told to use, and a missed label would silently reattribute the turn.
const SPEAKER_LINE = /^[ \t]*(you|me|them|interviewer)[ \t]*:[ \t]*/i

/**
 * One transcript block into attributed turns. A mic-only clip carries no labels
 * at all and must keep working, so anything before the first label — which is
 * the whole thing in that case — is the user speaking.
 */
export function parseTranscriptTurns(transcript: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []

  for (const line of transcript.split("\n")) {
    const match = SPEAKER_LINE.exec(line)
    if (match) {
      const label = match[1].toLowerCase()
      turns.push({
        speaker: label === "you" || label === "me" ? "you" : "them",
        text: line.slice(match[0].length).trim()
      })
      continue
    }
    // A continuation of the open turn, or — before any label — the user.
    const text = line.trim()
    if (!text) continue
    const open = turns[turns.length - 1]
    if (open) open.text = open.text ? `${open.text}\n${text}` : text
    else turns.push({ speaker: "you", text })
  }

  return turns.filter((t) => t.text && !NO_SPEECH.test(t.text))
}

/**
 * `parseAudioAnswer` for a stream. Gemini writes the transcript section first,
 * so nothing is forwarded until the ANSWER: label lands; from then on deltas
 * pass straight through. The label can arrive split across deltas, which is
 * why the whole buffer is re-tested rather than each delta.
 *
 * A reply that never produces the label degrades the same way the one-shot
 * parser does — all answer — just delivered in one piece at `finish`.
 */
export function createAnswerSplitter(handlers: {
  onTranscript: (transcript: string) => void
  onAnswerDelta: (delta: string) => void
}) {
  let raw = ""
  let answerFrom = -1
  let forwarded = 0

  return {
    push(delta: string): void {
      raw += delta
      if (answerFrom === -1) {
        const match = ANSWER.exec(raw)
        if (!match) return
        answerFrom = match.index + match[0].length
        forwarded = answerFrom
        handlers.onTranscript(parseAudioAnswer(raw).transcript)
      }
      // The first piece can start with spaces the label regex hadn't seen yet.
      const pending = raw.slice(forwarded)
      const out = forwarded === answerFrom ? pending.replace(/^[ \t]+/, "") : pending
      forwarded = raw.length
      if (out) handlers.onAnswerDelta(out)
    },

    finish(): { transcript: string; answer: string } {
      const parsed = parseAudioAnswer(raw)
      if (answerFrom === -1) {
        handlers.onTranscript(parsed.transcript)
        if (parsed.answer) handlers.onAnswerDelta(parsed.answer)
      }
      return parsed
    }
  }
}
