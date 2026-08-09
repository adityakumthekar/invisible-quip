// openAIBudget.ts
//
// How many tokens a request will cost, and how many are left to answer with.
// Pure arithmetic — no fetch, no sharp, no Electron — so the awkward cases (a
// prompt that fills the context, a server that never says how big its context
// is) are cheap to pin down in tests. Sibling of visionImage.ts.
//
// Why this exists: an OpenAI-compatible server counts the prompt and the reply
// against one budget, `max_model_len`. Measured against the vLLM serving
// Qwen3-VL-4B (max_model_len=4096), the rule it enforces is narrow but absolute:
//
//   max_tokens = 4000  + 1584-token prompt -> 200 (generates until it runs out)
//   max_tokens = 4096                      -> 400 "maximum context length is 4096"
//   max_tokens = 4097                      -> 400 "max_tokens cannot be greater
//                                                  than max_model_len"
//
// So `max_tokens` must be strictly below `max_model_len` no matter how small the
// prompt is — that is the bug this module exists to prevent, and asking for 8192
// against a 4096 server failed instantly every time. The server does *not*
// reject prompt+output overflow, so we prefer to leave prompt room but never
// turn a request the server would have served into a client-side error.

import type { ImageSize } from "./visionImage"

/**
 * Qwen3-VL cuts an image into 16px patches and merges them 2x2, so one token
 * covers a 32x32 block. Confirmed against the live server's `usage` — measured
 * cost tracked `ceil(w/32) * ceil(h/32)` within ~2% across six sizes from
 * 640x480 to 1568x1018.
 *
 * Note this is NOT visionImage.ts's 28: that module aligns to the older
 * Qwen2-VL patch grid, which is a resize concern, not a billing one. Using 28
 * here over-counted every image by ~30%.
 */
export const VISION_TOKEN_SIDE = 32

/**
 * The vision delimiters wrapped around every image. Measured at a steady +3
 * across sizes whose sides divide evenly by 32 (896x896 cost 787 against 784
 * blocks; 640x480 cost 303 against 300).
 */
const IMAGE_OVERHEAD_TOKENS = 4

/**
 * Roughly a token per 4 characters. Deliberately crude in the safe direction:
 * this should not come in under the server's real tokenizer.
 */
const CHARS_PER_TOKEN = 4

/** Role markers and separators the chat template wraps each message in. */
const PER_MESSAGE_OVERHEAD_TOKENS = 8

/** Absorbs the gap between this estimate and the server's own count. */
const DEFAULT_SAFETY_MARGIN = 64

/** We never clamp below this, even when the prompt is enormous. */
const DEFAULT_MIN_OUTPUT_TOKENS = 256

export function estimateTextTokens(text: string): number {
  if (typeof text !== "string" || text.length === 0) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * What an image costs the context. Every path resizes with sharp first and
 * reports the size it actually produced, so this works from real dimensions
 * rather than guessing from the data URL.
 */
export function estimateImageTokens(size: ImageSize): number {
  if (
    !size ||
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    return 0
  }
  return (
    Math.ceil(size.width / VISION_TOKEN_SIDE) *
      Math.ceil(size.height / VISION_TOKEN_SIDE) +
    IMAGE_OVERHEAD_TOKENS
  )
}

/**
 * Cost of an assembled chat-completions message list. Walks the wire format —
 * `content` is either a plain string or an array of typed parts — so image
 * parts are skipped here and priced from `imageSizes`, which the caller knows
 * and the data URL does not tell us.
 */
export function estimateMessagesTokens(
  messages: Array<{ content: unknown }>,
  imageSizes: ImageSize[] = []
): number {
  let total = 0

  for (const message of messages) {
    total += PER_MESSAGE_OVERHEAD_TOKENS
    const content = message?.content

    if (typeof content === "string") {
      total += estimateTextTokens(content)
      continue
    }

    if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part.text === "string") {
          total += estimateTextTokens(part.text)
        }
      }
    }
  }

  for (const size of imageSizes) {
    total += estimateImageTokens(size)
  }

  return total
}

export interface TokenBudgetInput {
  /** The server's context window, or null when it did not advertise one. */
  maxModelLen: number | null
  promptTokens: number
  requestedMaxTokens: number
  minOutputTokens?: number
  safetyMargin?: number
}

/**
 * The largest `max_tokens` this request may legally ask for.
 *
 * Two rules, in order of authority:
 *  1. Hard — strictly below `max_model_len`, or the server 400s outright. This
 *     is the one it actually enforces, and the one the reported bug broke.
 *  2. Soft — prefer to leave the prompt its room, floored at `minOutputTokens`.
 *     Only a preference: the server happily serves a request whose prompt and
 *     `max_tokens` sum past the window, so an over-cautious estimate here must
 *     never become a client-side error for a request that would have worked.
 */
export function budgetMaxTokens(input: TokenBudgetInput): number {
  const {
    maxModelLen,
    promptTokens,
    requestedMaxTokens,
    minOutputTokens = DEFAULT_MIN_OUTPUT_TOKENS,
    safetyMargin = DEFAULT_SAFETY_MARGIN
  } = input

  // Nothing to budget against. Send what the caller asked for rather than
  // inventing a cap that might truncate a long answer.
  if (maxModelLen == null || !Number.isFinite(maxModelLen) || maxModelLen <= 0) {
    return requestedMaxTokens
  }

  const hardCeiling = maxModelLen - 1
  const preferred = maxModelLen - promptTokens - safetyMargin

  return Math.min(
    requestedMaxTokens,
    Math.max(preferred, minOutputTokens),
    hardCeiling
  )
}

/**
 * Whether the prompt has eaten enough of the context that the reply will likely
 * be cut off. Worth a log line — it is the signal that a session has grown past
 * what this server can hold, which no clamp can fix.
 */
export function promptCrowdsContext(
  promptTokens: number,
  maxModelLen: number | null
): boolean {
  if (maxModelLen == null || !Number.isFinite(maxModelLen) || maxModelLen <= 0) {
    return false
  }
  return promptTokens > maxModelLen - DEFAULT_MIN_OUTPUT_TOKENS
}
