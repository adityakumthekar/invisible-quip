import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  PREWARM_MAX_AGE_MS,
  claimChatCapture,
  prewarmChatCapture,
  resetChatCapturePrewarm
} from "./chatCapturePrewarm"

describe("chat capture prewarm", () => {
  beforeEach(() => {
    resetChatCapturePrewarm()
  })

  it("hands the parked capture to the first claimer", async () => {
    const buffer = Buffer.from("png")
    prewarmChatCapture(async () => buffer, 1000)

    await expect(claimChatCapture(1100)).resolves.toBe(buffer)
  })

  it("starts capturing immediately, not on claim", () => {
    const capture = vi.fn(async () => Buffer.from("png"))
    prewarmChatCapture(capture, 1000)

    expect(capture).toHaveBeenCalledTimes(1)
  })

  it("refuses a stale frame so we never answer about the wrong screen", () => {
    prewarmChatCapture(async () => Buffer.from("png"), 1000)

    expect(claimChatCapture(1000 + PREWARM_MAX_AGE_MS + 1)).toBeNull()
  })

  it("only lets one request claim a given capture", async () => {
    prewarmChatCapture(async () => Buffer.from("png"), 1000)

    expect(claimChatCapture(1000)).not.toBeNull()
    expect(claimChatCapture(1000)).toBeNull()
  })

  it("returns null when nothing was prewarmed", () => {
    expect(claimChatCapture(1000)).toBeNull()
  })

  it("does not leave an unclaimed failure as an unhandled rejection", async () => {
    prewarmChatCapture(async () => {
      throw new Error("screen recording denied")
    }, 1000)

    // Nobody claims it; the process must survive the microtask queue draining.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(claimChatCapture(1000 + PREWARM_MAX_AGE_MS + 1)).toBeNull()
  })

  it("surfaces the capture failure to whoever does claim it", async () => {
    prewarmChatCapture(async () => {
      throw new Error("screen recording denied")
    }, 1000)

    await expect(claimChatCapture(1000)).rejects.toThrow(
      "screen recording denied"
    )
  })
})
