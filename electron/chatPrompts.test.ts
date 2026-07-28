import { beforeEach, describe, expect, it, vi } from "vitest"

const generateContentStream = vi.fn()
const generateContent = vi.fn()

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContentStream, generateContent }
    }
  }
}))

import { LLMHelper, RESPONSE_FORMAT } from "./LLMHelper"

/** Mimic the SDK's `{ stream }` async iterable of `{ text() }` chunks. */
function fakeStream(deltas: string[]) {
  return {
    stream: (async function* () {
      for (const delta of deltas) {
        yield { text: () => delta }
      }
    })()
  }
}

/** The prompt is the first text part of the request handed to the SDK. */
function sentPrompt(): string {
  const request = generateContentStream.mock.calls[0][0]
  const parts = request.contents[0].parts as Array<{ text?: string }>
  return parts.find((p) => typeof p.text === "string")?.text ?? ""
}

beforeEach(() => {
  generateContentStream.mockReset()
  generateContent.mockReset()
})

describe("chat response-format contract", () => {
  it("names the direct-answer rule and the language-tagged fence", () => {
    // Guards the two behaviours the contract exists for; a rewrite that drops
    // either turns the panel back into coaching prose with no code.
    expect(RESPONSE_FORMAT).toMatch(/Answer directly/)
    expect(RESPONSE_FORMAT).toMatch(/your best next action/)
    expect(RESPONSE_FORMAT).toMatch(/```python/)
    expect(RESPONSE_FORMAT).toMatch(/```sql/)
    expect(RESPONSE_FORMAT).toMatch(/Always tag the fence with its language/)
    expect(RESPONSE_FORMAT).toMatch(/\$…\$ inline/)
    expect(RESPONSE_FORMAT).not.toMatch(/possible next steps/)
  })

  it("carries the contract, the persona and the message in plain chat", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    const helper = new LLMHelper("test-key")
    helper.setSystemPrompt("PERSONA_MARKER")

    await helper.chatWithGeminiStream("two sum in js", () => {})

    const prompt = sentPrompt()
    expect(prompt).toContain("PERSONA_MARKER")
    expect(prompt).toContain(RESPONSE_FORMAT)
    expect(prompt).toContain("User: two sum in js")
  })

  it("carries the contract on the screen-chat flow", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    const helper = new LLMHelper("test-key")
    helper.setSystemPrompt("PERSONA_MARKER")

    await helper.chatWithImageStream("solve this", [], () => {})

    const prompt = sentPrompt()
    expect(prompt).toContain("PERSONA_MARKER")
    expect(prompt).toContain(RESPONSE_FORMAT)
    expect(prompt).toContain("User: solve this")
  })
})
