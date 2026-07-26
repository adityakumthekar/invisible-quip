import { describe, expect, it, vi } from "vitest"
import {
  PRIVACY_ACKNOWLEDGEMENT_TEXT,
  PRIVACY_ACKNOWLEDGEMENT_VERSION
} from "./privacyContract"
import {
  isAcknowledgementCurrent,
  parsePrivacyAcknowledgementRecord,
  PrivacyAcknowledgementStore
} from "./privacyAcknowledgement"

describe("privacy acknowledgement copy", () => {
  it("uses the exact required disclosure text", () => {
    expect(PRIVACY_ACKNOWLEDGEMENT_TEXT).toBe(
      "Quip uses capture protection and is normally hidden from Zoom/Meet/Teams-style sharing, but exclusion is best-effort and the user must verify the share preview."
    )
    expect(PRIVACY_ACKNOWLEDGEMENT_TEXT).not.toMatch(/always|guarantee|100%|completely invisible|universal/i)
  })
})

describe("parsePrivacyAcknowledgementRecord", () => {
  it("parses a valid record", () => {
    expect(
      parsePrivacyAcknowledgementRecord(
        JSON.stringify({ version: 1, acknowledgedAt: "2026-01-01T00:00:00.000Z" })
      )
    ).toEqual({ version: 1, acknowledgedAt: "2026-01-01T00:00:00.000Z" })
  })

  it("rejects malformed JSON", () => {
    expect(parsePrivacyAcknowledgementRecord("not json")).toBeNull()
  })

  it("rejects records missing required fields", () => {
    expect(parsePrivacyAcknowledgementRecord(JSON.stringify({}))).toBeNull()
    expect(
      parsePrivacyAcknowledgementRecord(JSON.stringify({ version: 1 }))
    ).toBeNull()
    expect(
      parsePrivacyAcknowledgementRecord(
        JSON.stringify({ version: "1", acknowledgedAt: "x" })
      )
    ).toBeNull()
  })
})

describe("isAcknowledgementCurrent", () => {
  it("is false for null records", () => {
    expect(isAcknowledgementCurrent(null)).toBe(false)
  })

  it("is true only when the version matches the current disclosure version", () => {
    expect(
      isAcknowledgementCurrent({
        version: PRIVACY_ACKNOWLEDGEMENT_VERSION,
        acknowledgedAt: "2026-01-01T00:00:00.000Z"
      })
    ).toBe(true)
    expect(
      isAcknowledgementCurrent({
        version: PRIVACY_ACKNOWLEDGEMENT_VERSION - 1,
        acknowledgedAt: "2026-01-01T00:00:00.000Z"
      })
    ).toBe(false)
  })
})

describe("PrivacyAcknowledgementStore", () => {
  function makeStore(initialFile?: string) {
    const files = new Map<string, string>()
    if (initialFile !== undefined) {
      files.set("/tmp/ack.json", initialFile)
    }
    const readFile = vi.fn(async (path: string) => {
      if (!files.has(path)) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }
      return files.get(path)!
    })
    const writeFile = vi.fn(async (path: string, contents: string) => {
      files.set(path, contents)
    })
    const now = vi.fn(() => new Date("2026-07-23T12:00:00.000Z"))
    const store = new PrivacyAcknowledgementStore("/tmp/ack.json", {
      readFile,
      writeFile,
      now
    })
    return { store, files, readFile, writeFile, now }
  }

  it("is not acknowledged when no file exists yet", async () => {
    const { store } = makeStore()
    expect(await store.isAcknowledged()).toBe(false)
  })

  it("is not acknowledged when the persisted version is stale", async () => {
    const { store } = makeStore(
      JSON.stringify({ version: 0, acknowledgedAt: "2020-01-01T00:00:00.000Z" })
    )
    expect(await store.isAcknowledged()).toBe(false)
  })

  it("is not acknowledged when the file contents are corrupt", async () => {
    const { store } = makeStore("{not valid json")
    expect(await store.isAcknowledged()).toBe(false)
  })

  it("persists a versioned, timestamped acknowledgement and reports it as acknowledged", async () => {
    const { store, writeFile } = makeStore()

    const record = await store.acknowledge()

    expect(record).toEqual({
      version: PRIVACY_ACKNOWLEDGEMENT_VERSION,
      acknowledgedAt: "2026-07-23T12:00:00.000Z"
    })
    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/ack.json",
      JSON.stringify(record)
    )
    expect(await store.isAcknowledged()).toBe(true)
  })
})
