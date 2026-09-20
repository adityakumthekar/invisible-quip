import { globalShortcut, app } from "electron"
import { AppState } from "./main"
import { prewarmChatCapture } from "./chatCapturePrewarm"
import { GLOBAL_ACCELERATORS } from "./shortcutTable"

export class ShortcutsHelper {
  private appState: AppState

  constructor(appState: AppState) {
    this.appState = appState
  }

  public registerGlobalShortcuts(): void {
    // Add global shortcut to show window (restore last position, don't recenter)
    globalShortcut.register("CommandOrControl+Shift+Space", () => {
      console.log("Show window shortcut pressed...")
      this.appState.showMainWindow()
    })

    globalShortcut.register("CommandOrControl+H", async () => {
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow) {
        console.log("Taking screenshot...")
        try {
          const screenshotPath = await this.appState.takeScreenshot()
          const preview = await this.appState.getImagePreview(screenshotPath)
          mainWindow.webContents.send("screenshot-taken", {
            path: screenshotPath,
            preview
          })
        } catch (error) {
          console.error("Error capturing screenshot:", error)
        }
      }
    })

    // Ask AI. Capture-and-analyze is the default action, so this works from a
    // cold start with nothing queued. The renderer owns the chat state, so it
    // does the capture (via the existing chat-with-screen path) and we only
    // signal it — same shape as the teaching hotkeys below.
    globalShortcut.register("CommandOrControl+Enter", () => {
      const mainWindow = this.appState.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (!this.appState.isVisible()) {
        this.appState.showMainWindow()
      }
      // Start capturing before the renderer has even heard about the keypress,
      // so the capture overlaps the IPC round trip instead of following it.
      prewarmChatCapture(() =>
        this.appState.getScreenshotHelper().captureForChatBuffer()
      )
      mainWindow.webContents.send("ask-ai-hotkey")
    })

    // Toggling the mic must work with the overlay hidden, so reveal it first —
    // otherwise a recording starts with no visible indicator that it is running.
    // Registration is checked below: if another app already owns the chord the
    // binding silently does nothing.
    globalShortcut.register(GLOBAL_ACCELERATORS.RECORD, () => {
      console.log("Record shortcut pressed. Toggling the mic.")
      const mainWindow = this.appState.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (!this.appState.isVisible()) {
        this.appState.showMainWindow()
      }
      mainWindow.webContents.send("record-hotkey")
    })
    if (!globalShortcut.isRegistered(GLOBAL_ACCELERATORS.RECORD)) {
      console.warn(
        `[Shortcuts] Could not register ${GLOBAL_ACCELERATORS.RECORD} for recording — another app owns it.`
      )
    }

    globalShortcut.register("CommandOrControl+R", () => {
      console.log(
        "Command + R pressed. Canceling requests and resetting queues..."
      )

      // Cancel ongoing API requests
      this.appState.processingHelper.cancelOngoingRequests()

      // Clear both screenshot queues
      this.appState.clearQueues()

      console.log("Cleared queues.")

      // Update the view state to 'queue'
      this.appState.setView("queue")

      // Notify renderer process to switch view to 'queue'
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("reset-view")
      }
    })

    // Chat-only reset. Unlike ⌘R above, this leaves the screenshot queue, the
    // view, and the mode alone — it exists so the model's context can be dropped
    // mid-session without tearing down everything else. The renderer owns the
    // transcript, so we only signal it.
    globalShortcut.register(GLOBAL_ACCELERATORS.NEW_CHAT, () => {
      const mainWindow = this.appState.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (!this.appState.isVisible()) {
        this.appState.showMainWindow()
      }
      mainWindow.webContents.send("new-chat-hotkey")
    })
    if (!globalShortcut.isRegistered(GLOBAL_ACCELERATORS.NEW_CHAT)) {
      console.warn(
        `[Shortcuts] Could not register ${GLOBAL_ACCELERATORS.NEW_CHAT} for new chat — another app owns it.`
      )
    }

    // New shortcuts for moving the window
    globalShortcut.register("CommandOrControl+Left", () => {
      console.log("Command/Ctrl + Left pressed. Moving window left.")
      this.appState.moveWindowLeft()
    })

    globalShortcut.register("CommandOrControl+Right", () => {
      console.log("Command/Ctrl + Right pressed. Moving window right.")
      this.appState.moveWindowRight()
    })
    globalShortcut.register("CommandOrControl+Down", () => {
      console.log("Command/Ctrl + down pressed. Moving window down.")
      this.appState.moveWindowDown()
    })
    globalShortcut.register("CommandOrControl+Up", () => {
      console.log("Command/Ctrl + Up pressed. Moving window Up.")
      this.appState.moveWindowUp()
    })

    globalShortcut.register("CommandOrControl+B", () => {
      this.appState.toggleQuipWindows()
      // If window exists and we're showing it, bring it to front
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow && !this.appState.isVisible()) {
        // Force the window to the front on macOS
        if (process.platform === "darwin") {
          mainWindow.setAlwaysOnTop(true, "normal")
          // Reset alwaysOnTop after a brief delay
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setAlwaysOnTop(true, "floating")
            }
          }, 100)
        }
      }
    })

    // Perform the highlighted action. During an autopilot run this approves the
    // step it paused on, which main owns directly; otherwise it signals the
    // renderer, which owns manual teaching state. A no-op when nothing is
    // showing.
    globalShortcut.register("CommandOrControl+Shift+Return", () => {
      if (this.appState.confirmAutopilotStep()) {
        return
      }
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("teaching-hotkey", "execute")
      }
    })

    // Hard kill switch. Works even when focus is in another app. Aborts in main
    // FIRST so a hidden or wedged renderer can never delay stopping a run that
    // is actively driving the mouse.
    //
    // It also revokes a paired phone's permission to type here. Stopping the
    // autopilot alone would leave a remote hand still on the keyboard, which is
    // not what anyone reaching for this shortcut means by "stop".
    globalShortcut.register("CommandOrControl+Shift+Backspace", () => {
      this.appState.abortAutopilot()
      this.appState.disableRemoteInput()
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("teaching-hotkey", "abort")
      }
    })

    // Unregister shortcuts when quitting
    app.on("will-quit", () => {
      globalShortcut.unregisterAll()
    })
  }
}
