import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import sharp from "sharp"

const send = vi.fn()

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    constructor(readonly config: unknown) {}
    send = send
  },
  ConverseCommand: class {
    kind = "converse"
    constructor(readonly input: any) {}
  },
  ConverseStreamCommand: class {
    kind = "stream"
    constructor(readonly input: any) {}
  }
}))

import { LLMHelper } from "./LLMHelper"
import { toConverseHistory } from "./chatHistory"
import { bedrockApiKeyFromEnv, withUserTurn } from "./bedrockClient"
import { createSpeechToText, labelledTranscript } from "./speechToText"

const BEDROCK = { apiKey: "bedrock-key", region: "us-east-1", modelId: "claude-test" }

function helper() {
  return new LLMHelper(undefined, false, undefined, undefined, BEDROCK)
}

function streamOf(deltas: string[]) {
  return {
    stream: (async function* () {
      for (const text of deltas) {
        yield { contentBlockDelta: { delta: { text } } }
      }
      yield { messageStop: { stopReason: "end_turn" } }
    })()
  }
}

function reply(text: string, stopReason = "end_turn") {
  return {
    output: { message: { role: "assistant", content: [{ text }] } },
    stopReason
  }
}

/** The input of the n-th command handed to the SDK. */
const sent = (n = 0) => send.mock.calls[n][0].input

beforeEach(() => {
  send.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("toConverseHistory", () => {
  it("maps roles and merges same-role neighbours so roles alternate", () => {
    const history = toConverseHistory([
      { role: "gemini", text: "orphan answer" },
      { role: "user", text: "q1" },
      { role: "user", text: "q1 again (first answer aborted)" },
      { role: "gemini", text: "a1" },
      { role: "user", text: "" }
    ])
    expect(history).toEqual([
      {
        role: "user",
        content: [{ text: "q1" }, { text: "q1 again (first answer aborted)" }]
      },
      { role: "assistant", content: [{ text: "a1" }] }
    ])
  })

  it("keeps the pinned anchor without a user-user collision", () => {
    const turns = [
      { role: "user" as const, text: "Opening problem statement" },
      ...Array.from({ length: 30 }, (_, i) => ({
        role: (i % 2 === 0 ? "gemini" : "user") as "gemini" | "user",
        text: `turn ${i} ${"x".repeat(400)}`
      }))
    ]
    const history = toConverseHistory(turns)
    expect(history[0].role).toBe("user")
    expect(history[0].content[0].text).toBe("Opening problem statement")
    for (let i = 1; i < history.length; i++) {
      expect(history[i].role).not.toBe(history[i - 1].role)
    }
  })
})

describe("withUserTurn", () => {
  it("merges into a trailing user turn instead of appending a second one", () => {
    const messages = withUserTurn(
      [{ role: "user", content: [{ text: "unanswered" }] }],
      [{ text: "follow-up" }]
    )
    expect(messages).toEqual([
      { role: "user", content: [{ text: "unanswered" }, { text: "follow-up" }] }
    ])
  })
})

describe("Bedrock chat", () => {
  it("streams deltas and sends the same system layer as Gemini", async () => {
    send.mockResolvedValue(streamOf(["Hash", "Map"]))
    const llm = helper()
    llm.setUserProfile("Senior backend engineer, Go")
    const chunks: string[] = []

    const text = await llm.chatWithGeminiStream(
      "Two sum?",
      (d) => chunks.push(d),
      undefined,
      [
        { role: "user", text: "earlier" },
        { role: "gemini", text: "earlier answer" }
      ]
    )

    expect(text).toBe("HashMap")
    expect(chunks).toEqual(["Hash", "Map"])
    const input = sent()
    expect(send.mock.calls[0][0].kind).toBe("stream")
    expect(input.modelId).toBe("claude-test")
    expect(input.system[0].text).toContain("You are Quip")
    expect(input.system[0].text).toContain("Senior backend engineer, Go")
    expect(input.system[0].text).toContain("OUTPUT CONTRACT")
    expect(input.messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user"])
    expect(input.messages[2].content).toEqual([{ text: "Two sum?" }])
    expect(input.inferenceConfig).toEqual({ temperature: 0.25, maxTokens: 2048 })
  })

  it("stops forwarding on abort and treats the SDK's abort as a normal end", async () => {
    const controller = new AbortController()
    send.mockResolvedValue({
      stream: (async function* () {
        yield { contentBlockDelta: { delta: { text: "first" } } }
        controller.abort()
        throw Object.assign(new Error("Request aborted"), { name: "AbortError" })
      })()
    })
    const chunks: string[] = []

    const text = await helper().chatWithGeminiStream(
      "q",
      (d) => chunks.push(d),
      controller.signal
    )

    expect(text).toBe("first")
    expect(chunks).toEqual(["first"])
    expect(send.mock.calls[0][1]).toEqual({ abortSignal: controller.signal })
  })

  it("puts a downscaled JPEG before the question on screen chats", async () => {
    send.mockResolvedValue(streamOf(["ok"]))
    const png = await sharp({
      create: { width: 3024, height: 1964, channels: 3, background: "#245" }
    })
      .png()
      .toBuffer()

    await helper().chatWithImageStream("what is this?", [png], () => {})

    const content = sent().messages[0].content
    expect(content[0].image.format).toBe("jpeg")
    const meta = await sharp(content[0].image.source.bytes).metadata()
    expect(Math.max(meta.width!, meta.height!)).toBe(1568)
    expect(content[1].text).toContain("what is this?")
  })

  it("reports itself as the bedrock provider and model", () => {
    const llm = helper()
    expect(llm.getCurrentProvider()).toBe("bedrock")
    expect(llm.getCurrentModel()).toBe("claude-test")
    expect(llm.isUsingOllama()).toBe(false)
  })
})

describe("Bedrock teaching step", () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "quip-bedrock-"))
  })
  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true })
  })

  async function retinaShot() {
    const file = path.join(dir, "shot.png")
    await sharp({
      create: { width: 3024, height: 1964, channels: 3, background: "#123" }
    })
      .png()
      .toFile(file)
    return file
  }

  it("sends an image inside Claude's budget and normalizes pixels against it", async () => {
    const file = await retinaShot()
    send.mockImplementation(async (command: any) => {
      // Answer with the exact centre of whatever image was actually sent.
      const bytes = command.input.messages[0].content[0].image.source.bytes
      const { width, height } = await sharp(bytes).metadata()
      return reply(
        JSON.stringify({
          state: "step",
          instruction: "Click OK",
          action: "click",
          risk: "safe",
          target: { x: width! / 2 - 10, y: height! / 2 - 10, width: 20, height: 20 }
        })
      )
    })

    const step = await helper().generateTeachingStep("goal", [], file, {
      width: 3024,
      height: 1964
    })

    const input = sent()
    const image = input.messages[0].content[0].image
    const meta = await sharp(image.source.bytes).metadata()
    expect(image.format).toBe("png")
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1568)
    expect(meta.width! * meta.height!).toBeLessThanOrEqual(1_150_000)
    expect(input.messages[0].content[1].text).toContain(
      `${meta.width}×${meta.height}`
    )
    expect(input.inferenceConfig.temperature).toBe(0)
    expect(step.state).toBe("step")
    if (step.state === "step") {
      const cx = step.target.x + step.target.width! / 2
      const cy = step.target.y + step.target.height! / 2
      expect(cx).toBeCloseTo(500, -1)
      expect(cy).toBeCloseTo(500, -1)
    }
  })

  it("turns a max_tokens stop into an actionable error", async () => {
    const file = await retinaShot()
    send.mockResolvedValue(reply('{"state":"st', "max_tokens"))
    await expect(
      helper().generateTeachingStep("goal", [], file, { width: 3024, height: 1964 })
    ).rejects.toThrow(/max_tokens/)
  })
})

describe("Bedrock voice via Sarvam", () => {
  /** Sarvam stand-in: the transcript is whatever text the uploaded file holds. */
  function stubSarvam() {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const file = init.body.get("file") as Blob
      return new Response(JSON.stringify({ transcript: await file.text() }), {
        status: 200
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  const b64 = (text: string) => Buffer.from(text).toString("base64")

  it("labels mic as YOU and system audio as THEM, then asks Claude", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sarvam-key")
    const fetchMock = stubSarvam()
    send.mockResolvedValue(reply("Use a hash map."))

    const result = await helper().analyzeAudioFromBase64(
      b64("let me think"),
      "audio/webm",
      [],
      { data: b64("how would you solve two sum"), mimeType: "audio/webm" }
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      "api-subscription-key": "sarvam-key"
    })
    expect(result.transcript).toBe("THEM: how would you solve two sum\nYOU: let me think")
    expect(result.turns).toEqual([
      { speaker: "them", text: "how would you solve two sum" },
      { speaker: "you", text: "let me think" }
    ])
    expect(result.text).toBe("Use a hash map.")
    const userText = sent().messages[0].content[0].text
    expect(userText).toContain("THEM lines are the other people")
    expect(userText).toContain("THEM: how would you solve two sum")
  })

  it("uses the renderer's pre-cut chunks for long clips, in order", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sarvam-key")
    stubSarvam()
    send.mockResolvedValue(reply("answer"))

    const result = await helper().analyzeAudioFromBase64(
      b64("ignored webm"),
      "audio/webm",
      [],
      undefined,
      {
        mic: [
          { data: b64("part one"), mimeType: "audio/wav" },
          { data: b64("part two"), mimeType: "audio/wav" }
        ]
      }
    )

    expect(result.transcript).toBe("YOU: part one\nYOU: part two")
  })

  it("skips the model call when nothing was said", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sarvam-key")
    stubSarvam()

    const result = await helper().analyzeAudioFromBase64("", "audio/webm")

    expect(send).not.toHaveBeenCalled()
    expect(result.transcript).toBe("")
    expect(result.turns).toEqual([])
  })

  it("names the missing keys instead of failing obscurely", async () => {
    vi.stubEnv("SARVAM_API_KEY", "")
    vi.stubEnv("GROQ_API_KEY", "")
    await expect(
      helper().analyzeAudioFromBase64(b64("hi"), "audio/webm")
    ).rejects.toThrow(/SARVAM_API_KEY or GROQ_API_KEY/)
  })

  it("uses Groq Whisper when STT_PROVIDER asks for it", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sarvam-key")
    vi.stubEnv("GROQ_API_KEY", "groq-key")
    vi.stubEnv("STT_PROVIDER", "groq")
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const file = init.body.get("file") as Blob
      return new Response(JSON.stringify({ text: await file.text() }))
    })
    vi.stubGlobal("fetch", fetchMock)
    send.mockResolvedValue(reply("answer"))

    const llm = helper()
    const result = await llm.analyzeAudioFromBase64(b64("two sum?"), "audio/webm")

    expect(llm.getCurrentStt()).toBe("groq")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.groq.com/openai/v1/audio/transcriptions"
    )
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers).toEqual({ Authorization: "Bearer groq-key" })
    expect(init.body.get("model")).toBe("whisper-large-v3-turbo")
    expect((init.body.get("file") as File).name).toBe("clip.webm")
    expect(result.transcript).toBe("YOU: two sum?")
  })

  it("switches transcription backend from Settings without re-entering keys", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sarvam-key")
    vi.stubEnv("GROQ_API_KEY", "groq-key")
    const llm = helper()
    expect(llm.getCurrentStt()).toBe("sarvam")

    await llm.switchToBedrock({ sttProvider: "groq" })
    expect(llm.getCurrentStt()).toBe("groq")
    await llm.switchToBedrock({ sttProvider: "sarvam" })
    expect(llm.getCurrentStt()).toBe("sarvam")
  })
})

describe("labelledTranscript", () => {
  it("interleaves by window, THEM first within a window", () => {
    expect(labelledTranscript(["y1", "", "y3"], ["t1", "t2"])).toBe(
      "THEM: t1\nYOU: y1\nTHEM: t2\nYOU: y3"
    )
    expect(labelledTranscript([""], [])).toBe("")
  })
})

describe("Bedrock voice streaming", () => {
  it("announces Sarvam's transcript, then streams Claude's answer", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sarvam-key")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: any) => {
        const file = init.body.get("file") as Blob
        return new Response(JSON.stringify({ transcript: await file.text() }))
      })
    )
    send.mockResolvedValue(streamOf(["Hash ", "map."]))
    const events: string[] = []

    const text = await helper().analyzeAudioStream(
      Buffer.from("explain two sum").toString("base64"),
      "audio/webm",
      (transcript) => events.push(`T:${transcript}`),
      (delta) => events.push(`A:${delta}`)
    )

    expect(events).toEqual(["T:YOU: explain two sum", "A:Hash ", "A:map."])
    expect(text).toBe("Hash map.")
    expect(send.mock.calls[0][0].kind).toBe("stream")
  })

  it("streams the no-speech reply without calling Claude", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sarvam-key")
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ transcript: "" }))))
    const events: string[] = []

    await helper().analyzeAudioStream(
      "",
      "audio/webm",
      (transcript) => events.push(`T:${transcript}`),
      (delta) => events.push(`A:${delta}`)
    )

    expect(send).not.toHaveBeenCalled()
    expect(events).toEqual(["T:", "A:No speech was picked up in that clip."])
  })
})

describe("Bedrock temperature fallback", () => {
  it("drops temperature when the model refuses it, and keeps it dropped", async () => {
    send
      .mockRejectedValueOnce(
        new Error("The model returned the following errors: `temperature` is deprecated for this model.")
      )
      .mockResolvedValueOnce(streamOf(["ok"]))
      .mockResolvedValueOnce(reply("again"))
    const llm = helper()

    await expect(llm.chatWithGeminiStream("q", () => {})).resolves.toBe("ok")
    await expect(llm.chatWithGemini("q2")).resolves.toBe("again")

    expect(sent(0).inferenceConfig).toEqual({ temperature: 0.25, maxTokens: 2048 })
    expect(sent(1).inferenceConfig).toEqual({ maxTokens: 2048 })
    expect(sent(2).inferenceConfig).toEqual({ maxTokens: 2048 })
  })

  it("does not retry other errors", async () => {
    send.mockRejectedValueOnce(new Error("AccessDeniedException: no access to model"))
    await expect(helper().chatWithGemini("q")).rejects.toThrow(/AccessDenied/)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe("Bedrock model routes", () => {
  const ROUTES = {
    tasks: {
      chat: ["chat-a", "chat-b"],
      screenshot: ["vision-a", "vision-b"],
      autopilot: ["click-a", "click-b"]
    }
  }
  const routed = (routes: any = ROUTES) =>
    new LLMHelper(undefined, false, undefined, undefined, BEDROCK, routes)
  const png = () =>
    sharp({ create: { width: 64, height: 64, channels: 3, background: "#245" } }).png().toBuffer()

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("sends each task to its own model, and the env model to unlisted ones", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sarvam-key")
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ transcript: "two sum?" }))))
    send.mockImplementation(async (command: any) =>
      command.kind === "stream" ? streamOf(["ok"]) : reply("ok")
    )
    const llm = routed()

    await llm.chatWithGeminiStream("q", () => {})
    await llm.chatWithImageStream("what is this?", [await png()], () => {})
    await llm.chatWithImage("and this?", [await png()])
    await llm.analyzeAudioStream("aGk=", "audio/webm", () => {}, () => {})

    expect([0, 1, 2, 3].map((n) => sent(n).modelId)).toEqual([
      "chat-a",
      "vision-a",
      "vision-a",
      "claude-test"
    ])
    expect(llm.getCurrentModel()).toBe("chat-a")
  })

  it("moves to the next model when one fails before any text", async () => {
    send
      .mockRejectedValueOnce(new Error("ThrottlingException: Too many requests"))
      .mockResolvedValueOnce(streamOf(["ok"]))
    const chunks: string[] = []

    await expect(routed().chatWithGeminiStream("q", (d) => chunks.push(d))).resolves.toBe("ok")

    expect(sent(0).modelId).toBe("chat-a")
    expect(sent(1).modelId).toBe("chat-b")
    expect(chunks).toEqual(["ok"])
  })

  it("never switches model once the answer has started", async () => {
    send.mockResolvedValueOnce({
      stream: (async function* () {
        yield { contentBlockDelta: { delta: { text: "half an " } } }
        throw new Error("ModelStreamErrorException: connection reset")
      })()
    })
    const chunks: string[] = []

    await expect(
      routed().chatWithImageStream("q", [await png()], (d) => chunks.push(d))
    ).rejects.toThrow(/connection reset/)

    expect(send).toHaveBeenCalledTimes(1)
    expect(chunks).toEqual(["half an "])
  })

  it("throws the last model's error when every model fails", async () => {
    send
      .mockRejectedValueOnce(new Error("AccessDeniedException: chat-a"))
      .mockRejectedValueOnce(new Error("AccessDeniedException: chat-b"))

    await expect(routed().chatWithGemini("q")).rejects.toThrow("AccessDeniedException: chat-b")
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("moves autopilot on when a reply isn't JSON Quip can use", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "quip-routes-"))
    try {
      const file = path.join(dir, "shot.png")
      await fs.promises.writeFile(file, await png())
      send.mockResolvedValueOnce(reply("Sure! I'll click Continue for you.")).mockResolvedValueOnce(
        reply(
          JSON.stringify({
            state: "step",
            instruction: "Click Continue",
            action: "click",
            risk: "safe",
            target: { x: 20, y: 20, width: 10, height: 10 }
          })
        )
      )

      const step = await routed().generateTeachingStep("goal", [], file, { width: 64, height: 64 })

      expect(step.state).toBe("step")
      expect(sent(0).modelId).toBe("click-a")
      expect(sent(1).modelId).toBe("click-b")
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  it("makes a model picked in Settings every task's default, keeping the fallbacks", async () => {
    send.mockImplementation(async () => streamOf(["ok"]))
    const llm = routed()

    // Saving Settings sends the model it shows back; that must not reroute anything.
    await llm.switchToBedrock({ modelId: "chat-a" })
    await llm.chatWithImageStream("q", [await png()], () => {})
    expect(sent(0).modelId).toBe("vision-a")

    await llm.switchToBedrock({ modelId: "picked" })
    expect(llm.getCurrentModel()).toBe("picked")
    await llm.chatWithImageStream("q", [await png()], () => {})
    expect(sent(1).modelId).toBe("picked")

    send.mockRejectedValueOnce(new Error("ThrottlingException"))
    await llm.chatWithImageStream("q", [await png()], () => {})
    expect(sent(3).modelId).toBe("vision-a")
  })

  it("falls back to the next transcription service", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sarvam-key")
    vi.stubEnv("GROQ_API_KEY", "groq-key")
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("groq")
        ? new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 })
        : new Response(JSON.stringify({ transcript: "two sum?" }))
    )
    vi.stubGlobal("fetch", fetchMock)
    send.mockResolvedValue(reply("answer"))

    const llm = routed({ ...ROUTES, stt: ["groq", "sarvam"] })
    const result = await llm.analyzeAudioFromBase64("aGk=", "audio/webm")

    expect(llm.getCurrentStt()).toBe("groq")
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "https://api.groq.com/openai/v1/audio/transcriptions",
      "https://api.sarvam.ai/speech-to-text"
    ])
    expect(result.transcript).toBe("YOU: two sum?")
  })
})

describe("createSpeechToText", () => {
  it("honours the requested backend only when its key exists", () => {
    expect(createSpeechToText({ provider: "groq", sarvamApiKey: "s", groqApiKey: "g" })?.provider).toBe("groq")
    expect(createSpeechToText({ provider: "groq", sarvamApiKey: "s" })?.provider).toBe("sarvam")
    expect(createSpeechToText({ sarvamApiKey: "s", groqApiKey: "g" })?.provider).toBe("sarvam")
    expect(createSpeechToText({ groqApiKey: "g" })?.provider).toBe("groq")
    expect(createSpeechToText({})).toBeNull()
  })
})

describe("bedrockApiKeyFromEnv", () => {
  it("prefers AWS's own name and accepts BEDROCK_TOKEN", () => {
    vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", "")
    vi.stubEnv("BEDROCK_TOKEN", "short-name")
    expect(bedrockApiKeyFromEnv()).toBe("short-name")
    vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", "aws-name")
    expect(bedrockApiKeyFromEnv()).toBe("aws-name")
  })
})
