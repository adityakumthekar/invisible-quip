export interface ChatTurn {
  role: "user" | "assistant"
  text: string
}

export interface GeminiContent {
  role: "user" | "model"
  parts: { text: string }[]
}

export const HISTORY_MAX_TURNS = 20
/**
 * The cap that actually binds. One code-heavy answer runs well past a thousand
 * characters, so a turn count alone would let a long session quietly triple the
 * cost and latency of every follow-up.
 *
 * Sized for a full interview rather than a couple of follow-ups: at 6000 the
 * window held 2-4 exchanges, so a problem stated at minute 5 was gone by minute
 * 25. 16000 is ~4k tokens — still a rounding error against the model's window.
 */
export const HISTORY_MAX_CHARS = 16000

/**
 * Ollama takes one prompt string and `callOllamaStream` sets no `num_ctx`, so a
 * local model truncates at its default (~4k tokens) from the front — which would
 * eat the anchor the wide budget exists to protect. Keep that path narrow.
 */
export const OLLAMA_MAX_TURNS = 12
export const OLLAMA_MAX_CHARS = 6000

/** How much of the anchor is pinned, so a long pasted problem can't eat the budget. */
export const ANCHOR_MAX_CHARS = 1500

interface Budget {
  maxTurns: number
  maxChars: number
}

const GEMINI_BUDGET: Budget = {
  maxTurns: HISTORY_MAX_TURNS,
  maxChars: HISTORY_MAX_CHARS
}

const OLLAMA_BUDGET: Budget = {
  maxTurns: OLLAMA_MAX_TURNS,
  maxChars: OLLAMA_MAX_CHARS
}

/** Most recent turns that fit what's left of both budgets, oldest dropped first. */
function recentWindow(
  turns: ChatTurn[],
  budget: Budget,
  reserved: { turns: number; chars: number }
): ChatTurn[] {
  const kept: ChatTurn[] = []
  let chars = reserved.chars
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (kept.length + reserved.turns >= budget.maxTurns) break
    // The length guard yields to the newest turn: dropping it would send an
    // empty history rather than a truncated one.
    if (chars + turn.text.length > budget.maxChars && kept.length > 0) break
    kept.push(turn)
    chars += turn.text.length
  }
  return kept.reverse()
}

/** Trimming can leave an answer at the front with nothing it answers. */
function dropLeadingAnswers(turns: ChatTurn[]): ChatTurn[] {
  let start = 0
  while (start < turns.length && turns[start].role === "assistant") start += 1
  return turns.slice(start)
}

/**
 * The recent window, plus the turn that opened the session pinned to the front.
 *
 * Recency alone is the wrong shape for an interview: the first question is the
 * premise every later "now make it faster" refers to, and it is also the first
 * thing oldest-first trimming throws away. Pinning it costs at most
 * ANCHOR_MAX_CHARS and keeps follow-ups anchored to what was actually asked.
 */
function withinBudget(turns: ChatTurn[], budget: Budget): ChatTurn[] {
  const anchorIndex = turns.findIndex((t) => t.role === "user")
  const window = recentWindow(turns, budget, { turns: 0, chars: 0 })
  // No question yet, or the opening one is still inside the window on its own.
  if (anchorIndex === -1 || anchorIndex >= turns.length - window.length) {
    return window
  }

  const anchor: ChatTurn = {
    role: "user",
    text: turns[anchorIndex].text.slice(0, ANCHOR_MAX_CHARS)
  }
  const rest = recentWindow(turns, budget, {
    turns: 1,
    chars: anchor.text.length
  })
  // Without this the anchor is followed by an answer to some other question,
  // which reads as its answer.
  return [anchor, ...dropLeadingAnswers(rest)]
}

export function toGeminiHistory(turns: ChatTurn[]): GeminiContent[] {
  // withinBudget already strips a leading answer after the anchor; this covers
  // the un-anchored case, where the window can still open on one.
  return dropLeadingAnswers(withinBudget(turns, GEMINI_BUDGET)).map((turn) => ({
    role: turn.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: turn.text }]
  }))
}

/** Ollama takes a single prompt string, so its history has to be inlined. */
export function flattenHistory(turns: ChatTurn[]): string {
  return withinBudget(turns, OLLAMA_BUDGET)
    .map((t) => `${t.role === "assistant" ? "Assistant" : "User"}: ${t.text}`)
    .join("\n")
}
