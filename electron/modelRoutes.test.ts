import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"

import {
  loadModelRoutes,
  MODEL_ROUTES_FILE,
  modelRoutesPath,
  parseModelRoutes
} from "./modelRoutes"
import { withFallback } from "./fallback"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("parseModelRoutes", () => {
  it("reads tasks, region and speech-to-text order, ignoring _ notes", () => {
    expect(
      parseModelRoutes({
        _about: "anything",
        region: "ap-south-1",
        tasks: { chat: ["a", "b"], screenshot: ["c"] },
        stt: ["groq", "sarvam"]
      })
    ).toEqual({
      region: "ap-south-1",
      tasks: { chat: ["a", "b"], screenshot: ["c"] },
      stt: ["groq", "sarvam"]
    })
  })

  it("names the file and the field it can't use", () => {
    expect(() => parseModelRoutes({ tasks: { screenshots: ["a"] } })).toThrow(
      `${MODEL_ROUTES_FILE}: unknown task "screenshots" (expected voice, chat, screenshot or autopilot)`
    )
    expect(() => parseModelRoutes({ tasks: { chat: [] } })).toThrow(
      /tasks\.chat must be a non-empty list of model IDs/
    )
    expect(() => parseModelRoutes({ tasks: { chat: ["a", ""] } })).toThrow(/tasks\.chat/)
    expect(() => parseModelRoutes({ tasks: {}, stt: ["whisper"] })).toThrow(
      /stt must list "groq" and\/or "sarvam"/
    )
    expect(() => parseModelRoutes({ tasks: {}, regoin: "x" })).toThrow(/unknown setting "regoin"/)
    expect(() => parseModelRoutes([])).toThrow(/must be a JSON object/)
  })

  it("accepts the file the app ships with", () => {
    const shipped = path.join(__dirname, "..", MODEL_ROUTES_FILE)
    const routes = parseModelRoutes(JSON.parse(fs.readFileSync(shipped, "utf8")))
    expect(Object.keys(routes.tasks).sort()).toEqual(["autopilot", "chat", "screenshot", "voice"])
  })
})

describe("loadModelRoutes", () => {
  it("returns null when there is no file, and names a broken one", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "quip-routes-"))
    try {
      const file = path.join(dir, MODEL_ROUTES_FILE)
      expect(loadModelRoutes(file)).toBeNull()
      await fs.promises.writeFile(file, "{ tasks: ")
      expect(() => loadModelRoutes(file)).toThrow(`${file} is not valid JSON`)
      await fs.promises.writeFile(file, JSON.stringify({ tasks: { voice: ["v"] } }))
      expect(loadModelRoutes(file)).toEqual({ tasks: { voice: ["v"] } })
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("modelRoutesPath", () => {
  it("sits beside .env: the project root in dev, Resources when packaged", () => {
    expect(modelRoutesPath(false, "/res", {})).toBe(path.resolve(MODEL_ROUTES_FILE))
    expect(modelRoutesPath(true, "/res", {})).toBe(path.join("/res", MODEL_ROUTES_FILE))
    expect(modelRoutesPath(true, "/res", { QUIP_MODELS_CONFIG: "/x/models.json" })).toBe("/x/models.json")
  })
})

describe("withFallback", () => {
  it("tries each option in order until one works", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const tried: string[] = []
    const result = await withFallback(["a", "b", "c"], async (id) => {
      tried.push(id)
      if (id !== "c") throw new Error(`${id} down`)
      return id
    }, { label: "chat" })
    expect(result).toBe("c")
    expect(tried).toEqual(["a", "b", "c"])
  })

  it("stops when the error rules out a retry, and throws the last error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const run = vi.fn(async (id: string) => {
      throw new Error(`${id} down`)
    })
    await expect(
      withFallback(["a", "b"], run, { label: "chat", canFallBack: () => false })
    ).rejects.toThrow("a down")
    expect(run).toHaveBeenCalledTimes(1)

    await expect(withFallback(["a", "b"], run, { label: "chat" })).rejects.toThrow("b down")
    await expect(withFallback([], run, { label: "chat" })).rejects.toThrow(/No model configured for chat/)
  })
})
