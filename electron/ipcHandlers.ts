// ipcHandlers.ts

import { ipcMain, app } from "electron"
import fs from "node:fs"
import path from "node:path"
import { AppState } from "./main"
import { claimChatCapture } from "./chatCapturePrewarm"
import { activeChatStreams } from "./chatStreams"
import { ChatTurn } from "./chatHistory"
import {
  TeachingOperationInProgressError,
  TeachingSessionCoordinator
} from "./teaching"
import {
  DEFAULT_FOCUS_SETTLE_MS,
  InputAutomationHelper
} from "./InputAutomationHelper"
import { ensureAccessibilityPermission } from "./accessibility"
import {
  AUTOPILOT_CONSENT_TEXT,
  AUTOPILOT_CONSENT_VERSION,
  PRIVACY_ACKNOWLEDGEMENT_TEXT,
  PRIVACY_ACKNOWLEDGEMENT_VERSION,
  type PrivacyGateStatus
} from "./privacyContract"
import { AutopilotCoordinator, type AutopilotUpdate } from "./autopilot"
import {
  getFrontmostApp,
  isFrontmostAppProbeSupported
} from "./frontmostApp"
import {
  describeAutonomyLevel,
  parseAutonomyLevel,
  type AutonomyLevel,
  type AutopilotProvider
} from "./autopilotPolicy"
import { AutonomyStore } from "./autonomyStore"
import {
  LLM_SETTINGS_FILENAME,
  LlmSettingsStore,
  type LlmSettings,
  type StoredProvider
} from "./llmSettingsStore"
import { PrivacyAcknowledgementStore } from "./privacyAcknowledgement"
import { isInvisibleMode } from "./invisibleMode"
import { evaluatePrivacyGate } from "./privacyGate"
import { PrivacyPreflightChecker } from "./privacyPreflight"
import { createElectronPrivacyPreflightDependencies } from "./privacyPreflightRuntime"
import { PrivacyPreflightSessionState } from "./privacyPreflightSession"

export function initializeIpcHandlers(appState: AppState): void {
  const inputAutomation = new InputAutomationHelper()

  /**
   * Hand keyboard focus back to the app being driven.
   *
   * Approving a step means clicking Quip's panel, and Quip's window is
   * focusable — so at actuation time Quip itself holds keyboard focus and any
   * keystrokes we send land there instead of the target app. Quip has no
   * focused input during a run, so they vanish with no error at all. Blurring
   * returns focus to the previously active application, which is the one the
   * user was driving.
   */
  async function releaseKeyboardFocus(): Promise<void> {
    const mainWindow = appState.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFocused()) {
      return
    }
    mainWindow.blur()
    await new Promise((resolve) =>
      setTimeout(resolve, DEFAULT_FOCUS_SETTLE_MS)
    )
  }
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
      await releaseKeyboardFocus()

      switch (actuation.action) {
        case "click":
          await inputAutomation.clickAt(actuation.point)
          return
        case "double-click":
          await inputAutomation.doubleClickAt(actuation.point)
          return
        case "right-click":
          await inputAutomation.rightClickAt(actuation.point)
          return
        case "type":
          // Click the target, then wait for focus to actually land there
          // before typing — see InputAutomationHelper.clickThenType.
          await inputAutomation.clickThenType(
            actuation.point,
            actuation.text ?? ""
          )
          return
        case "scroll":
          if (actuation.scroll) {
            await inputAutomation.scrollAt(
              actuation.point,
              actuation.scroll.direction,
              actuation.scroll.amount
            )
          }
          return
        case "key":
          if (actuation.key) {
            await inputAutomation.pressKey(actuation.key)
          }
          return
        case "drag":
          if (actuation.to) {
            await inputAutomation.dragTo(actuation.point, actuation.to)
          }
          return
        case "wait":
          // Nothing to actuate; the coordinator supplies the pause.
          return
      }
    }
  })
  let teachingLifecycle = 0

  // Constructed before the coordinator, which reads its cached level at the
  // start of every run. `load()` fills that cache from disk; until it resolves
  // the store reports the default, so an early run is never *looser* than the
  // stored setting by accident.
  const autonomyStore = new AutonomyStore(
    path.join(app.getPath("userData"), "autopilot-autonomy.json"),
    {
      readFile: (filePath) => fs.promises.readFile(filePath, "utf8"),
      writeFile: (filePath, contents) =>
        fs.promises.writeFile(filePath, contents, "utf8"),
      now: () => new Date()
    }
  )
  void autonomyStore.load()

  const autopilot = new AutopilotCoordinator({
    session: {
      start: (goal) => teachingSession.start(goal),
      next: () => teachingSession.next(),
      actuatePending: () => teachingSession.actuatePending(),
      noteHistory: (entry) => teachingSession.noteHistory(entry),
      stop: () => teachingSession.stop()
    },
    getProvider: (): AutopilotProvider =>
      appState.processingHelper.getLLMHelper().getCurrentProvider(),
    getAutonomy: (): AutonomyLevel => autonomyStore.getLevel(),
    showTarget: (step) => appState.applyTeachingResult(step),
    clearTarget: () => appState.clearTeachingOverlay(),
    emit: (update: AutopilotUpdate) => {
      const mainWindow = appState.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("autopilot-update", update)
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    getFrontmostApp: (fresh) => getFrontmostApp(fresh),
    appProbeSupported: isFrontmostAppProbeSupported()
  })

  // Lets the global kill-switch shortcut abort without routing through the
  // renderer, which may be hidden or busy.
  appState.registerAutopilot({
    stop: () => autopilot.stop(),
    confirm: () => autopilot.confirm(),
    isAwaitingConfirmation: () => autopilot.isAwaitingConfirmation(),
    isRunning: () => autopilot.isRunning()
  })

  const autopilotConsentStore = new PrivacyAcknowledgementStore(
    path.join(app.getPath("userData"), "autopilot-consent.json"),
    {
      readFile: (filePath) => fs.promises.readFile(filePath, "utf8"),
      writeFile: (filePath, contents) =>
        fs.promises.writeFile(filePath, contents, "utf8"),
      now: () => new Date()
    },
    AUTOPILOT_CONSENT_VERSION
  )

  async function getAutopilotConsent() {
    return {
      consented: await autopilotConsentStore.isAcknowledged(),
      text: AUTOPILOT_CONSENT_TEXT,
      version: AUTOPILOT_CONSENT_VERSION
    }
  }

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
      lastPreflightResult: privacyPreflightSession.getLastResult(),
      visibleMode: !isInvisibleMode()
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

  // Runs the queued-screenshot solver. Cmd+Enter no longer routes here — it
  // captures and analyzes the current screen instead — so this is reached only
  // from the Solve button, which appears once the Cmd+H queue is non-empty.
  ipcMain.handle("process-screenshot-queue", async () => {
    await appState.processingHelper.processScreenshots()
  })

  ipcMain.handle("get-screenshots", async () => {
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
  ipcMain.handle("analyze-audio-base64", async (event, data: string, mimeType: string, history: ChatTurn[] = []) => {
    try {
      const result = await appState.processingHelper.processAudioBase64(data, mimeType, history)
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

  // Streaming chat. The non-streaming handlers above stay for the solve/debug
  // path; these exist so the user sees words appear instead of a spinner that
  // holds for the whole round trip.
  const runChatStream = async (
    event: Electron.IpcMainInvokeEvent,
    requestId: string,
    run: (onChunk: (delta: string) => void, signal: AbortSignal) => Promise<string>
  ) => {
    const controller = new AbortController()
    activeChatStreams.set(requestId, controller)
    const send = (channel: string, payload: unknown) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, payload)
    }
    // Time-to-first-token is the number that decides whether this feels fast,
    // so log it rather than guessing.
    const startedAt = Date.now()
    let sawFirstChunk = false
    try {
      const text = await run((delta) => {
        if (controller.signal.aborted) return
        if (!sawFirstChunk) {
          sawFirstChunk = true
          console.log(`[chat] first chunk in ${Date.now() - startedAt}ms`)
        }
        send("chat-stream-chunk", { requestId, delta })
      }, controller.signal)
      if (!controller.signal.aborted) {
        send("chat-stream-done", { requestId, text })
      }
      return text
    } catch (error: any) {
      if (!controller.signal.aborted) {
        send("chat-stream-error", { requestId, message: String(error?.message ?? error) })
      }
      throw error
    } finally {
      activeChatStreams.delete(requestId)
    }
  }

  ipcMain.handle(
    "gemini-chat-stream",
    async (
      event,
      requestId: string,
      message: string,
      history: ChatTurn[] = []
    ) =>
      runChatStream(event, requestId, (onChunk, signal) =>
        appState.processingHelper
          .getLLMHelper()
          .chatWithGeminiStream(message, onChunk, signal, history)
      )
  )

  ipcMain.handle(
    "chat-with-screen-stream",
    async (
      event,
      requestId: string,
      message: string,
      history: ChatTurn[] = []
    ) =>
      runChatStream(event, requestId, async (onChunk, signal) => {
        // Cmd+Enter parks a capture before signalling the renderer; claim it if
        // it is still fresh rather than paying for a second one.
        const prewarmed = claimChatCapture()
        const shot = prewarmed
          ? await prewarmed
          : await appState.getScreenshotHelper().captureForChatBuffer()
        return appState.processingHelper
          .getLLMHelper()
          .chatWithImageStream(message, [shot], onChunk, signal, history)
      })
  )

  ipcMain.handle(
    "analyze-image-file-stream",
    async (event, requestId: string, imagePath: string) =>
      runChatStream(event, requestId, (onChunk, signal) =>
        appState.processingHelper
          .getLLMHelper()
          .analyzeImageFileStream(imagePath, onChunk, signal)
      )
  )

  ipcMain.handle("cancel-chat-stream", async (_event, requestId: string) => {
    activeChatStreams.get(requestId)?.abort()
    activeChatStreams.delete(requestId)
  })

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
    autopilot.stop()
    teachingSession.stop()
    appState.closeTeachingOverlay()
    return { success: true }
  })

  ipcMain.handle("autopilot-get-consent", async () => getAutopilotConsent())

  ipcMain.handle("autopilot-acknowledge-consent", async () => {
    await autopilotConsentStore.acknowledge()
    return getAutopilotConsent()
  })

  ipcMain.handle("autopilot-get-autonomy", async () => {
    const level = await autonomyStore.load()
    return { level, description: describeAutonomyLevel(level) }
  })

  ipcMain.handle("autopilot-set-autonomy", async (_, level: unknown) => {
    // Validated here rather than trusted from the renderer: this widens what a
    // run may do without asking, so an unrecognised value must fail loudly
    // instead of falling through to some default.
    const parsed = parseAutonomyLevel(level)
    if (parsed === null) {
      throw new Error(`Unknown autonomy level: ${String(level)}`)
    }

    // Changing the envelope mid-run would apply on the next step but not this
    // one, which reads worse than simply not allowing it.
    if (autopilot.isRunning()) {
      throw new Error("Stop the current autopilot run before changing this.")
    }

    await autonomyStore.setLevel(parsed)
    return { level: parsed, description: describeAutonomyLevel(parsed) }
  })

  // Kicks off the unattended loop. Resolves as soon as the run is under way —
  // progress arrives on the "autopilot-update" channel, because a run can last
  // minutes and must stay interruptible.
  ipcMain.handle(
    "autopilot-start",
    async (_, goal: string, options?: { maxSteps?: number }) => {
      const gate = evaluatePrivacyGate(await getPrivacyGateStatus())
      if (!gate.canStart) {
        throw new Error(
          gate.blockingReason === "acknowledgement"
            ? "Privacy acknowledgement required before autopilot. Acknowledge the privacy notice, then try again."
            : "Privacy preflight check required before autopilot. Run the privacy check, then try again."
        )
      }

      const consent = await getAutopilotConsent()
      if (!consent.consented) {
        throw new Error(
          "Autopilot consent required. Review and accept the autopilot notice, then try again."
        )
      }

      // Autopilot and manual teaching share one session; starting either ends
      // the other so two loops can never drive the cursor at once.
      teachingLifecycle += 1
      appState.closeTeachingOverlay()

      const provider: AutopilotProvider = appState.processingHelper
        .getLLMHelper()
        .getCurrentProvider()

      void autopilot.start(goal, provider, options ?? {}).catch((error) => {
        console.error("Autopilot run failed to start:", error)
      })

      return { started: true, maxSteps: autopilot.getMaxSteps() }
    }
  )

  ipcMain.handle("autopilot-confirm", () => {
    autopilot.confirm()
    return { success: true }
  })

  ipcMain.handle("autopilot-reject", () => {
    autopilot.reject()
    return { success: true }
  })

  ipcMain.handle("autopilot-stop", () => {
    autopilot.stop()
    return { success: true }
  })

  ipcMain.handle("ollama-model-capabilities", async (_, model: string) => {
    return appState.processingHelper
      .getLLMHelper()
      .getOllamaModelCapabilities(model)
  })

  ipcMain.handle("ollama-pull-model", async (event, model: string) => {
    try {
      await appState.processingHelper
        .getLLMHelper()
        .pullOllamaModel(model, (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("ollama-pull-progress", { model, ...progress })
          }
        })
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message ?? String(error) }
    }
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
  //
  // The record holds API keys, so it is written 0600 and never handed back to
  // the renderer — get-current-llm-config below returns the provider, model and
  // URL only.
  const llmSettingsStore = new LlmSettingsStore(
    path.join(app.getPath("userData"), LLM_SETTINGS_FILENAME),
    {
      readFile: (filePath) => fs.promises.readFile(filePath, "utf8"),
      writeFile: (filePath, contents) =>
        fs.promises.writeFile(filePath, contents, { encoding: "utf8", mode: 0o600 })
    }
  )

  async function persistLlmChoice(
    provider: StoredProvider,
    details: Pick<LlmSettings, "qwen" | "gemini" | "ollama">
  ): Promise<void> {
    try {
      await llmSettingsStore.save(provider, details)
    } catch (error) {
      // A read-only userData shouldn't undo a switch the user just made and can
      // see working; it only means it won't survive a restart.
      console.error("Could not persist the LLM provider choice:", error)
    }
  }

  ipcMain.handle("get-current-llm-config", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModel(),
        isOllama: llmHelper.isUsingOllama(),
        isQwen: llmHelper.isUsingQwen(),
        qwenBaseUrl: llmHelper.getQwenBaseUrl()
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

  ipcMain.handle("list-qwen-models", async (_, baseUrl?: string, apiKey?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper()
      return await llmHelper.listQwenModels(baseUrl, apiKey)
    } catch (error: any) {
      console.error("Error listing Qwen models:", error)
      return []
    }
  })

  ipcMain.handle("switch-to-ollama", async (_, model?: string, url?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToOllama(model, url);
      // Persisted only after the switch succeeds, so a failed one is never
      // remembered and re-applied at the next launch.
      await persistLlmChoice("ollama", { ollama: { model, url } })
      return { success: true };
    } catch (error: any) {
      console.error("Error switching to Ollama:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "switch-to-qwen",
    async (_, baseUrl?: string, model?: string, apiKey?: string) => {
      try {
        const llmHelper = appState.processingHelper.getLLMHelper()
        await llmHelper.switchToQwen(baseUrl, model, apiKey)
        await persistLlmChoice("qwen", { qwen: { baseUrl, model, apiKey } })
        return { success: true }
      } catch (error: any) {
        console.error("Error switching to Qwen:", error)
        return { success: false, error: error.message }
      }
    }
  )

  ipcMain.handle("switch-to-gemini", async (_, apiKey?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToGemini(apiKey);
      await persistLlmChoice("gemini", { gemini: { apiKey } })
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
