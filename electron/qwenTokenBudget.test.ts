// qwenTokenBudget.test.ts
//
// The Qwen/vLLM paths used to send output-token caps sized for Gemini without
// ever asking the server what it could serve. Against a server started with
// `--max-model-len 4096` that produced, at teaching step 0:
//
//   400 Bad Request — max_tokens=8192 cannot be greater than
//   max_model_len=max_total_tokens=4096
//
// and, on the chat-with-screenshot path, a context-length rejection instead
// (2048 requested output + ~2036 image tokens > 4096 before any prose).
//
// These tests drive a fake vLLM: /v1/models advertises the limit, and every
// /v1/chat/completions body is captured so we can assert what we actually sent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import sharp from "sharp"

import { LLMHelper } from "./LLMHelper"

const BASE_URL = "http://vllm.test:8000/v1"
const MODEL = "Qwen/Qwen3-VL-4B-Instruct"
const MAX_MODEL_LEN = 4096

/** Bodies POSTed to /chat/completions, in order. */
let sentBodies: any[] = []
let modelsResponse: unknown

function qwenHelper() {
  return new LLMHelper(undefined, false, undefined, undefined, true, BASE_URL, MODEL)
}

/** A teaching reply the contract parser accepts, targeted inside any image. */
function teachingReply() {
  return JSON.stringify({
    state: "step",
    instruction: "Click the Compose button.",
    action: "click",
    risk: "safe",
    target: { x: 10, y: 20, width: 40, height: 20 }
  })
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  })
}

function stubFetch(chatContent: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const href = String(url)

      if (href.endsWith("/models")) {
        return jsonResponse(modelsResponse)
      }

      if (href.endsWith("/chat/completions")) {
        sentBodies.push(JSON.parse(init.body))
        return jsonResponse({
          choices: [{ message: { content: chatContent } }]
        })
      }

      throw new Error(`unexpected fetch: ${href}`)
    })
  )
}

/** A real retina-sized PNG on disk — the teaching path resizes with sharp. */
async function screenshotFile() {
  const file = path.join(
    await fs.promises.mkdtemp(path.join(os.tmpdir(), "quip-budget-")),
    "screen.png"
  )
  await sharp({
    create: {
      width: 3024,
      height: 1964,
      channels: 3,
      background: { r: 30, g: 30, b: 30 }
    }
  })
    .png()
    .toFile(file)
  return file
}

beforeEach(() => {
  sentBodies = []
  modelsResponse = {
    object: "list",
    data: [{ id: MODEL, object: "model", max_model_len: MAX_MODEL_LEN }]
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Qwen requests fit the server's context window", () => {
  it("never asks for more output tokens than the whole context", async () => {
    stubFetch(teachingReply())
    const file = await screenshotFile()

    await qwenHelper().generateTeachingStep("Send an invite", [], file, {
      width: 3024,
      height: 1964
    })

    // The reported bug in one line: 8192 > 4096 is an instant 400.
    expect(sentBodies[0].max_tokens).toBeLessThanOrEqual(MAX_MODEL_LEN)
  })

  it("leaves room for the screenshot and prompt, not just the cap", async () => {
    stubFetch(teachingReply())
    const file = await screenshotFile()

    await qwenHelper().generateTeachingStep("Send an invite", [], file, {
      width: 3024,
      height: 1964
    })

    // A 1.5M-pixel capture costs ~1900 visual tokens at 28x28 px per token,
    // and the prompt template is ~800 more. Asking for the full 4096 of output
    // would overflow the context even though it passes the naive check above.
    expect(sentBodies[0].max_tokens).toBeLessThan(MAX_MODEL_LEN - 2000)
    // Still enough for the JSON contract, which runs ~200 tokens.
    expect(sentBodies[0].max_tokens).toBeGreaterThanOrEqual(256)
  })

  it("keeps the chat-with-screenshot path under the ceiling too", async () => {
    stubFetch("Looks like a mail client.")

    await qwenHelper().analyzeImageFile(await screenshotFile())

    // This path was never rejected outright — 2048 is legal against a 4096
    // window — so the budget should not shrink replies for no reason. Asserted
    // as a range rather than an exact number: the prompt carries the persona
    // and response contract, so its exact size is not this test's business.
    expect(sentBodies[0].max_tokens).toBeLessThanOrEqual(2048)
    expect(sentBodies[0].max_tokens).toBeGreaterThan(1500)
    expect(sentBodies[0].max_tokens).toBeLessThan(MAX_MODEL_LEN)
  })

  it("keeps the requested cap when the server does not advertise a limit", async () => {
    modelsResponse = { object: "list", data: [{ id: MODEL, object: "model" }] }
    stubFetch("hello")

    await qwenHelper().chatWithGemini("hi")

    // No limit to budget against: send what the caller asked for rather than
    // inventing a cap that might truncate a long answer.
    expect(sentBodies[0].max_tokens).toBe(2048)
  })

  it("still sends a usable request when the prompt fills the context", async () => {
    stubFetch("Both look the same.")
    const file = await screenshotFile()

    // Two screenshots cost ~3200 tokens between them, leaving little room. The
    // live server serves this fine — it does not check prompt+output against
    // the window — so we must clamp rather than refuse.
    const reply = await qwenHelper().chatWithImage("compare these", [file, file])

    expect(reply).toBe("Both look the same.")
    expect(sentBodies[0].max_tokens).toBeGreaterThanOrEqual(256)
    expect(sentBodies[0].max_tokens).toBeLessThan(MAX_MODEL_LEN)
  })

  it("asks the server for its limit only once per model", async () => {
    stubFetch("hi")
    const helper = qwenHelper()

    await helper.chatWithGemini("one")
    await helper.chatWithGemini("two")

    const modelsCalls = (fetch as any).mock.calls.filter((c: any[]) =>
      String(c[0]).endsWith("/models")
    )
    expect(modelsCalls).toHaveLength(1)
  })
})
