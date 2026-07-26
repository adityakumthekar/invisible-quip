import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let userDataDir: string

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name !== "userData") throw new Error(`unexpected getPath(${name})`)
      return userDataDir
    }
  },
  desktopCapturer: { getSources: vi.fn() },
  screen: {
    getCursorScreenPoint: vi.fn(),
    getDisplayNearestPoint: vi.fn(),
    getAllDisplays: vi.fn(() => [])
  },
  systemPreferences: { getMediaAccessStatus: vi.fn(() => "granted") }
}))

import { ScreenshotHelper } from "./ScreenshotHelper"

describe("ScreenshotHelper.deleteAllScreenshotFiles", () => {
  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "quip-screenshot-test-"))
  })

  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  })

  it("wipes tracked queue files and untracked orphan files from both directories", async () => {
    const helper = new ScreenshotHelper("queue")

    const screenshotDir = path.join(userDataDir, "screenshots")
    const extraDir = path.join(userDataDir, "extra_screenshots")

    // A file the instance doesn't know about, mimicking a leftover from a
    // previous session (its in-memory queue would have started empty).
    const orphanPath = path.join(screenshotDir, "orphan-from-last-run.png")
    fs.writeFileSync(orphanPath, "orphan")

    const extraOrphanPath = path.join(extraDir, "extra-orphan.png")
    fs.writeFileSync(extraOrphanPath, "extra orphan")

    expect(fs.readdirSync(screenshotDir)).toHaveLength(1)
    expect(fs.readdirSync(extraDir)).toHaveLength(1)

    await helper.deleteAllScreenshotFiles()

    expect(fs.readdirSync(screenshotDir)).toHaveLength(0)
    expect(fs.readdirSync(extraDir)).toHaveLength(0)
    expect(helper.getScreenshotQueue()).toEqual([])
    expect(helper.getExtraScreenshotQueue()).toEqual([])
  })

  it("is a no-op when both directories are already empty", async () => {
    const helper = new ScreenshotHelper("queue")
    await expect(helper.deleteAllScreenshotFiles()).resolves.toBeUndefined()
  })
})
