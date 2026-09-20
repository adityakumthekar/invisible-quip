import { TodayStickyWindow } from "./TodayStickyWindow";
import { initializeWorkspaceApp } from "./workspaceMain"
import { CompanionRuntime } from "./companionRuntime"
import { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut } from "electron"
import type { WebContents } from "electron"
import dotenv from "dotenv"
import path from "node:path"
import { initializeIpcHandlers } from "./ipcHandlers"
import { WindowHelper } from "./WindowHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { ShortcutsHelper } from "./shortcuts"
import { ProcessingHelper } from "./ProcessingHelper"
import { TeachingOverlayHelper } from "./TeachingOverlayHelper"
import { watchDisplayTopology } from "./displayTopologyRuntime"
import type { TeachingResult } from "./teaching"

/** The slice of AutopilotCoordinator that main needs for global shortcuts. */
export interface AutopilotControls {
  stop: () => void
  confirm: () => void
  isAwaitingConfirmation: () => boolean
  isRunning: () => boolean
}

// Only development reads local environment files; releases contain public service config.
if (!app.isPackaged) dotenv.config()

// INVISIBLE=false disables stealth so the window appears in screenshots (debugging)
function isInvisibleMode(): boolean {
  return process.env.INVISIBLE !== "false"
}

export class AppState {
  private static instance: AppState | null = null

  private windowHelper: WindowHelper
  private screenshotHelper: ScreenshotHelper
  public shortcutsHelper: ShortcutsHelper
  public processingHelper: ProcessingHelper
  private teachingOverlayHelper: TeachingOverlayHelper
  private autopilot: AutopilotControls | null = null
  private remoteShutdown: (() => Promise<void>) | null = null
  private remoteInputKillSwitch: (() => void) | null = null
  public companion: CompanionRuntime | null = null
  public sticky: TodayStickyWindow | null = null
  private restoreSticky = false
  private restoreAssistant = true
  public openWorkspace: (() => void) | null = null
  private tray: Tray | null = null

  // View management
  private view: "queue" | "solutions" = "queue"

  private problemInfo: {
    problem_statement: string
    input_format: Record<string, any>
    output_format: Record<string, any>
    constraints: Array<Record<string, any>>
    test_cases: Array<Record<string, any>>
  } | null = null // Allow null

  private hasDebugged: boolean = false

  // Processing events
  public readonly PROCESSING_EVENTS = {
    //global states
    UNAUTHORIZED: "procesing-unauthorized",
    NO_SCREENSHOTS: "processing-no-screenshots",

    //states for generating the initial solution
    INITIAL_START: "initial-start",
    PROBLEM_EXTRACTED: "problem-extracted",
    SOLUTION_SUCCESS: "solution-success",
    INITIAL_SOLUTION_ERROR: "solution-error",

    //states for processing the debugging
    DEBUG_START: "debug-start",
    DEBUG_SUCCESS: "debug-success",
    DEBUG_ERROR: "debug-error"
  } as const

  constructor() {
    // Initialize WindowHelper with this
    this.windowHelper = new WindowHelper(this)

    // Initialize ScreenshotHelper
    this.screenshotHelper = new ScreenshotHelper(this.view)

    // Initialize ProcessingHelper
    this.processingHelper = new ProcessingHelper(this)

    // Initialize ShortcutsHelper
    this.shortcutsHelper = new ShortcutsHelper(this)

    this.teachingOverlayHelper = new TeachingOverlayHelper()
  }

  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState()
    }
    return AppState.instance
  }

  // Getters and Setters
  public getMainWindow(): BrowserWindow | null {
    return this.windowHelper.getMainWindow()
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
    this.screenshotHelper.setView(view)
  }

  public isVisible(): boolean {
    return this.windowHelper.isVisible()
  }

  public getScreenshotHelper(): ScreenshotHelper {
    return this.screenshotHelper
  }

  public getProblemInfo(): any {
    return this.problemInfo
  }

  public setProblemInfo(problemInfo: any): void {
    this.problemInfo = problemInfo
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotHelper.getScreenshotQueue()
  }

  public getExtraScreenshotQueue(): string[] {
    return this.screenshotHelper.getExtraScreenshotQueue()
  }

  // Window management methods
  public createWindow(): void {
    this.windowHelper.createWindow()
  }

  public hideMainWindow(): void {
    this.windowHelper.hideMainWindow()
  }

  public showMainWindow(): void {
    this.windowHelper.showMainWindow()
  }

  public toggleMainWindow(): void {
    console.log(
      "Screenshots: ",
      this.screenshotHelper.getScreenshotQueue().length,
      "Extra screenshots: ",
      this.screenshotHelper.getExtraScreenshotQueue().length
    )
    this.windowHelper.toggleMainWindow()
  }

  public toggleQuipWindows(): void {
    if (this.isVisible() || this.sticky?.isVisible()) {
      this.restoreAssistant = this.isVisible(); this.restoreSticky = this.sticky?.isVisible() ?? false;
      this.hideMainWindow(); this.sticky?.hide();
    } else {
      if (this.restoreAssistant) this.showMainWindow();
      if (this.restoreSticky) this.sticky?.show();
    }
  }

  public setWindowDimensions(width: number, height: number): void {
    this.windowHelper.setWindowDimensions(width, height)
  }

  public setIgnoreMouseEvents(ignore: boolean): void {
    this.windowHelper.setIgnoreMouseEvents(ignore)
  }

  public startWindowDrag(): void {
    this.windowHelper.startWindowDrag()
  }

  public stopWindowDrag(): void {
    this.windowHelper.stopWindowDrag()
  }

  public clearQueues(): void {
    this.screenshotHelper.clearQueues()

    // Clear problem info
    this.problemInfo = null

    // Reset view to initial state
    this.setView("queue")
  }

  public async deleteAllScreenshotFiles(): Promise<void> {
    return this.screenshotHelper.deleteAllScreenshotFiles()
  }

  // Screenshot management methods
  public async takeScreenshot(): Promise<string> {
    if (!this.getMainWindow()) throw new Error("No main window available")

    const screenshotPath = await this.screenshotHelper.takeScreenshot(
      () => this.hideMainWindow(),
      () => this.showMainWindow()
    )

    return screenshotPath
  }

  public async getImagePreview(filepath: string): Promise<string> {
    return this.screenshotHelper.getImagePreview(filepath)
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.screenshotHelper.deleteScreenshot(path)
  }

  // New methods to move the window
  public moveWindowLeft(): void {
    this.windowHelper.moveWindowLeft()
  }

  public moveWindowRight(): void {
    this.windowHelper.moveWindowRight()
  }
  public moveWindowDown(): void {
    this.windowHelper.moveWindowDown()
  }
  public moveWindowUp(): void {
    this.windowHelper.moveWindowUp()
  }

  public centerAndShowWindow(): void {
    this.windowHelper.centerAndShowWindow()
  }

  public setWindowOpacity(value: number): void {
    this.windowHelper.setOpacity(value)
  }

  /**
   * Registered by ipcHandlers once the coordinator exists. Kept here so the
   * global kill-switch shortcut can abort a run directly in main, instead of
   * asking a renderer that may be hidden or wedged.
   */
  public registerAutopilot(controls: AutopilotControls): void {
    this.autopilot = controls
  }

  /**
   * Registered by ipcHandlers so quitting always tears the remote server down.
   * A listening socket that outlives the window would leave the machine
   * reachable from the network with no UI left to switch it off.
   */
  public registerRemoteShutdown(shutdown: () => Promise<void>): void {
    this.remoteShutdown = shutdown
  }

  public async shutdownRemote(): Promise<void> {
    await this.remoteShutdown?.()
  }

  /**
   * Registered by ipcHandlers so the abort shortcut can also revoke a phone's
   * permission to type here. Autopilot's kill switch stops a run that Quip
   * started; this stops a person holding a phone, which the keyboard shortcut
   * would otherwise be powerless against.
   */
  public registerRemoteInputKillSwitch(disable: () => void): void {
    this.remoteInputKillSwitch = disable
  }

  public disableRemoteInput(): void {
    this.remoteInputKillSwitch?.()
  }

  public abortAutopilot(): void {
    if (this.companion) { void this.companion.tasks.stop(); return }
    this.autopilot?.stop()
  }

  public isAutopilotRunning(): boolean {
    return this.autopilot?.isRunning() ?? false
  }

  /** Approve the step autopilot is currently paused on, if any. */
  public confirmAutopilotStep(): boolean {
    if (!this.autopilot?.isAwaitingConfirmation()) {
      return false
    }
    this.autopilot.confirm()
    return true
  }

  public applyTeachingResult(result: TeachingResult): void {
    if (result.state === "step") {
      this.teachingOverlayHelper.showTarget(result)
      return
    }
    this.teachingOverlayHelper.clear()
  }

  public clearTeachingOverlay(): void {
    this.teachingOverlayHelper.clear()
  }

  public closeTeachingOverlay(): void {
    this.teachingOverlayHelper.close()
  }

  public teachingOverlayReady(renderer: WebContents): boolean {
    return this.teachingOverlayHelper.rendererReady(renderer)
  }

  public createTray(): void {
    // Create a simple tray icon
    const image = nativeImage.createEmpty()
    
    // Try to use a system template image for better integration
    let trayImage = image
    try {
      // Create a minimal icon - just use an empty image and set the title
      trayImage = nativeImage.createFromBuffer(Buffer.alloc(0))
    } catch (error) {
      console.log("Using empty tray image")
      trayImage = nativeImage.createEmpty()
    }
    
    this.tray = new Tray(trayImage)
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Quip',
        click: () => {
          this.showMainWindow()
        }
      },
      { label: 'Saved work and documents', click: () => this.openWorkspace?.() },
      { label: 'Show Today sticky note', click: () => this.sticky?.show() },
      { label: 'Stop / take over', click: () => this.abortAutopilot() },
      {
        label: 'Toggle Window',
        click: () => {
          this.toggleMainWindow()
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Take Screenshot (Cmd+H)',
        click: async () => {
          try {
            const screenshotPath = await this.takeScreenshot()
            const preview = await this.getImagePreview(screenshotPath)
            const mainWindow = this.getMainWindow()
            if (mainWindow) {
              mainWindow.webContents.send("screenshot-taken", {
                path: screenshotPath,
                preview
              })
            }
          } catch (error) {
            console.error("Error taking screenshot from tray:", error)
          }
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        accelerator: 'Command+Q',
        click: () => {
          app.quit()
        }
      }
    ])
    
    this.tray.setToolTip('Quip - Press Cmd+Shift+Space to show')
    this.tray.setContextMenu(contextMenu)
    
    // Set a title for macOS (will appear in menu bar)
    if (process.platform === 'darwin') {
      this.tray.setTitle('Quip')
    }
    
    // Double-click to show window (restore last position, don't recenter)
    this.tray.on('double-click', () => {
      this.showMainWindow()
    })
  }

  public setHasDebugged(value: boolean): void {
    this.hasDebugged = value
  }

  public getHasDebugged(): boolean {
    return this.hasDebugged
  }
}

// One desktop controller and one workspace service are shared by both surfaces.
async function initializeApp() {
  if (!app.isPackaged && process.env.QUIP_E2E_USER_DATA) app.setPath("userData", process.env.QUIP_E2E_USER_DATA)
  if (!app.requestSingleInstanceLock()) { app.quit(); return }
  await app.whenReady()
  const appState = AppState.getInstance()
  appState.sticky = new TodayStickyWindow()
  const workspace = await initializeWorkspaceApp({ extraWindows: () => { const window = appState.sticky?.getWindow(); return window ? [window] : []; }, overlay: () => appState.getMainWindow(), toggleOverlay: () => appState.toggleMainWindow() })
  if (!workspace) throw new Error("Workspace service could not start")
  appState.openWorkspace = workspace.showWorkspace
  const bridge = initializeIpcHandlers(appState)
  appState.companion = new CompanionRuntime(workspace.service, appState.processingHelper.getLLMHelper(), workspace.windows, bridge, () => appState.showMainWindow(), appState.sticky)
  await appState.companion.initialize()
  watchDisplayTopology()
  appState.createWindow()
  appState.createTray()
  appState.shortcutsHelper.registerGlobalShortcuts()
  app.on("activate", () => appState.showMainWindow())
  app.on("second-instance", () => appState.showMainWindow())
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit() })
  let quitting = false
  app.on("before-quit", event => {
    if (quitting) return
    event.preventDefault(); quitting = true
    void (async () => {
      globalShortcut.unregisterAll()
      appState.sticky?.close()
      await appState.companion?.dispose()
      appState.closeTeachingOverlay()
      await appState.shutdownRemote()
      await appState.deleteAllScreenshotFiles()
    })().catch(error => console.error("Quip shutdown:", error.message)).finally(() => app.quit())
  })
  if (isInvisibleMode()) app.dock?.hide()
}
initializeApp().catch(error => { console.error("Quip startup failed:", error.message); app.quit() })
