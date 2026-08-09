import { describe, expect, it, vi } from "vitest"
import {
  LLM_SETTINGS_VERSION,
  LlmSettingsStore,
  parseLlmSettings
} from "./llmSettingsStore"

const stored = {
  version: LLM_SETTINGS_VERSION,
  provider: "qwen",
  qwen: {
    baseUrl: "http://10.0.0.4:8765/v1",
    model: "qwen3-vl",
    apiKey: "EMPTY"
  }
}

describe("parseLlmSettings", () => {
  it("parses a stored record", () => {
    expect(parseLlmSettings(JSON.stringify(stored))).toEqual(stored)
  })

  it("degrades to null rather than throwing, so startup falls back to env", () => {
    expect(parseLlmSettings("not json")).toBeNull()
    expect(parseLlmSettings(JSON.stringify({}))).toBeNull()
    expect(
      parseLlmSettings(
        JSON.stringify({ version: 99, provider: "qwen" })
      )
    ).toBeNull()
    expect(
      parseLlmSettings(
        JSON.stringify({ version: LLM_SETTINGS_VERSION, provider: "openai" })
      )
    ).toBeNull()
  })

  it("drops blank and non-string details instead of storing them", () => {
    const parsed = parseLlmSettings(
      JSON.stringify({
        version: LLM_SETTINGS_VERSION,
        provider: "gemini",
        qwen: { baseUrl: "   ", model: 42 },
        gemini: { apiKey: "abc" }
      })
    )
    expect(parsed).toEqual({
      version: LLM_SETTINGS_VERSION,
      provider: "gemini",
      gemini: { apiKey: "abc" }
    })
  })
})

describe("LlmSettingsStore", () => {
  const makeStore = (readFile: () => Promise<string>) => {
    const writeFile = vi.fn().mockResolvedValue(undefined)
    return {
      store: new LlmSettingsStore("/tmp/llm-settings.json", {
        readFile,
        writeFile
      }),
      writeFile
    }
  }

  it("returns null when the file is missing", async () => {
    const { store } = makeStore(async () => {
      throw new Error("ENOENT")
    })
    expect(await store.read()).toBeNull()
  })

  it("round-trips a saved provider", async () => {
    const { store, writeFile } = makeStore(async () => {
      throw new Error("ENOENT")
    })
    await store.save("qwen", { qwen: { baseUrl: "http://x/v1", model: "m" } })

    const written = JSON.parse(writeFile.mock.calls[0][1])
    expect(written.provider).toBe("qwen")
    expect(written.qwen).toEqual({ baseUrl: "http://x/v1", model: "m" })
  })

  it("keeps the other provider's details when switching away", async () => {
    const { store, writeFile } = makeStore(async () => JSON.stringify(stored))
    await store.save("gemini", { gemini: { apiKey: "key" } })

    const written = JSON.parse(writeFile.mock.calls[0][1])
    expect(written.provider).toBe("gemini")
    // The vLLM URL the user typed survives the round trip.
    expect(written.qwen.baseUrl).toBe("http://10.0.0.4:8765/v1")
  })
})
