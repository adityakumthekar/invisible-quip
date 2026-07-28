import type { BrowserWindowConstructorOptions } from "electron"

export interface MainWindowPolicy extends BrowserWindowConstructorOptions {
  contentProtection: boolean
}

/**
 * Main window construction options. The chrome is the same in both modes: a
 * frameless, transparent, shadowless window so the pill floats free on the
 * desktop. `invisible` only controls capture protection — debug mode
 * (INVISIBLE=false) shows up in screen captures but looks identical.
 */
export function createMainWindowOptions(
  invisible: boolean,
  preloadPath: string
): MainWindowPolicy {
  return {
    width: 400,
    height: 600,
    minWidth: 300,
    minHeight: 200,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: preloadPath
    },
    show: false,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    fullscreenable: false,
    // On a transparent window macOS draws the shadow around the full window
    // bounds, not the visible pill, so it reads as a rectangular halo.
    hasShadow: false,
    backgroundColor: "#00000000",
    focusable: true,
    resizable: true,
    movable: true,
    x: 100,
    y: 100,
    contentProtection: invisible
  }
}
