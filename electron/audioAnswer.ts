// The voice reply is asked for as two labelled sections so the spoken words can
// be shown as the user's own turn. A model that ignores the format must still
// produce a usable answer, so every failure path degrades to "all answer".
const TRANSCRIPT = /^[ \t]*transcript:[ \t]*(.*)$/im
const ANSWER = /^[ \t]*answer:[ \t]*/im

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
  const spoken = transcriptMatch?.[1].trim() ?? ""
  const transcript = /^\(?no speech\)?\.?$/i.test(spoken) ? "" : spoken

  return { transcript, answer }
}
