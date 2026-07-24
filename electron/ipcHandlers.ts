// ipcHandlers.ts

import { ipcMain, app } from "electron"
import fs from "node:fs"
import path from "node:path"
import { AppState } from "./main"
import {
  TeachingOperationInProgressError,
  TeachingSessionCoordinator
} from "./teaching"
import { InputAutomationHelper } from "./InputAutomationHelper"
import { ensureAccessibilityPermission } from "./accessibility"
import {
  PRIVACY_ACKNOWLEDGEMENT_TEXT,
  PRIVACY_ACKNOWLEDGEMENT_VERSION,
  type PrivacyGateStatus
} from "./privacyContract"
import { PrivacyAcknowledgementStore } from "./privacyAcknowledgement"
import { evaluatePrivacyGate } from "./privacyGate"
import { PrivacyPreflightChecker } from "./privacyPreflight"
import { createElectronPrivacyPreflightDependencies } from "./privacyPreflightRuntime"
import { PrivacyPreflightSessionState } from "./privacyPreflightSession"

export function initializeIpcHandlers(appState: AppState): void {
  const inputAutomation = new InputAutomationHelper()
  const teachingSession = new TeachingSessionCoordinator({
    capture: () => appState.getScreenshotHelper().captureForTeaching(),
    generate: (goal, history, screenshotPath, imageSize) =>
      appState.processingHelper
        .getLLMHelper()
        .generateTeachingStep(goal, history, screenshotPath, imageSize),
    remove: (screenshotPath) => fs.promises.unlink(screenshotPath),
    actuate: async (actuation) => {
      // Input control needs macOS Accessibility permission (≠ Screen Recording).
      ensureAccessibilityPermission()
      // Click the target first; for "type" that also focuses the field.
      await inputAutomation.clickAt(actuation.point)
      if (actuation.action === "type" && actuation.text) {
        await inputAutomation.typeText(actuation.text)
      }
    }
  })
  let teachingLifecycle = 0

  const privacyAcknowledgementStore = new PrivacyAcknowledgementStore(
    path.join(app.getPath("userData"), "privacy-acknowledgement.json"),
    {
      readFile: (filePath) => fs.promises.readFile(filePath, "utf8"),
      writeFile: (filePath, contents) =>
        fs.promises.writeFile(filePath, contents, "utf8"),
      now: () => new Date()
    }
  )
  const privacyPreflightSession = new PrivacyPreflightSessionState()
  const privacyPreflightChecker = new PrivacyPreflightChecker(
    createElectronPrivacyPreflightDependencies(appState.getScreenshotHelper())
  )

  async function getPrivacyGateStatus(): Promise<PrivacyGateStatus> {
    return {
      acknowledged: await privacyAcknowledgementStore.isAcknowledged(),
      acknowledgementText: PRIVACY_ACKNOWLEDGEMENT_TEXT,
      acknowledgementVersion: PRIVACY_ACKNOWLEDGEMENT_VERSION,
      preflightPassed: privacyPreflightSession.hasPassed(),
      lastPreflightResult: privacyPreflightSession.getLastResult()
    }
  }

  ipcMain.handle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (width && height) {
        appState.setWindowDimensions(width, height)
      }
    }
  )

  ipcMain.handle(
    "set-ignore-mouse-events",
    async (_event, ignore: boolean) => {
      appState.setIgnoreMouseEvents(Boolean(ignore))
    }
  )

  // Manual grip drag — the renderer only signals the gesture boundaries; main
  // follows the OS cursor in between (see WindowHelper.startWindowDrag).
  ipcMain.handle("window-drag-start", async () => {
    appState.startWindowDrag()
  })

  ipcMain.handle("window-drag-end", async () => {
    appState.stopWindowDrag()
  })

  ipcMain.handle("delete-screenshot", async (event, path: string) => {
    return appState.deleteScreenshot(path)
  })

  ipcMain.handle("take-screenshot", async () => {
    try {
      const screenshotPath = await appState.takeScreenshot()
      const preview = await appState.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      console.error("Error taking screenshot:", error)
      throw error
    }
  })

  ipcMain.handle("get-screenshots", async () => {
    console.log({ view: appState.getView() })
    try {
      let previews = []
      if (appState.getView() === "queue") {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      }
      previews.forEach((preview: any) => console.log(preview.path))
      return previews
    } catch (error) {
      console.error("Error getting screenshots:", error)
      throw error
    }
  })

  ipcMain.handle("toggle-window", async () => {
    appState.toggleMainWindow()
  })

  ipcMain.handle("reset-queues", async () => {
    try {
      appState.clearQueues()
      console.log("Screenshot queues have been cleared.")
      return { success: true }
    } catch (error: any) {
      console.error("Error resetting queues:", error)
      return { success: false, error: error.message }
    }
  })

  // IPC handler for analyzing audio from base64 data
  ipcMain.handle("analyze-audio-base64", async (event, data: string, mimeType: string) => {
    try {
      const result = await appState.processingHelper.processAudioBase64(data, mimeType)
      return result
    } catch (error: any) {
      console.error("Error in analyze-audio-base64 handler:", error)
      throw error
    }
  })

  // IPC handler for analyzing audio from file path
  ipcMain.handle("analyze-audio-file", async (event, path: string) => {
    try {
      const result = await appState.processingHelper.processAudioFile(path)
      return result
    } catch (error: any) {
      console.error("Error in analyze-audio-file handler:", error)
      throw error
    }
  })

  // IPC handler for analyzing image from file path
  ipcMain.handle("analyze-image-file", async (event, path: string) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().analyzeImageFile(path)
      return result
    } catch (error: any) {
      console.error("Error in analyze-image-file handler:", error)
      throw error
    }
  })

  ipcMain.handle("gemini-chat", async (event, message: string) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().chatWithGemini(message);
      return result;
    } catch (error: any) {
      console.error("Error in gemini-chat handler:", error);
      throw error;
    }
  });

  // Chat that includes a screenshot of the active display (📸 toggle)
  ipcMain.handle("chat-with-screen", async (event, message: string) => {
    let shot: string | undefined
    try {
      shot = await appState.getScreenshotHelper().captureForChat()
      return await appState.processingHelper.getLLMHelper().chatWithImage(message, [shot])
    } catch (error: any) {
      console.error("Error in chat-with-screen handler:", error)
      throw error
    } finally {
      if (shot) fs.promises.unlink(shot).catch(() => {})
    }
  });

  ipcMain.handle("privacy-get-status", async () => getPrivacyGateStatus())

  ipcMain.handle("privacy-acknowledge", async () => {
    await privacyAcknowledgementStore.acknowledge()
    return getPrivacyGateStatus()
  })

  ipcMain.handle("privacy-run-preflight", async () => {
    const result = await privacyPreflightChecker.run()
    privacyPreflightSession.recordResult(result)
    return result
  })

  ipcMain.handle("teach-start", async (_, goal: string) => {
    const gate = evaluatePrivacyGate(await getPrivacyGateStatus())
    if (!gate.canStart) {
      throw new Error(
        gate.blockingReason === "acknowledgement"
          ? "Privacy acknowledgement required before teaching. Acknowledge the privacy notice, then try again."
          : "Privacy preflight check required before teaching. Run the privacy check, then try again."
      )
    }

    const lifecycle = ++teachingLifecycle
    appState.closeTeachingOverlay()
    try {
      const result = await teachingSession.start(goal)
      if (lifecycle === teachingLifecycle) {
        appState.applyTeachingResult(result)
      }
      return result
    } catch (error) {
      if (lifecycle === teachingLifecycle) {
        appState.closeTeachingOverlay()
      }
      throw error
    }
  })

  ipcMain.handle("teach-next", async () => {
    const lifecycle = teachingLifecycle
    try {
      const result = await teachingSession.next()
      if (lifecycle === teachingLifecycle) {
        appState.applyTeachingResult(result)
      }
      return result
    } catch (error) {
      if (
        lifecycle === teachingLifecycle &&
        !(error instanceof TeachingOperationInProgressError)
      ) {
        appState.closeTeachingOverlay()
      }
      throw error
    }
  })

  // Perform the confirmed action for the current step, then advance. Unlike
  // teach-next, a failure (e.g. Accessibility not yet granted) leaves the
  // overlay in place so the user can grant permission and press execute again.
  ipcMain.handle("teach-execute", async () => {
    const lifecycle = teachingLifecycle
    const result = await teachingSession.execute()
    if (lifecycle === teachingLifecycle) {
      appState.applyTeachingResult(result)
    }
    return result
  })

  ipcMain.handle("teach-stop", () => {
    teachingLifecycle += 1
    teachingSession.stop()
    appState.closeTeachingOverlay()
    return { success: true }
  })

  ipcMain.handle("teaching-overlay-ready", (event) => {
    return appState.teachingOverlayReady(event.sender)
  })

  ipcMain.handle("set-window-opacity", async (_, value: number) => {
    appState.setWindowOpacity(value)
  });

  // Swap the active AI mode/persona (system prompt)
  ipcMain.handle("set-system-prompt", async (_, text: string) => {
    appState.processingHelper.getLLMHelper().setSystemPrompt(text)
  });

  ipcMain.handle("quit-app", () => {
    app.quit()
  })

  // Window movement handlers
  ipcMain.handle("move-window-left", async () => {
    appState.moveWindowLeft()
  })

  ipcMain.handle("move-window-right", async () => {
    appState.moveWindowRight()
  })

  ipcMain.handle("move-window-up", async () => {
    appState.moveWindowUp()
  })

  ipcMain.handle("move-window-down", async () => {
    appState.moveWindowDown()
  })

  ipcMain.handle("center-and-show-window", async () => {
    appState.centerAndShowWindow()
  })

  // LLM Model Management Handlers
  ipcMain.handle("get-current-llm-config", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModel(),
        isOllama: llmHelper.isUsingOllama()
      };
    } catch (error: any) {
      console.error("Error getting current LLM config:", error);
      throw error;
    }
  });

  ipcMain.handle("get-available-ollama-models", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const models = await llmHelper.getOllamaModels();
      return models;
    } catch (error: any) {
      console.error("Error getting Ollama models:", error);
      throw error;
    }
  });

  ipcMain.handle("switch-to-ollama", async (_, model?: string, url?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToOllama(model, url);
      return { success: true };
    } catch (error: any) {
      console.error("Error switching to Ollama:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("switch-to-gemini", async (_, apiKey?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToGemini(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error switching to Gemini:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("test-llm-connection", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const result = await llmHelper.testConnection();
      return result;
    } catch (error: any) {
      console.error("Error testing LLM connection:", error);
      return { success: false, error: error.message };
    }
  });
}
