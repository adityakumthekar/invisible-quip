import type { BrowserWindowConstructorOptions, Rectangle } from "electron"
import type { DipRect, TeachingResult } from "./teaching"
import type { TeachingOverlayTargetEvent } from "./teachingOverlayContract"

export interface TeachingOverlayWindowPolicy
  extends BrowserWindowConstructorOptions {
  contentProtection: boolean
}

export function globalDipTargetToOverlayLocal(
  target: DipRect,
  displayBounds: Rectangle
): DipRect {
  return {
    x: target.x - displayBounds.x,
    y: target.y - displayBounds.y,
    width: target.width,
    height: target.height
  }
}

export function createTeachingOverlayEventData(
  result: Extract<TeachingResult, { state: "step" }>
): TeachingOverlayTargetEvent {
  return {
    instruction: result.instruction,
    ...(result.label === undefined ? {} : { label: result.label }),
    target: globalDipTargetToOverlayLocal(result.target, result.displayBounds)
  }
}

export function createTeachingOverlayWindowOptions(
  bounds: Rectangle,
  invisible: boolean,
  preload: string
): TeachingOverlayWindowPolicy {
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
      nodeIntegration: false,
      preload
    }
  }
}
