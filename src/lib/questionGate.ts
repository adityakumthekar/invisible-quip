// Whether an accumulated buffer is worth answering.
//
// Auto-fire means something is asked of the model every time the interviewer
// stops talking, and most of what an interviewer says is not a question.
// "Right." "Mm-hmm." "Go on." Answering those costs tokens, but the real damage
// is on screen: a new answer replaces the one the user is in the middle of
// reading.

const BACKCHANNEL =
  /^(ok(ay)?|right|sure|yeah|yep|yes|mm+-?hmm+|uh-?huh|got it|makes sense|i see|cool|great|nice|perfect|go on|exactly|true|fair enough|fair|understood|no problem|alright|gotcha|thanks|thank you)[\s.,!?]*$/i

/**
 * What the transcriber is told to emit for a clip with no words in it — a
 * notification chime that got past the VAD, mostly. It must never reach the
 * buffer, or it becomes part of the next question's prompt.
 */
const NO_SPEECH = /^[([]?\s*no speech\s*[)\]]?[.!]?$/i

export const MIN_QUESTION_WORDS = 4

export function normalizeTranscript(text: string): string {
  const trimmed = text.trim()
  return NO_SPEECH.test(trimmed) ? "" : trimmed
}

export function isBackchannel(text: string): boolean {
  return BACKCHANNEL.test(text.trim())
}

export function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/**
 * A buffer that fails this is kept rather than cleared. "Okay." followed a beat
 * later by the real question should be answered as one thing, and the leading
 * "Okay." costs nothing in the prompt. Staleness is what eventually drops it —
 * see BUFFER_STALE_MS — so a backchannel from a minute ago can't glue itself
 * onto an unrelated question.
 */
export function shouldAnswer(buffer: string): boolean {
  const text = buffer.trim()
  if (!text) return false
  if (isBackchannel(text)) return false
  return wordCount(text) >= MIN_QUESTION_WORDS
}
