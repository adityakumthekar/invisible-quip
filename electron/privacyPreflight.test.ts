import { describe, expect, it, vi } from "vitest"
import { PrivacyPreflightChecker } from "./privacyPreflight"
import type { DisplayCaptureInfo } from "./teaching"

const display: DisplayCaptureInfo = {
  bounds: { x: 0, y: 0, width: 1440, height: 900 },
  scaleFactor: 1,
  screenshotWidth: 1440,
  screenshotHeight: 900
}

function makeDependencies(overrides: Record<string, unknown> = {}) {
  const destroy = vi.fn()
  const waitUntilReady = vi.fn().mockResolvedValue(undefined)
  const createMarkerWindow = vi.fn().mockResolvedValue({ waitUntilReady, destroy })
  const captureScreen = vi.fn().mockResolvedValue({ path: "/tmp/preflight.png", display })
  const analyzeMarkerSamples = vi.fn().mockResolvedValue([false, false, false, false])
  const removeFile = vi.fn().mockResolvedValue(undefined)
  const isDebugMode = vi.fn().mockReturnValue(false)
  const getActiveDisplayBounds = vi.fn().mockReturnValue(display.bounds)

  return {
    deps: {
      isDebugMode,
      getActiveDisplayBounds,
      createMarkerWindow,
      captureScreen,
      analyzeMarkerSamples,
      removeFile,
      ...overrides
    },
    destroy,
    waitUntilReady,
    createMarkerWindow,
    captureScreen,
    analyzeMarkerSamples,
    removeFile,
    isDebugMode,
    getActiveDisplayBounds
  }
}

describe("PrivacyPreflightChecker", () => {
  it("deliberately fails as capturable debug mode without touching capture, and skips other steps", async () => {
    const { deps, createMarkerWindow, captureScreen } = makeDependencies({
      isDebugMode: vi.fn().mockReturnValue(true)
    })
    const checker = new PrivacyPreflightChecker(deps as any)

    const result = await checker.run()

    expect(result.status).toBe("fail")
    expect(result.debugMode).toBe(true)
    expect(result.remediation).toBeTruthy()
    expect(createMarkerWindow).not.toHaveBeenCalled()
    expect(captureScreen).not.toHaveBeenCalled()
  })

  it("passes when no marker samples are detected in the local capture", async () => {
    const { deps, destroy, removeFile } = makeDependencies({
      analyzeMarkerSamples: vi.fn().mockResolvedValue([false, false, false, false])
    })
    const checker = new PrivacyPreflightChecker(deps as any)

    const result = await checker.run()

    expect(result).toMatchObject({ status: "pass", debugMode: false })
    expect(result.reason).toBeTruthy()
    expect(destroy).toHaveBeenCalledOnce()
    expect(removeFile).toHaveBeenCalledWith("/tmp/preflight.png")
  })

  it("fails when a majority of marker samples are detected (real capture leak)", async () => {
    const { deps, destroy, removeFile } = makeDependencies({
      analyzeMarkerSamples: vi.fn().mockResolvedValue([true, true, true, false])
    })
    const checker = new PrivacyPreflightChecker(deps as any)

    const result = await checker.run()

    expect(result.status).toBe("fail")
    expect(result.debugMode).toBe(false)
    expect(result.remediation).toBeTruthy()
    expect(destroy).toHaveBeenCalledOnce()
    expect(removeFile).toHaveBeenCalledWith("/tmp/preflight.png")
  })

  it("does not fail from a single non-majority sample match", async () => {
    const { deps } = makeDependencies({
      analyzeMarkerSamples: vi.fn().mockResolvedValue([true, false, false, false])
    })
    const checker = new PrivacyPreflightChecker(deps as any)

    const result = await checker.run()

    expect(result.status).toBe("pass")
  })

  it("reports a clear, typed error and still cleans up the window when capture is blocked", async () => {
    const { deps, destroy, removeFile } = makeDependencies({
      captureScreen: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Screen capture blocked by macOS. Grant Screen Recording permission to this app in System Settings → Privacy & Security → Screen Recording, then restart the app."
          )
        )
    })
    const checker = new PrivacyPreflightChecker(deps as any)

    const result = await checker.run()

    expect(result.status).toBe("error")
    expect(result.reason).toMatch(/screen recording/i)
    expect(result.remediation).toBeTruthy()
    expect(destroy).toHaveBeenCalledOnce()
    expect(removeFile).not.toHaveBeenCalled()
  })

  it("cleans up the screenshot even if pixel analysis throws", async () => {
    const { deps, destroy, removeFile } = makeDependencies({
      analyzeMarkerSamples: vi.fn().mockRejectedValue(new Error("sharp exploded"))
    })
    const checker = new PrivacyPreflightChecker(deps as any)

    const result = await checker.run()

    expect(result.status).toBe("error")
    expect(result.reason).toMatch(/sharp exploded/i)
    expect(destroy).toHaveBeenCalledOnce()
    expect(removeFile).toHaveBeenCalledWith("/tmp/preflight.png")
  })

  it("does not attempt cleanup of a window that failed to create", async () => {
    const { deps, removeFile } = makeDependencies({
      createMarkerWindow: vi.fn().mockRejectedValue(new Error("window creation failed"))
    })
    const checker = new PrivacyPreflightChecker(deps as any)

    const result = await checker.run()

    expect(result.status).toBe("error")
    expect(removeFile).not.toHaveBeenCalled()
  })

  it("logs but does not throw when cleanup of the screenshot fails after a passing result", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { deps } = makeDependencies({
      removeFile: vi.fn().mockRejectedValue(new Error("unlink failed"))
    })
    const checker = new PrivacyPreflightChecker(deps as any)

    const result = await checker.run()

    expect(result.status).toBe("pass")
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
