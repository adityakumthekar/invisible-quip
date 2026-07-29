
import { BrowserWindow, screen } from "electron"
import { AppState } from "./main"
import path from "node:path"
import { createMainWindowOptions } from "./mainWindowPolicy"
import { computeWindowBounds } from "./windowSizing"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
  ? "http://localhost:5180"
  : `file://${path.join(__dirname, "../dist/index.html")}`

/** Read at call-time — .env is loaded in main.ts after this module is imported */
function isInvisibleMode(): boolean {
  return process.env.INVISIBLE !== "false"
}

/** Keep the window between fully opaque and readable-but-faint. */
export function clampOpacity(value: number): number {
  if (Number.isNaN(value)) return 1
  return Math.min(1, Math.max(0.3, value))
}

export class WindowHelper {
  private mainWindow: BrowserWindow | null = null
  private isWindowVisible: boolean = false
  private windowPosition: { x: number; y: number } | null = null
  private windowSize: { width: number; height: number } | null = null
  private appState: AppState

  // Initialize with explicit number type and 0 value
  private screenWidth: number = 0
  private screenHeight: number = 0
  /** Pixels to nudge per Cmd/Ctrl+Arrow. Was left at 0, so arrows did nothing. */
  private step: number = 60
  private currentX: number = 0
  private currentY: number = 0
  /** When true, clicks pass through; mousemove still reaches the renderer via `forward`. */
  private ignoringMouseEvents: boolean = true
  /** Last height cap pushed to the renderer; only re-sent when the display changes. */
  private lastMaxHeight: number | null = null
  private lastMaxWidth: number | null = null
  /** Active manual grip drag (see startWindowDrag). */
  private dragSession: {
    timer: NodeJS.Timeout
    offsetX: number
    offsetY: number
  } | null = null

  constructor(appState: AppState) {
    this.appState = appState
  }

  /**
   * Selective click-through: ignore empty areas (`true` + forward) so apps underneath
   * receive clicks; disable ignore when the cursor is over interactive glass UI.
   */
  public setIgnoreMouseEvents(ignore: boolean): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    if (this.ignoringMouseEvents === ignore) return
    this.ignoringMouseEvents = ignore
    if (ignore) {
      this.mainWindow.setIgnoreMouseEvents(true, { forward: true })
    } else {
      this.mainWindow.setIgnoreMouseEvents(false)
    }
  }

  /**
   * Move the window with the cursor until stopWindowDrag().
   *
   * Chromium's `-webkit-app-region: drag` is unusable here: on a transparent
   * window running setIgnoreMouseEvents(true, { forward: true }) the drag
   * gesture arrives as a mouseleave with `buttons === 0`, so the renderer turns
   * click-through back on mid-gesture and the window snaps back. Tracking the
   * OS cursor from the main process sidesteps the renderer entirely — the same
   * reason Cmd+arrows always worked.
   */
  public startWindowDrag(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    this.stopWindowDrag()

    const cursor = screen.getCursorScreenPoint()
    const [x, y] = this.mainWindow.getPosition()

    // Stay interactive for the whole gesture; the renderer's click-through
    // bookkeeping must not fire while the window is following the cursor.
    this.setIgnoreMouseEvents(false)

    this.dragSession = {
      offsetX: cursor.x - x,
      offsetY: cursor.y - y,
      timer: setInterval(() => this.followCursor(), 16)
    }
  }

  public stopWindowDrag(): void {
    if (!this.dragSession) return
    clearInterval(this.dragSession.timer)
    this.dragSession = null
    this.syncPositionFromWindow()
  }

  public isDraggingWindow(): boolean {
    return this.dragSession !== null
  }

  private followCursor(): void {
    if (!this.dragSession) return
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.stopWindowDrag()
      return
    }

    const cursor = screen.getCursorScreenPoint()
    // setPosition, never setBounds — rewriting size mid-drag makes the window
    // jump and re-triggers the resize observers.
    this.mainWindow.setPosition(
      Math.round(cursor.x - this.dragSession.offsetX),
      Math.round(cursor.y - this.dragSession.offsetY)
    )
  }

  public setWindowDimensions(width: number, height: number): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    // Resizing mid-drag fights followCursor and makes the window stutter.
    if (this.dragSession) return

    // Work area of the display the window currently sits on (multi-monitor aware)
    const bounds = this.mainWindow.getBounds()
    const workArea = screen.getDisplayMatching(bounds).workArea
    const [currentX, currentY] = this.mainWindow.getPosition()

    const next = computeWindowBounds({
      content: { width, height },
      current: { x: currentX, y: currentY },
      workArea,
      // Allow wider overlay for two-panel glass layout
      widthFraction: this.appState.getHasDebugged() ? 0.8 : 0.7
    })

    // Skip no-op updates — setBounds mid-drag cancels native window dragging.
    if (
      this.windowSize?.width === next.width &&
      this.windowSize?.height === next.height &&
      currentX === next.x &&
      currentY === next.y
    ) {
      return
    }

    // Resize in place. Prefer setSize so we don't rewrite x/y (which aborts drag).
    this.mainWindow.setSize(next.width, next.height)
    if (currentX !== next.x || currentY !== next.y) {
      this.mainWindow.setPosition(next.x, next.y)
    }
    this.windowPosition = { x: next.x, y: next.y }
    this.currentX = next.x
    this.currentY = next.y
    this.windowSize = { width: next.width, height: next.height }

    // The renderer caps its own scroller and panel width from this, so neither
    // can be a vh/vw value: the viewport is the window and the window is sized
    // from content, which would make a viewport-relative cap chase itself.
    // Republish when either axis moves, so dragging to a differently-sized
    // display re-clamps the panel.
    if (
      this.lastMaxHeight !== next.maxHeight ||
      this.lastMaxWidth !== next.maxWidth
    ) {
      this.lastMaxHeight = next.maxHeight
      this.lastMaxWidth = next.maxWidth
      this.mainWindow.webContents.send("content-limits", {
        maxHeight: next.maxHeight,
        maxWidth: next.maxWidth
      })
    }
  }

  public createWindow(): void {
    if (this.mainWindow !== null) return

    const invisible = isInvisibleMode()
    console.log(
      `[WindowHelper] INVISIBLE=${process.env.INVISIBLE ?? "(unset)"} → stealth=${invisible}`
    )

    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workAreaSize
    this.screenWidth = workArea.width
    this.screenHeight = workArea.height

    
    const { contentProtection, ...windowSettings } = createMainWindowOptions(
      invisible,
      path.join(__dirname, "preload.js")
    )

    this.mainWindow = new BrowserWindow(windowSettings)
    // this.mainWindow.webContents.openDevTools()
    // Content protection hides the window from screenshots — must be off for debugging
    this.mainWindow.setContentProtection(contentProtection)

    if (process.platform === "darwin") {
      this.mainWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true
      })
      this.mainWindow.setHiddenInMissionControl(invisible)
      // "floating" can still be excluded from some captures; use normal when visible
      this.mainWindow.setAlwaysOnTop(true, invisible ? "floating" : "normal")
    }
    if (process.platform === "linux") {
      // Linux-specific optimizations for better compatibility
      // No shadow in either mode — on a transparent window it frames the full
      // bounds rather than the pill (see mainWindowPolicy).
      if (this.mainWindow.setHasShadow) {
        this.mainWindow.setHasShadow(false)
      }
      // Keep window focusable on Linux for proper interaction
      this.mainWindow.setFocusable(true)
    } 
    this.mainWindow.setSkipTaskbar(invisible)
    this.mainWindow.setAlwaysOnTop(true)

    // Pass clicks through transparent regions; renderer toggles this when over UI.
    this.ignoringMouseEvents = true
    this.mainWindow.setIgnoreMouseEvents(true, { forward: true })

    this.mainWindow.loadURL(startUrl).catch((err) => {
      console.error("Failed to load URL:", err)
    })

    // Show window after loading URL and center it
    this.mainWindow.once('ready-to-show', () => {
      if (this.mainWindow) {
        // Re-assert capture policy after show (macOS can reset it)
        this.mainWindow.setContentProtection(invisible)
        // Center the window first
        this.centerWindow()
        this.mainWindow.show()
        this.mainWindow.focus()
        this.mainWindow.setAlwaysOnTop(true, invisible ? "floating" : "normal")
        console.log(
          invisible
            ? "Window is now visible and centered (stealth)"
            : "Window is now visible and centered (capturable — content protection OFF)"
        )
      }
    })

    const bounds = this.mainWindow.getBounds()
    this.windowPosition = { x: bounds.x, y: bounds.y }
    this.windowSize = { width: bounds.width, height: bounds.height }
    this.currentX = bounds.x
    this.currentY = bounds.y

    this.setupWindowListeners()
    this.isWindowVisible = true
  }

  private setupWindowListeners(): void {
    if (!this.mainWindow) return

    this.mainWindow.on("move", () => {
      if (this.mainWindow) {
        const bounds = this.mainWindow.getBounds()
        this.windowPosition = { x: bounds.x, y: bounds.y }
        this.currentX = bounds.x
        this.currentY = bounds.y
      }
    })

    this.mainWindow.on("resize", () => {
      if (this.mainWindow) {
        const bounds = this.mainWindow.getBounds()
        this.windowSize = { width: bounds.width, height: bounds.height }
      }
    })

    this.mainWindow.on("closed", () => {
      this.stopWindowDrag()
      this.mainWindow = null
      this.isWindowVisible = false
      this.windowPosition = null
      this.windowSize = null
    })
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  public isVisible(): boolean {
    return this.isWindowVisible
  }

  public hideMainWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      console.warn("Main window does not exist or is destroyed.")
      return
    }

    const bounds = this.mainWindow.getBounds()
    this.windowPosition = { x: bounds.x, y: bounds.y }
    this.windowSize = { width: bounds.width, height: bounds.height }
    this.mainWindow.hide()
    this.isWindowVisible = false
  }

  public showMainWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      console.warn("Main window does not exist or is destroyed.")
      return
    }

    if (this.windowPosition && this.windowSize) {
      this.mainWindow.setBounds({
        x: this.windowPosition.x,
        y: this.windowPosition.y,
        width: this.windowSize.width,
        height: this.windowSize.height
      })
    }

    this.mainWindow.showInactive()

    this.isWindowVisible = true
  }

  public toggleMainWindow(): void {
    if (this.isWindowVisible) {
      this.hideMainWindow()
    } else {
      this.showMainWindow()
    }
  }

  private centerWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return
    }

    // Get current window size or use defaults
    const windowBounds = this.mainWindow.getBounds()
    const windowWidth = windowBounds.width || 400
    const windowHeight = windowBounds.height || 600

    // Center within the display the window currently occupies (multi-monitor aware)
    const workArea = screen.getDisplayMatching(windowBounds).workArea

    // Calculate center position, offset by the display's origin
    const centerX = workArea.x + Math.floor((workArea.width - windowWidth) / 2)
    const centerY = workArea.y + Math.floor((workArea.height - windowHeight) / 2)
    
    // Set window position
    this.mainWindow.setBounds({
      x: centerX,
      y: centerY,
      width: windowWidth,
      height: windowHeight
    })
    
    // Update internal state
    this.windowPosition = { x: centerX, y: centerY }
    this.windowSize = { width: windowWidth, height: windowHeight }
    this.currentX = centerX
    this.currentY = centerY
  }

  public centerAndShowWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      console.warn("Main window does not exist or is destroyed.")
      return
    }

    this.centerWindow()
    this.mainWindow.show()
    this.mainWindow.focus()
    this.mainWindow.setAlwaysOnTop(true)
    this.isWindowVisible = true
    
    console.log(`Window centered and shown`)
  }

  public setOpacity(value: number): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.setOpacity(clampOpacity(value))
  }

  // New methods for window movement — nudge against the display the window is on.
  public moveWindowRight(): void {
    if (!this.mainWindow) return

    this.syncPositionFromWindow()
    const workArea = screen.getDisplayMatching(this.mainWindow.getBounds()).workArea
    const windowWidth = this.windowSize?.width || this.mainWindow.getBounds().width
    const maxX = workArea.x + workArea.width - Math.min(windowWidth, workArea.width)

    this.currentX = Math.min(maxX, this.currentX + this.step)
    this.mainWindow.setPosition(
      Math.round(this.currentX),
      Math.round(this.currentY)
    )
  }

  public moveWindowLeft(): void {
    if (!this.mainWindow) return

    this.syncPositionFromWindow()
    const workArea = screen.getDisplayMatching(this.mainWindow.getBounds()).workArea

    this.currentX = Math.max(workArea.x, this.currentX - this.step)
    this.mainWindow.setPosition(
      Math.round(this.currentX),
      Math.round(this.currentY)
    )
  }

  public moveWindowDown(): void {
    if (!this.mainWindow) return

    this.syncPositionFromWindow()
    const workArea = screen.getDisplayMatching(this.mainWindow.getBounds()).workArea
    const windowHeight =
      this.windowSize?.height || this.mainWindow.getBounds().height
    const maxY =
      workArea.y + workArea.height - Math.min(windowHeight, workArea.height)

    this.currentY = Math.min(maxY, this.currentY + this.step)
    this.mainWindow.setPosition(
      Math.round(this.currentX),
      Math.round(this.currentY)
    )
  }

  public moveWindowUp(): void {
    if (!this.mainWindow) return

    this.syncPositionFromWindow()
    const workArea = screen.getDisplayMatching(this.mainWindow.getBounds()).workArea

    this.currentY = Math.max(workArea.y, this.currentY - this.step)
    this.mainWindow.setPosition(
      Math.round(this.currentX),
      Math.round(this.currentY)
    )
  }

  private syncPositionFromWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    const [x, y] = this.mainWindow.getPosition()
    this.currentX = x
    this.currentY = y
    this.windowPosition = { x, y }
  }
}
