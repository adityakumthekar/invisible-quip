// ScreenshotHelper.ts

import path from "node:path"
import fs from "node:fs"
import { app, desktopCapturer, screen, systemPreferences } from "electron"
import { v4 as uuidv4 } from "uuid"
import sharp from "sharp"
import {
  createTeachingDisplayCaptureInfo,
  TeachingCapture
} from "./teaching"
import { matchCaptureSource } from "./displayTopology"
import { toDisplayDescriptor } from "./displayTopologyRuntime"

export class ScreenshotHelper {
  private static readonly SCREEN_PERMISSION_ERROR =
    "Screen capture blocked by macOS. Grant Screen Recording permission to this app in System Settings → Privacy & Security → Screen Recording, then restart the app."

  private static readonly HIDE_SETTLE_MS = 40

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

    // Create directories if they don't exist. Recursive guards against the
    // parent userData dir not existing yet (this runs before app.whenReady()).
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true })
    }
    if (!fs.existsSync(this.extraScreenshotDir)) {
      fs.mkdirSync(this.extraScreenshotDir, { recursive: true })
    }
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  /**
   * Pick the desktopCapturer screen source for the display under the cursor.
   * Re-reads the display topology on every capture (monitors get plugged in and
   * rearranged mid-session) and returns the display the chosen pixels actually
   * belong to — which is not always the cursor's display when Electron reports
   * an empty `display_id`. See matchCaptureSource for the matching rules.
   */
  private async pickActiveScreenSource() {
    // Fail fast with an actionable message when Screen Recording is off —
    // otherwise desktopCapturer silently returns a black frame.
    if (process.platform === "darwin") {
      const status = systemPreferences.getMediaAccessStatus("screen")
      if (status === "denied" || status === "restricted") {
        throw new Error(ScreenshotHelper.SCREEN_PERMISSION_ERROR)
      }
    }

    const activeDisplay = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint()
    )
    const thumbnailSize = {
      width: Math.ceil(activeDisplay.bounds.width * activeDisplay.scaleFactor),
      height: Math.ceil(activeDisplay.bounds.height * activeDisplay.scaleFactor)
    }
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize
    })
    if (sources.length === 0) {
      throw new Error(ScreenshotHelper.SCREEN_PERMISSION_ERROR)
    }

    const match = matchCaptureSource(
      sources.map((source) => ({
        source,
        id: source.id,
        name: source.name,
        display_id: source.display_id,
        ...source.thumbnail.getSize()
      })),
      toDisplayDescriptor(activeDisplay),
      screen.getAllDisplays().map(toDisplayDescriptor)
    )

    console.log(
      `[capture] "${match.source.name}" (${match.source.width}x${match.source.height}) → display ${match.display.id} via ${match.matchedBy}`
    )
    match.warnings.forEach((warning) => console.warn(`[capture] ${warning}`))

    return { source: match.source.source, display: match.display }
  }

  /**
   * Capture the active display to `filepath` as PNG. Always writes a file on
   * success so downstream reads can't ENOENT; throws an actionable permission
   * error when the capture comes back empty (blocked Screen Recording).
   */
  private async captureDisplayToFile(filepath: string): Promise<void> {
    const { source } = await this.pickActiveScreenSource()
    if (source.thumbnail.isEmpty()) {
      throw new Error(ScreenshotHelper.SCREEN_PERMISSION_ERROR)
    }
    const png = source.thumbnail.toPNG()
    if (!png || png.length === 0) {
      throw new Error(ScreenshotHelper.SCREEN_PERMISSION_ERROR)
    }
    await fs.promises.mkdir(path.dirname(filepath), { recursive: true })
    await fs.promises.writeFile(filepath, png)
  }

  /**
   * One-off capture of the active display for the chat "see my screen" flow.
   * Does not hide the overlay (stealth mode already excludes it via content
   * protection) and does not touch the screenshot queue.
   */
  public async captureForChat(): Promise<string> {
    const filepath = path.join(this.screenshotDir, `${uuidv4()}.png`)
    await this.captureDisplayToFile(filepath)
    return filepath
  }

  /**
   * Same capture as `captureForChat`, but hands back the PNG bytes instead of a
   * path. The chat path immediately re-encodes the image for upload, so writing
   * it to disk only to read it straight back was pure latency.
   */
  public async captureForChatBuffer(): Promise<Buffer> {
    const { source } = await this.pickActiveScreenSource()
    if (source.thumbnail.isEmpty()) {
      throw new Error(ScreenshotHelper.SCREEN_PERMISSION_ERROR)
    }
    const png = source.thumbnail.toPNG()
    if (!png || png.length === 0) {
      throw new Error(ScreenshotHelper.SCREEN_PERMISSION_ERROR)
    }
    return png
  }

  /**
   * Capture only the display under the cursor. The returned file is temporary;
   * the caller owns unlinking it after the model request finishes.
   */
  public async captureForTeaching(): Promise<TeachingCapture> {
    const filepath = path.join(app.getPath("temp"), `quip-teaching-${uuidv4()}.png`)

    try {
      const { source, display } = await this.pickActiveScreenSource()
      if (source.thumbnail.isEmpty()) {
        throw new Error(ScreenshotHelper.SCREEN_PERMISSION_ERROR)
      }

      await fs.promises.writeFile(filepath, source.thumbnail.toPNG())
      const metadata = await sharp(filepath).metadata()

      return {
        path: filepath,
        display: createTeachingDisplayCaptureInfo(display, metadata)
      }
    } catch (error: any) {
      await fs.promises.unlink(filepath).catch(() => {})
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
      fs.promises
        .unlink(screenshotPath)
        .catch((err) =>
          console.error(`Error deleting screenshot at ${screenshotPath}:`, err)
        )
    })
    this.screenshotQueue = []

    // Clear extraScreenshotQueue
    this.extraScreenshotQueue.forEach((screenshotPath) => {
      fs.promises
        .unlink(screenshotPath)
        .catch((err) =>
          console.error(
            `Error deleting extra screenshot at ${screenshotPath}:`,
            err
          )
        )
    })
    this.extraScreenshotQueue = []
  }

  /**
   * Wipe every file in both screenshot directories, not just what's tracked
   * in the in-memory queues — catches orphans left behind by a prior session
   * or crash. Used on app quit so no screenshots persist on disk afterward.
   */
  public async deleteAllScreenshotFiles(): Promise<void> {
    await Promise.all(
      [this.screenshotDir, this.extraScreenshotDir].map(async (dir) => {
        const entries = await fs.promises.readdir(dir).catch(() => [] as string[])
        await Promise.all(
          entries.map((name) =>
            fs.promises.unlink(path.join(dir, name)).catch((err) =>
              console.error(`Error deleting ${name} during quit cleanup:`, err)
            )
          )
        )
      })
    )
    this.screenshotQueue = []
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
        // Long enough for the compositor to drop the overlay, short enough not
        // to be felt. This sits on the critical path of every Cmd+H.
        await new Promise(resolve =>
          setTimeout(resolve, ScreenshotHelper.HIDE_SETTLE_MS)
        )
      }
      
      let screenshotPath = ""

      if (this.view === "queue") {
        screenshotPath = path.join(this.screenshotDir, `${uuidv4()}.png`)
        await this.captureDisplayToFile(screenshotPath)

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
        await this.captureDisplayToFile(screenshotPath)

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
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to take screenshot: ${message}`)
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
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
