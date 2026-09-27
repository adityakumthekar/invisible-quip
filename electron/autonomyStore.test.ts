import { describe, expect, it, vi } from "vitest"
import {
  AUTONOMY_RECORD_VERSION,
  AutonomyStore,
  parseAutonomyRecord
} from "./autonomyStore"

const validRaw = JSON.stringify({
  version: AUTONOMY_RECORD_VERSION,
  level: "handsoff",
  updatedAt: "2026-01-01T00:00:00.000Z"
})

describe("parseAutonomyRecord", () => {
  it("parses a valid record", () => {
    expect(parseAutonomyRecord(validRaw)).toEqual({
      version: AUTONOMY_RECORD_VERSION,
      level: "handsoff",
      updatedAt: "2026-01-01T00:00:00.000Z"
    })
  })

  it("rejects malformed JSON, wrong versions, and unknown levels", () => {
    expect(parseAutonomyRecord("not json")).toBeNull()
    expect(parseAutonomyRecord(JSON.stringify({}))).toBeNull()
    expect(
      parseAutonomyRecord(
        JSON.stringify({ version: 99, level: "guarded", updatedAt: "x" })
      )
    ).toBeNull()
    expect(
      parseAutonomyRecord(
        JSON.stringify({
          version: AUTONOMY_RECORD_VERSION,
          level: "yolo",
          updatedAt: "x"
        })
      )
    ).toBeNull()
  })
})

describe("AutonomyStore", () => {
  const makeStore = (readFile: () => Promise<string>) => {
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const store = new AutonomyStore("/tmp/autonomy.json", {
      readFile,
      writeFile,
      now: () => new Date("2026-01-01T00:00:00.000Z")
    })
    return { store, writeFile }
  }

  it("reports the default before anything is loaded", () => {
    const { store } = makeStore(async () => validRaw)
    expect(store.getLevel()).toBe("balanced")
  })

  it("loads a stored level and caches it for synchronous reads", async () => {
    const { store } = makeStore(async () => validRaw)
    expect(await store.load()).toBe("handsoff")
    expect(store.getLevel()).toBe("handsoff")
  })

  it("falls back to the default on a missing or corrupt file", async () => {
    const missing = makeStore(async () => {
      throw new Error("ENOENT")
    })
    expect(await missing.store.load()).toBe("balanced")

    const corrupt = makeStore(async () => "{{{")
    expect(await corrupt.store.load()).toBe("balanced")
  })

  it("writes and caches a new level", async () => {
    const { store, writeFile } = makeStore(async () => validRaw)
    const record = await store.setLevel("guarded")

    expect(record.level).toBe("guarded")
    expect(store.getLevel()).toBe("guarded")
    expect(JSON.parse(writeFile.mock.calls[0][1])).toEqual({
      version: AUTONOMY_RECORD_VERSION,
      level: "guarded",
      updatedAt: "2026-01-01T00:00:00.000Z"
    })
  })
})
