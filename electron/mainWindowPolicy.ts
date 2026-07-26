import type { BrowserWindowConstructorOptions } from "electron"

export interface MainWindowPolicy extends BrowserWindowConstructorOptions {
  contentProtection: boolean
}

/**
 * Main window construction options. Capture protection, frame, transparency,
 * and shadow all flip together with `invisible` so debug mode (INVISIBLE=false)
 * consistently renders a normal, capturable window instead of a stealth one.
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
    frame: !invisible,
    transparent: invisible,
    fullscreenable: false,
    hasShadow: !invisible,
    backgroundColor: invisible ? "#00000000" : "#1a1a1a",
    focusable: true,
    resizable: true,
    movable: true,
    x: 100,
    y: 100,
    contentProtection: invisible
  }
}
