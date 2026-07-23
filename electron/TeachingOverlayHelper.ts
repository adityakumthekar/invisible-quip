import { BrowserWindow } from "electron"
import type { WebContents } from "electron"
import path from "node:path"
import type { TeachingResult } from "./teaching"
import {
  createTeachingOverlayEventData,
  createTeachingOverlayWindowOptions
} from "./teachingOverlayPolicy"
import { TeachingOverlayReplayCoordinator } from "./teachingOverlayReplay"

const isDev = process.env.NODE_ENV === "development"

function isInvisibleMode(): boolean {
  return process.env.INVISIBLE !== "false"
}

function getOverlayUrl(): string {
  if (isDev) {
    return "http://localhost:5180/?view=teaching-overlay"
  }

  const url = new URL(`file://${path.join(__dirname, "../dist/index.html")}`)
  url.searchParams.set("view", "teaching-overlay")
  return url.toString()
}

export class TeachingOverlayHelper {
  private overlayWindow: BrowserWindow | null = null
  private readonly replay = new TeachingOverlayReplayCoordinator<WebContents>(
    (renderer, target) => renderer.send("teaching-overlay-target", target),
    (renderer) => renderer.send("teaching-overlay-clear")
  )

  public showTarget(
    result: Extract<TeachingResult, { state: "step" }>
  ): void {
    const overlayWindow = this.ensureWindow(result)
    overlayWindow.setBounds(result.displayBounds)
    this.replay.setTarget(createTeachingOverlayEventData(result))

    if (this.replay.isReady(overlayWindow.webContents)) {
      overlayWindow.showInactive()
    }
  }

  public clear(): void {
    this.replay.clear()
    const overlayWindow = this.getLiveWindow()
    overlayWindow?.hide()
  }

  public close(): void {
    const overlayWindow = this.getLiveWindow()
    this.overlayWindow = null
    if (overlayWindow) {
      this.replay.clear()
      this.replay.deactivate(overlayWindow.webContents)
      overlayWindow.destroy()
    }
  }

  public rendererReady(renderer: WebContents): boolean {
    const accepted = this.replay.ready(renderer)
    if (accepted && this.replay.hasTarget()) {
      this.getLiveWindow()?.showInactive()
    }
    return accepted
  }

  private ensureWindow(
    result: Extract<TeachingResult, { state: "step" }>
  ): BrowserWindow {
    const existingWindow = this.getLiveWindow()
    if (existingWindow) {
      return existingWindow
    }

    const policy = createTeachingOverlayWindowOptions(
      result.displayBounds,
      isInvisibleMode(),
      path.join(__dirname, "preload.js")
    )
    const { contentProtection, ...windowOptions } = policy
    const overlayWindow = new BrowserWindow(windowOptions)
    this.overlayWindow = overlayWindow
    this.replay.activate(overlayWindow.webContents)

    overlayWindow.setIgnoreMouseEvents(true)
    overlayWindow.setContentProtection(contentProtection)
    overlayWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    })
    overlayWindow.setAlwaysOnTop(true, "screen-saver")

    overlayWindow.on("closed", () => {
      this.replay.deactivate(overlayWindow.webContents)
      if (this.overlayWindow === overlayWindow) {
        this.overlayWindow = null
      }
    })
    overlayWindow.loadURL(getOverlayUrl()).catch((error) => {
      console.error("Failed to load teaching overlay:", error)
      if (this.overlayWindow === overlayWindow) {
        this.close()
      }
    })

    return overlayWindow
  }

  private getLiveWindow(): BrowserWindow | null {
    if (this.overlayWindow?.isDestroyed()) {
      this.overlayWindow = null
    }
    return this.overlayWindow
  }
}
