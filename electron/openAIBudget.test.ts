import { describe, expect, it } from "vitest"
import {
  budgetMaxTokens,
  estimateImageTokens,
  estimateMessagesTokens,
  estimateTextTokens,
  promptCrowdsContext
} from "./openAIBudget"

/**
 * Measured against the live vLLM's reported `usage`, minus the 8-token chat
 * template overhead. These are the numbers the constants are calibrated to.
 */
const MEASURED = [
  { width: 1568, height: 1018, tokens: 1571 },
  { width: 1512, height: 980, tokens: 1460 },
  { width: 896, height: 896, tokens: 787 },
  { width: 640, height: 480, tokens: 303 },
  { width: 1280, height: 720, tokens: 883 }
]

describe("estimateImageTokens", () => {
  it("matches what the server actually charged, within 5%", () => {
    for (const { width, height, tokens } of MEASURED) {
      const estimate = estimateImageTokens({ width, height })
      const error = Math.abs(estimate - tokens) / tokens
      expect(error, `${width}x${height}: estimated ${estimate}, server ${tokens}`)
        .toBeLessThan(0.05)
    }
  })

  it("never undercounts, so the budget cannot overshoot", () => {
    for (const { width, height, tokens } of MEASURED) {
      expect(estimateImageTokens({ width, height })).toBeGreaterThanOrEqual(
        tokens * 0.97
      )
    }
  })

  it("charges one token per 32x32 block", () => {
    // Qwen3-VL merges 16px patches 2x2. Using visionImage.ts's 28 here was the
    // Qwen2-VL number and inflated every image by ~30%.
    const base = estimateImageTokens({ width: 320, height: 320 })
    expect(base - estimateImageTokens({ width: 32, height: 32 })).toBe(99)
  })

  it("treats a missing or degenerate size as free rather than throwing", () => {
    expect(estimateImageTokens({ width: 0, height: 100 })).toBe(0)
    expect(estimateImageTokens(undefined as any)).toBe(0)
  })
})

describe("estimateTextTokens", () => {
  it("never rounds down, so the estimate cannot undershoot", () => {
    expect(estimateTextTokens("abc")).toBe(1)
    expect(estimateTextTokens("a".repeat(4001))).toBe(1001)
  })

  it("is zero for empty or absent text", () => {
    expect(estimateTextTokens("")).toBe(0)
    expect(estimateTextTokens(undefined as any)).toBe(0)
  })
})

describe("estimateMessagesTokens", () => {
  it("counts string content and multimodal text parts alike", () => {
    const asString = estimateMessagesTokens([{ content: "a".repeat(400) }])
    const asParts = estimateMessagesTokens([
      { content: [{ type: "text", text: "a".repeat(400) }] }
    ])
    expect(asString).toBe(asParts)
    expect(asString).toBeGreaterThanOrEqual(100)
  })

  it("prices images from the sizes passed alongside, not the data URL", () => {
    const messages = [
      {
        content: [
          { type: "text", text: "hi" },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } }
        ]
      }
    ]

    const withoutImage = estimateMessagesTokens(messages)
    const withImage = estimateMessagesTokens(messages, [
      { width: 320, height: 320 }
    ])

    expect(withImage - withoutImage).toBe(
      estimateImageTokens({ width: 320, height: 320 })
    )
  })

  it("adds per-message overhead for the chat template", () => {
    const one = estimateMessagesTokens([{ content: "" }])
    const two = estimateMessagesTokens([{ content: "" }, { content: "" }])
    expect(two).toBeGreaterThan(one)
  })
})

describe("budgetMaxTokens", () => {
  const base = { promptTokens: 1000, requestedMaxTokens: 8192 }

  it("clamps a cap larger than the whole context", () => {
    // The reported bug: max_tokens=8192 against max_model_len=4096.
    const budget = budgetMaxTokens({ ...base, maxModelLen: 4096 })
    expect(budget).toBeLessThanOrEqual(4096 - 1000)
    expect(budget).toBeGreaterThan(0)
  })

  it("stays strictly under max_model_len even with an empty prompt", () => {
    // Measured: max_tokens=4096 against max_model_len=4096 is a 400, and 4097
    // is a different 400. Only strictly-below is accepted.
    const budget = budgetMaxTokens({
      maxModelLen: 4096,
      promptTokens: 0,
      requestedMaxTokens: 100000
    })
    expect(budget).toBeLessThan(4096)
  })

  it("leaves the prompt its room when it can", () => {
    const budget = budgetMaxTokens({
      maxModelLen: 4096,
      promptTokens: 2700,
      requestedMaxTokens: 8192
    })
    expect(budget + 2700).toBeLessThan(4096)
  })

  it("passes a modest request through untouched when it already fits", () => {
    expect(
      budgetMaxTokens({
        maxModelLen: 32768,
        promptTokens: 1000,
        requestedMaxTokens: 1024
      })
    ).toBe(1024)
  })

  it("does not clamp when the server advertises no limit", () => {
    expect(budgetMaxTokens({ ...base, maxModelLen: null })).toBe(8192)
    expect(budgetMaxTokens({ ...base, maxModelLen: 0 })).toBe(8192)
    expect(budgetMaxTokens({ ...base, maxModelLen: NaN })).toBe(8192)
  })

  it("still returns a usable cap when the prompt fills the context", () => {
    // The server serves this happily — it does not enforce prompt+output
    // against the window — so an over-cautious estimate must not turn a working
    // request into a client-side error.
    const budget = budgetMaxTokens({
      maxModelLen: 4096,
      promptTokens: 4000,
      requestedMaxTokens: 512
    })
    expect(budget).toBeGreaterThanOrEqual(256)
    expect(budget).toBeLessThan(4096)
  })

  it("never exceeds what the caller asked for", () => {
    expect(
      budgetMaxTokens({
        maxModelLen: 128000,
        promptTokens: 10,
        requestedMaxTokens: 512
      })
    ).toBe(512)
  })
})

describe("promptCrowdsContext", () => {
  it("flags a session that has outgrown the window", () => {
    expect(promptCrowdsContext(3900, 4096)).toBe(true)
    expect(promptCrowdsContext(2000, 4096)).toBe(false)
  })

  it("says nothing when the window is unknown", () => {
    expect(promptCrowdsContext(999999, null)).toBe(false)
  })
})
