import {
  VISIBLE_MODE_REMEDIATION,
  VISIBLE_MODE_WARNING,
  type PrivacyPreflightResult
} from "./privacyContract"
import type { DisplayCaptureInfo } from "./teaching"
import { evaluateMarkerDetection } from "./privacyPreflightAnalysis"
import {
  computeMarkerSamplePixelRects,
  computeMarkerWindowBounds,
  type Rect
} from "./privacyPreflightMarker"

export interface PrivacyPreflightWindowHandle {
  waitUntilReady: () => Promise<void>
  destroy: () => void
}

export interface PrivacyPreflightScreenCapture {
  path: string
  display: DisplayCaptureInfo
}

/**
 * Real Electron/sharp I/O is injected so the pass/fail/error/cleanup
 * decision logic below can be unit tested without spinning up windows or
 * touching the screen. See privacyPreflightRuntime.ts for the production
 * implementation.
 */
export interface PrivacyPreflightDependencies {
  isDebugMode: () => boolean
  getActiveDisplayBounds: () => Rect
  createMarkerWindow: (bounds: Rect) => Promise<PrivacyPreflightWindowHandle>
  captureScreen: () => Promise<PrivacyPreflightScreenCapture>
  analyzeMarkerSamples: (imagePath: string, pixelRects: Rect[]) => Promise<boolean[]>
  removeFile: (path: string) => Promise<void>
}

const LEAK_REASON =
  "The test marker was visible in a local screenshot, so capture protection is not excluding Quip on this system."
const LEAK_REMEDIATION =
  "Check your OS privacy/screen-recording settings, restart Quip, then run the privacy check again before teaching."
const PASS_REASON =
  "The test marker was not visible in a local screenshot, so capture protection appears to be excluding Quip. This is a local, best-effort check — always verify your own share preview before teaching."
const ERROR_REMEDIATION =
  "Grant Screen Recording permission to Quip in System Settings → Privacy & Security → Screen Recording, then restart the app and retry."

export class PrivacyPreflightChecker {
  constructor(private readonly dependencies: PrivacyPreflightDependencies) {}

  public async run(): Promise<PrivacyPreflightResult> {
    // Reported honestly as a failure, but no longer a blocker: the privacy
    // gate lets teaching proceed in visible mode behind a persistent warning.
    if (this.dependencies.isDebugMode()) {
      return {
        status: "fail",
        reason: VISIBLE_MODE_WARNING,
        remediation: VISIBLE_MODE_REMEDIATION,
        debugMode: true
      }
    }

    let handle: PrivacyPreflightWindowHandle | undefined
    let screenshotPath: string | undefined

    try {
      const displayBounds = this.dependencies.getActiveDisplayBounds()
      const windowBounds = computeMarkerWindowBounds(displayBounds)

      handle = await this.dependencies.createMarkerWindow(windowBounds)
      await handle.waitUntilReady()

      const capture = await this.dependencies.captureScreen()
      screenshotPath = capture.path

      const pixelRects = computeMarkerSamplePixelRects(windowBounds, capture.display)
      const matches = await this.dependencies.analyzeMarkerSamples(
        capture.path,
        pixelRects
      )

      if (evaluateMarkerDetection(matches)) {
        return {
          status: "fail",
          reason: LEAK_REASON,
          remediation: LEAK_REMEDIATION,
          debugMode: false
        }
      }

      return { status: "pass", reason: PASS_REASON, debugMode: false }
    } catch (error) {
      return {
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
        remediation: ERROR_REMEDIATION,
        debugMode: false
      }
    } finally {
      handle?.destroy()
      if (screenshotPath) {
        try {
          await this.dependencies.removeFile(screenshotPath)
        } catch (cleanupError) {
          console.error("Failed to delete privacy preflight screenshot:", cleanupError)
        }
      }
    }
  }
}
