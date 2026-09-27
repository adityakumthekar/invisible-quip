import { BrowserWindow, screen } from "electron"
import fs from "node:fs"
import type { ScreenshotHelper } from "./ScreenshotHelper"
import type {
  PrivacyPreflightDependencies,
  PrivacyPreflightWindowHandle
} from "./privacyPreflight"
import { analyzeMarkerSamples } from "./privacyPreflightAnalysis"
import {
  buildPrivacyPreflightMarkerHtml,
  PRIVACY_PREFLIGHT_MARKER_COLORS,
  type Rect
} from "./privacyPreflightMarker"
import { createPrivacyPreflightWindowOptions } from "./privacyPreflightWindowPolicy"
import { isInvisibleMode } from "./invisibleMode"

/** Time to let the compositor paint the marker window before capturing. */
const PAINT_DELAY_MS = 150

function createMarkerWindow(bounds: Rect): Promise<PrivacyPreflightWindowHandle> {
  const options = createPrivacyPreflightWindowOptions(bounds, true)
  const { contentProtection, ...windowOptions } = options
  const win = new BrowserWindow(windowOptions)
  win.setContentProtection(contentProtection)
  win.setIgnoreMouseEvents(true)
  if (process.platform === "darwin") {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  win.setAlwaysOnTop(true, "screen-saver")

  const html = buildPrivacyPreflightMarkerHtml()
  const loaded = win
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    .catch((error) => {
      win.destroy()
      throw error
    })

  return Promise.resolve({
    waitUntilReady: async () => {
      await loaded
      if (win.isDestroyed()) {
        throw new Error("Privacy preflight test window closed unexpectedly.")
      }
      win.showInactive()
      await new Promise((resolve) => setTimeout(resolve, PAINT_DELAY_MS))
    },
    destroy: () => {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    }
  })
}

/**
 * Wires the pure PrivacyPreflightChecker to real Electron APIs and the
 * existing local capture path (no AI, no upload). Kept separate from
 * privacyPreflight.ts so the pass/fail/error decision logic stays unit
 * testable without a display or Screen Recording permission.
 */
export function createElectronPrivacyPreflightDependencies(
  screenshotHelper: ScreenshotHelper
): PrivacyPreflightDependencies {
  return {
    isDebugMode: () => !isInvisibleMode(),
    getActiveDisplayBounds: () =>
      screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds,
    createMarkerWindow,
    captureScreen: () => screenshotHelper.captureForTeaching(),
    analyzeMarkerSamples: (imagePath, pixelRects) =>
      analyzeMarkerSamples(imagePath, pixelRects, PRIVACY_PREFLIGHT_MARKER_COLORS),
    removeFile: (path) => fs.promises.unlink(path)
  }
}
