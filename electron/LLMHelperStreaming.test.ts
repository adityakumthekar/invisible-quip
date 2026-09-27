import { beforeEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"

const generateContentStream = vi.fn()
const generateContent = vi.fn()

vi.mock("./geminiAdapter", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContentStream, generateContent }
    }
  }
}))

import { LLMHelper } from "./LLMHelper"

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

/**
 * Retina-sized and noisy. A flat colour would compress to almost nothing and
 * make the size assertion below meaningless — real screenshots are detailed.
 */
async function bigPng() {
  return sharp({
    create: {
      width: 3024,
      height: 1964,
      channels: 3,
      background: { r: 40, g: 90, b: 200 },
      noise: { type: "gaussian", mean: 128, sigma: 60 }
    }
  })
    .png()
    .toBuffer()
}

function helper() {
  return new LLMHelper("test-key")
}

beforeEach(() => {
  generateContentStream.mockReset()
  generateContent.mockReset()
})

describe("LLMHelper streaming", () => {
  it("forwards each delta and returns the concatenation", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["Hel", "lo ", "there"]))
    const seen: string[] = []

    const text = await helper().chatWithGeminiStream("hi", (d) => seen.push(d))

    expect(seen).toEqual(["Hel", "lo ", "there"])
    expect(text).toBe("Hello there")
  })

  it("stops forwarding once the request is aborted", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["a", "b", "c"]))
    const controller = new AbortController()
    const seen: string[] = []

    const text = await helper().chatWithGeminiStream(
      "hi",
      (delta) => {
        seen.push(delta)
        controller.abort()
      },
      controller.signal
    )

    expect(seen).toEqual(["a"])
    expect(text).toBe("a")
  })

  it("sends prior turns before the new message", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    await helper().chatWithGeminiStream(
      "now in TypeScript",
      () => {},
      undefined,
      [
        { role: "user", text: "write an LRU cache in python" },
        { role: "assistant", text: "class LRUCache: ..." }
      ]
    )

    const { contents } = generateContentStream.mock.calls[0][0]
    expect(contents).toHaveLength(3)
    expect(contents[0]).toEqual({
      role: "user",
      parts: [{ text: "write an LRU cache in python" }]
    })
    expect(contents[1].role).toBe("model")
    expect(contents[2].parts[0].text).toContain("now in TypeScript")
  })

  it("sends only the new message when there is no history", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    await helper().chatWithGeminiStream("hi", () => {})
    expect(generateContentStream.mock.calls[0][0].contents).toHaveLength(1)
  })

  it("caps chat output rather than leaving it at the model default", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["ok"]))
    await helper().chatWithGeminiStream("hi", () => {})

    const request = generateContentStream.mock.calls[0][0]
    expect(request.generationConfig.maxOutputTokens).toBe(2048)
  })
})

describe("LLMHelper chat image encoding", () => {
  it("downscales a retina capture and sends it as JPEG", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["seen"]))
    const png = await bigPng()

    await helper().chatWithImageStream("what is this", [png], () => {})

    const parts = generateContentStream.mock.calls[0][0].contents[0].parts
    const image = parts.find((p: any) => p.inlineData)
    expect(image.inlineData.mimeType).toBe("image/jpeg")

    const meta = await sharp(Buffer.from(image.inlineData.data, "base64")).metadata()
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1568)
    // The whole point: a fraction of the bytes the raw PNG would have cost.
    expect(image.inlineData.data.length).toBeLessThan(png.length / 4)
  })

  it("leaves an image alone when it is already small enough", async () => {
    generateContentStream.mockReturnValueOnce(fakeStream(["seen"]))
    const small = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 0, g: 0, b: 0 }
      }
    })
      .png()
      .toBuffer()

    await helper().chatWithImageStream("hi", [small], () => {})

    const parts = generateContentStream.mock.calls[0][0].contents[0].parts
    const image = parts.find((p: any) => p.inlineData)
    const meta = await sharp(Buffer.from(image.inlineData.data, "base64")).metadata()
    expect(meta.width).toBe(400)
    expect(meta.height).toBe(300)
  })
})
