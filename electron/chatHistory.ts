export interface ChatTurn {
  role: "user" | "gemini"
  text: string
}

export interface GeminiContent {
  role: "user" | "model"
  parts: { text: string }[]
}

export const HISTORY_MAX_TURNS = 12
/**
 * The cap that actually binds. One code-heavy answer runs well past a thousand
 * characters, so a turn count alone would let a long session quietly triple the
 * cost and latency of every follow-up.
 */
export const HISTORY_MAX_CHARS = 6000

/** Most recent turns that fit both budgets, oldest dropped first. */
function withinBudget(turns: ChatTurn[]): ChatTurn[] {
  const kept: ChatTurn[] = []
  let chars = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (kept.length >= HISTORY_MAX_TURNS) break
    // The length guard yields to the newest turn: dropping it would send an
    // empty history rather than a truncated one.
    if (chars + turn.text.length > HISTORY_MAX_CHARS && kept.length > 0) break
    kept.push(turn)
    chars += turn.text.length
  }
  return kept.reverse()
}

export function toGeminiHistory(turns: ChatTurn[]): GeminiContent[] {
  const bounded = withinBudget(turns)
  // Trimming can leave an answer at the front with nothing it answers.
  let start = 0
  while (start < bounded.length && bounded[start].role === "gemini") start += 1
  return bounded.slice(start).map((turn) => ({
    role: turn.role === "gemini" ? ("model" as const) : ("user" as const),
    parts: [{ text: turn.text }]
  }))
}

/** Ollama takes a single prompt string, so its history has to be inlined. */
export function flattenHistory(turns: ChatTurn[]): string {
  return withinBudget(turns)
    .map((t) => `${t.role === "gemini" ? "Assistant" : "User"}: ${t.text}`)
    .join("\n")
}
