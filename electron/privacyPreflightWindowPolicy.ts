import type { BrowserWindowConstructorOptions } from "electron"
import type { Rect } from "./privacyPreflightMarker"

export interface PrivacyPreflightWindowPolicy extends BrowserWindowConstructorOptions {
  contentProtection: boolean
}

/**
 * Options for the temporary marker window used by the self-capture check.
 * Mirrors the teaching overlay's stealth policy: capture protection is on
 * in normal (invisible) mode, and off only in the INVISIBLE=false debug
 * mode used for local debugging.
 */
export function createPrivacyPreflightWindowOptions(
  bounds: Rect,
  invisible: boolean
): PrivacyPreflightWindowPolicy {
  return {
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    fullscreenable: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    contentProtection: invisible,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  }
}
