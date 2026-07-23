// ScreenshotHelper.ts

import path from "node:path"
import fs from "node:fs"
import { app, desktopCapturer, screen } from "electron"
import { v4 as uuidv4 } from "uuid"
import screenshot from "screenshot-desktop"
import sharp from "sharp"
import {
  createTeachingDisplayCaptureInfo,
  TeachingCapture
} from "./teaching"

export class ScreenshotHelper {
  private screenshotQueue: string[] = []
  private extraScreenshotQueue: string[] = []
  private readonly MAX_SCREENSHOTS = 5

  private readonly screenshotDir: string
  private readonly extraScreenshotDir: string

  private view: "queue" | "solutions" = "queue"

  constructor(view: "queue" | "solutions" = "queue") {
    this.view = view

    // Initialize directories
    this.screenshotDir = path.join(app.getPath("userData"), "screenshots")
    this.extraScreenshotDir = path.join(
      app.getPath("userData"),
      "extra_screenshots"
    )

    // Create directories if they don't exist
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir)
    }
    if (!fs.existsSync(this.extraScreenshotDir)) {
      fs.mkdirSync(this.extraScreenshotDir)
    }
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  /**
   * Resolve the screenshot-desktop `screen` index (0-based, primary-first) for the
   * monitor under the cursor. screenshot-desktop numbers displays 0..N with the
   * primary at 0 — NOT by Electron's display.id — so we map via primary + order.
   * ponytail: primary is always exact; picking between multiple secondaries on 3+
   * monitors is best-effort (screencapture's order isn't exposed). Match by pixel
   * bounds if that ever matters.
   */
  private resolveActiveScreenId(): number | undefined {
    try {
      const displays = screen.getAllDisplays()
      if (displays.length <= 1) return undefined // single display → default capture
      const primaryId = screen.getPrimaryDisplay().id
      const active = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      if (active.id === primaryId) return 0
      const secondaries = displays.filter((d) => d.id !== primaryId)
      const pos = secondaries.findIndex((d) => d.id === active.id)
      return pos >= 0 ? pos + 1 : undefined
    } catch (error) {
      console.error("Error resolving active display:", error)
      return undefined
    }
  }

  /**
   * One-off capture of the active display for the chat "see my screen" flow.
   * Does not hide the overlay (stealth mode already excludes it via content
   * protection) and does not touch the screenshot queue.
   */
  public async captureForChat(): Promise<string> {
    const screenId = this.resolveActiveScreenId()
    const filepath = path.join(this.screenshotDir, `${uuidv4()}.png`)
    try {
      await screenshot(
        screenId !== undefined
          ? { screen: screenId, filename: filepath }
          : { filename: filepath }
      )
    } catch (error: any) {
      if (String(error?.message ?? error).includes("could not create image")) {
        throw new Error(
          "Screen capture blocked by macOS. Grant Screen Recording permission to this app in System Settings → Privacy & Security → Screen Recording, then restart the app."
        )
      }
      throw error
    }
    return filepath
  }

  /**
   * Capture only the display under the cursor. The returned file is temporary;
   * the caller owns unlinking it after the model request finishes.
   */
  public async captureForTeaching(): Promise<TeachingCapture> {
    const activeDisplay = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint()
    )
    const requestedSize = {
      width: Math.ceil(activeDisplay.bounds.width * activeDisplay.scaleFactor),
      height: Math.ceil(activeDisplay.bounds.height * activeDisplay.scaleFactor)
    }
    const filepath = path.join(app.getPath("temp"), `quip-teaching-${uuidv4()}.png`)

    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: requestedSize
      })
      const source =
        sources.find(
          (candidate) => candidate.display_id === String(activeDisplay.id)
        ) ?? (sources.length === 1 ? sources[0] : undefined)

      if (!source) {
        throw new Error("Could not identify the active display for capture.")
      }

      await fs.promises.writeFile(filepath, source.thumbnail.toPNG())
      const metadata = await sharp(filepath).metadata()

      return {
        path: filepath,
        display: createTeachingDisplayCaptureInfo(activeDisplay, metadata)
      }
    } catch (error: any) {
      await fs.promises.unlink(filepath).catch(() => {})
      if (String(error?.message ?? error).includes("could not create image")) {
        throw new Error(
          "Screen capture blocked by macOS. Grant Screen Recording permission to this app in System Settings → Privacy & Security → Screen Recording, then restart the app."
        )
      }
      throw error
    }
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotQueue
  }

  public getExtraScreenshotQueue(): string[] {
    return this.extraScreenshotQueue
  }

  public clearQueues(): void {
    // Clear screenshotQueue
    this.screenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err)
          console.error(`Error deleting screenshot at ${screenshotPath}:`, err)
      })
    })
    this.screenshotQueue = []

    // Clear extraScreenshotQueue
    this.extraScreenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err)
          console.error(
            `Error deleting extra screenshot at ${screenshotPath}:`,
            err
          )
      })
    })
    this.extraScreenshotQueue = []
  }

  public async takeScreenshot(
    hideMainWindow: () => void,
    showMainWindow: () => void
  ): Promise<string> {
    // When debugging (INVISIBLE=false), keep the overlay in the capture
    const keepVisible = process.env.INVISIBLE === "false"

    try {
      if (!keepVisible) {
        hideMainWindow()
        // Add a small delay to ensure window is hidden
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      let screenshotPath = ""
      const screenId = this.resolveActiveScreenId()
      const capture = (filename: string) =>
        screenshot(
          screenId !== undefined ? { screen: screenId, filename } : { filename }
        )

      if (this.view === "queue") {
        screenshotPath = path.join(this.screenshotDir, `${uuidv4()}.png`)
        await capture(screenshotPath)

        this.screenshotQueue.push(screenshotPath)
        if (this.screenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.screenshotQueue.shift()
          if (removedPath) {
            try {
              await fs.promises.unlink(removedPath)
            } catch (error) {
              console.error("Error removing old screenshot:", error)
            }
          }
        }
      } else {
        screenshotPath = path.join(this.extraScreenshotDir, `${uuidv4()}.png`)
        await capture(screenshotPath)

        this.extraScreenshotQueue.push(screenshotPath)
        if (this.extraScreenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.extraScreenshotQueue.shift()
          if (removedPath) {
            try {
              await fs.promises.unlink(removedPath)
            } catch (error) {
              console.error("Error removing old screenshot:", error)
            }
          }
        }
      }

      return screenshotPath
    } catch (error) {
      console.error("Error taking screenshot:", error)
      throw new Error(`Failed to take screenshot: ${error.message}`)
    } finally {
      if (!keepVisible) {
        // Ensure window is always shown again
        showMainWindow()
      }
    }
  }

  public async getImagePreview(filepath: string): Promise<string> {
    try {
      const data = await fs.promises.readFile(filepath)
      return `data:image/png;base64,${data.toString("base64")}`
    } catch (error) {
      console.error("Error reading image:", error)
      throw error
    }
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await fs.promises.unlink(path)
      if (this.view === "queue") {
        this.screenshotQueue = this.screenshotQueue.filter(
          (filePath) => filePath !== path
        )
      } else {
        this.extraScreenshotQueue = this.extraScreenshotQueue.filter(
          (filePath) => filePath !== path
        )
      }
      return { success: true }
    } catch (error) {
      console.error("Error deleting file:", error)
      return { success: false, error: error.message }
    }
  }
}
