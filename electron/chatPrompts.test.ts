import { beforeEach, describe, expect, it, vi } from "vitest"

const generateContentStream = vi.fn()
const generateContent = vi.fn()

vi.mock("./geminiAdapter", () => ({
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

function request(call = 0) {
  return generateContentStream.mock.calls[call][0]
}

/**
 * The persona, profile and output contract ride in `systemInstruction` now, not
 * in the user turn. These two helpers are what keeps that split honest: a
 * regression that folds the contract back into the message shows up as an empty
 * `sentSystem()`, not as a passing test.
 */
function sentSystem(call = 0): string {
  return request(call).systemInstruction?.parts?.[0]?.text ?? ""
}

/** The newest user turn — the last entry in `contents`. */
function sentUser(call = 0): string {
  const contents = request(call).contents as Array<{
    parts: Array<{ text?: string }>
  }>
  const parts = contents[contents.length - 1].parts
  return parts.find((p) => typeof p.text === "string")?.text ?? ""
}

beforeEach(() => {
  generateContentStream.mockReset()
  generateContent.mockReset()
  vi.unstubAllGlobals()
})

describe("chat response-format contract", () => {
  it("names the direct-answer rule and the language-tagged fence", () => {
    // Guards the behaviours the contract exists for; a rewrite that drops any
    // of them turns the panel back into coaching prose with no code.
    expect(RESPONSE_FORMAT).toMatch(/Answer directly/)
    expect(RESPONSE_FORMAT).toMatch(/your best next action/)
    expect(RESPONSE_FORMAT).toMatch(/```python/)
    expect(RESPONSE_FORMAT).toMatch(/```sql/)
    expect(RESPONSE_FORMAT).toMatch(/Always tag the fence with its language/)
    expect(RESPONSE_FORMAT).toMatch(/\$…\$ inline/)
    expect(RESPONSE_FORMAT).not.toMatch(/possible next steps/)
  })

  it("forbids hedging and clarifying questions", () => {
    // The two rules added for a live overlay: hedged answers read as
    // non-technical, and a question back is dead air nobody can answer.
    expect(RESPONSE_FORMAT).toMatch(/Do not hedge/)
    expect(RESPONSE_FORMAT).toMatch(/it depends/)
    expect(RESPONSE_FORMAT).toMatch(/Never ask a clarifying question/)
  })

  it("puts the persona and the contract in the system layer, not the message", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    const helper = new LLMHelper("test-key")
    helper.setSystemPrompt("PERSONA_MARKER")

    await helper.chatWithGeminiStream("two sum in js", () => {})

    expect(sentSystem()).toContain("PERSONA_MARKER")
    expect(sentSystem()).toContain(RESPONSE_FORMAT)
    // The user turn is the question and nothing else.
    expect(sentUser()).toBe("two sum in js")
  })

  it("carries the contract and the screen preamble on the screen-chat flow", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    const helper = new LLMHelper("test-key")
    helper.setSystemPrompt("PERSONA_MARKER")

    await helper.chatWithImageStream("solve this", [], () => {})

    expect(sentSystem()).toContain("PERSONA_MARKER")
    expect(sentSystem()).toContain(RESPONSE_FORMAT)
    // The preamble is a per-request fact about where the question came from, so
    // it belongs with the message rather than in the system layer.
    expect(sentUser()).toContain("attached screenshot")
    expect(sentUser()).toContain("solve this")
    expect(sentSystem()).not.toContain("attached screenshot")
  })
})

describe("user profile", () => {
  it("carries the profile on plain chat", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    const helper = new LLMHelper("test-key")
    helper.setSystemPrompt("PERSONA_MARKER")
    helper.setUserProfile("PROFILE_MARKER")

    await helper.chatWithGeminiStream("why is this slow", () => {})

    expect(sentSystem()).toContain("PROFILE_MARKER")
    expect(sentSystem()).toContain("PERSONA_MARKER")
    expect(sentSystem()).toContain(RESPONSE_FORMAT)
  })

  it("carries the profile on the screen-chat flow", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    const helper = new LLMHelper("test-key")
    helper.setUserProfile("PROFILE_MARKER")

    await helper.chatWithImageStream("solve this", [], () => {})

    expect(sentSystem()).toContain("PROFILE_MARKER")
  })

  it("adds no profile section when none is set", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    const helper = new LLMHelper("test-key")
    helper.setSystemPrompt("PERSONA_MARKER")

    await helper.chatWithGeminiStream("hi", () => {})

    expect(sentSystem()).toContain("PERSONA_MARKER")
    expect(sentSystem()).not.toContain("About the user")
  })

  it("clears on empty — unlike setSystemPrompt, which keeps the last value", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    const helper = new LLMHelper("test-key")
    helper.setUserProfile("PROFILE_MARKER")
    helper.setUserProfile("")

    await helper.chatWithGeminiStream("hi", () => {})

    expect(sentSystem()).not.toContain("PROFILE_MARKER")
    expect(sentSystem()).not.toContain("About the user")
  })
})

describe("per-request persona override", () => {
  it("replaces the active mode for that one request", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    const helper = new LLMHelper("test-key")
    helper.setSystemPrompt("PERSONA_MARKER")

    await helper.chatWithImageStream(
      "translate this",
      [],
      () => {},
      undefined,
      [],
      "OVERRIDE_MARKER"
    )

    expect(sentSystem()).toContain("OVERRIDE_MARKER")
    expect(sentSystem()).not.toContain("PERSONA_MARKER")
  })

  it("keeps the profile and the contract, which are not the mode", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    const helper = new LLMHelper("test-key")
    helper.setSystemPrompt("PERSONA_MARKER")
    helper.setUserProfile("PROFILE_MARKER")

    await helper.chatWithGeminiStream(
      "translate this",
      () => {},
      undefined,
      [],
      "OVERRIDE_MARKER"
    )

    expect(sentSystem()).toContain("PROFILE_MARKER")
    expect(sentSystem()).toContain(RESPONSE_FORMAT)
  })

  it("leaves the active mode in place when no override is given", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    const helper = new LLMHelper("test-key")
    helper.setSystemPrompt("PERSONA_MARKER")

    await helper.chatWithGeminiStream("normal question", () => {})

    expect(sentSystem()).toContain("PERSONA_MARKER")
  })
})

describe("Ollama parity", () => {
  /** One NDJSON line, the shape callOllamaStream buffers and parses. */
  function ndjson(text: string) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            JSON.stringify({ response: text, done: true }) + "\n"
          )
        )
        controller.close()
      }
    })
    return { ok: true, status: 200, statusText: "OK", body } as Response
  }

  function generateBody(fetchMock: ReturnType<typeof vi.fn>) {
    const call = fetchMock.mock.calls.find(([url]: [string]) =>
      String(url).includes("/api/generate")
    )
    return JSON.parse((call![1] as RequestInit).body as string)
  }

  function mockOllama() {
    const fetchMock = vi.fn(async (url: string) => {
      // The constructor probes for models; an empty list ends that path without
      // consuming the generate mock.
      if (String(url).includes("/api/tags")) {
        return { ok: true, json: async () => ({ models: [] }) } as unknown as Response
      }
      return ndjson("ok")
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  it("sends persona, profile and contract as the system field on screen chat", async () => {
    // This path used to send the bare message — no persona, no profile, no
    // contract — because Ollama can't take a screenshot anyway.
    const fetchMock = mockOllama()
    const helper = new LLMHelper(undefined, true, "llava")
    helper.setSystemPrompt("PERSONA_MARKER")
    helper.setUserProfile("PROFILE_MARKER")

    await helper.chatWithImageStream("solve this", [], () => {})

    const body = generateBody(fetchMock)
    expect(body.system).toContain("PERSONA_MARKER")
    expect(body.system).toContain("PROFILE_MARKER")
    expect(body.system).toContain(RESPONSE_FORMAT)
    expect(body.prompt).toContain("solve this")
  })

  it("honours the persona override on plain chat", async () => {
    const fetchMock = mockOllama()
    const helper = new LLMHelper(undefined, true, "llama3.2")
    helper.setSystemPrompt("PERSONA_MARKER")

    await helper.chatWithGeminiStream(
      "translate this",
      () => {},
      undefined,
      [],
      "OVERRIDE_MARKER"
    )

    const body = generateBody(fetchMock)
    expect(body.system).toContain("OVERRIDE_MARKER")
    expect(body.system).not.toContain("PERSONA_MARKER")
  })
})

describe("systemInstruction downgrade", () => {
  const rejection = () =>
    new Error(
      'Invalid JSON payload received. Unknown name "systemInstruction": Cannot find field.'
    )

  it("retries concatenated when the endpoint rejects the field", async () => {
    generateContentStream
      .mockRejectedValueOnce(rejection())
      .mockReturnValueOnce(fakeStream(["ok"]))
    const helper = new LLMHelper("test-key")
    helper.setSystemPrompt("PERSONA_MARKER")

    const text = await helper.chatWithGeminiStream("two sum", () => {})

    expect(text).toBe("ok")
    expect(generateContentStream).toHaveBeenCalledTimes(2)
    // The retry carries everything the first attempt did, just folded back into
    // the user turn — the answer must not silently lose the persona.
    expect(request(1).systemInstruction).toBeUndefined()
    expect(sentUser(1)).toContain("PERSONA_MARKER")
    expect(sentUser(1)).toContain(RESPONSE_FORMAT)
    expect(sentUser(1)).toContain("User: two sum")
  })

  it("stays downgraded for the rest of the session", async () => {
    generateContentStream
      .mockRejectedValueOnce(rejection())
      .mockReturnValueOnce(fakeStream(["ok"]))
      .mockReturnValueOnce(fakeStream(["ok"]))
    const helper = new LLMHelper("test-key")

    await helper.chatWithGeminiStream("first", () => {})
    await helper.chatWithGeminiStream("second", () => {})

    // Three calls, not four: the second question pays no retry.
    expect(generateContentStream).toHaveBeenCalledTimes(3)
    expect(request(2).systemInstruction).toBeUndefined()
  })

  it("does not downgrade on an unrelated failure", async () => {
    generateContentStream.mockRejectedValueOnce(new Error("429 rate limited"))
    const helper = new LLMHelper("test-key")

    await expect(
      helper.chatWithGeminiStream("two sum", () => {})
    ).rejects.toThrow(/rate limited/)
    expect(generateContentStream).toHaveBeenCalledTimes(1)
  })
})
