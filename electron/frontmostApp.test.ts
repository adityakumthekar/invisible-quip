import { describe, expect, it, vi } from "vitest"
import {
  createFrontmostAppProbe,
  isFrontmostAppProbeSupported,
  parseFrontmostAppOutput
} from "./frontmostApp"

describe("parseFrontmostAppOutput", () => {
  it("parses the AppleScript list osascript prints", () => {
    expect(parseFrontmostAppOutput("com.apple.Terminal, Terminal\n")).toEqual({
      bundleId: "com.apple.Terminal",
      name: "Terminal"
    })
  })

  it("keeps commas inside the app name", () => {
    expect(
      parseFrontmostAppOutput("com.example.app, Notes, Lists & Things")
    ).toEqual({ bundleId: "com.example.app", name: "Notes, Lists & Things" })
  })

  it("returns null for output it can't read", () => {
    for (const raw of ["", "   ", "Terminal", "com.apple.Terminal,", ", Terminal"]) {
      expect(parseFrontmostAppOutput(raw)).toBeNull()
    }
  })
})

describe("createFrontmostAppProbe", () => {
  it("returns the parsed app", async () => {
    const probe = createFrontmostAppProbe(
      async () => "com.tinyspeck.slackmacgap, Slack",
      { supported: true }
    )

    await expect(probe()).resolves.toEqual({
      bundleId: "com.tinyspeck.slackmacgap",
      name: "Slack"
    })
  })

  it("returns null instead of throwing when the command fails", async () => {
    const probe = createFrontmostAppProbe(
      async () => {
        throw new Error("not authorized to send Apple events")
      },
      { supported: true }
    )

    await expect(probe()).resolves.toBeNull()
  })

  it("never shells out on an unsupported platform", async () => {
    const run = vi.fn(async () => "com.apple.Terminal, Terminal")
    const probe = createFrontmostAppProbe(run, { supported: false })

    await expect(probe()).resolves.toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it("serves a repeat call from cache, and bypasses it when asked for fresh", async () => {
    let answer = "com.apple.Notes, Notes"
    const run = vi.fn(async () => answer)
    let clock = 1000
    const probe = createFrontmostAppProbe(run, {
      supported: true,
      cacheMs: 500,
      now: () => clock
    })

    await probe()
    answer = "com.apple.Terminal, Terminal"

    clock = 1100
    await expect(probe()).resolves.toEqual({
      bundleId: "com.apple.Notes",
      name: "Notes"
    })
    expect(run).toHaveBeenCalledTimes(1)

    await expect(probe(true)).resolves.toEqual({
      bundleId: "com.apple.Terminal",
      name: "Terminal"
    })
    expect(run).toHaveBeenCalledTimes(2)

    clock = 2000
    await probe()
    expect(run).toHaveBeenCalledTimes(3)
  })
})

describe("isFrontmostAppProbeSupported", () => {
  it("is macOS only", () => {
    expect(isFrontmostAppProbeSupported("darwin")).toBe(true)
    expect(isFrontmostAppProbeSupported("win32")).toBe(false)
    expect(isFrontmostAppProbeSupported("linux")).toBe(false)
  })
})
