// ipcHandlers.ts

import { ipcMain, app, screen } from "electron"
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
  SYSTEM_AUDIO_CONSENT_TEXT,
  SYSTEM_AUDIO_CONSENT_VERSION,
  PRIVACY_ACKNOWLEDGEMENT_TEXT,
  PRIVACY_ACKNOWLEDGEMENT_VERSION,
  REMOTE_CONTROL_CONSENT_TEXT,
  REMOTE_CONTROL_CONSENT_VERSION,
  REMOTE_INPUT_CONSENT_TEXT,
  REMOTE_INPUT_CONSENT_VERSION,
  type PrivacyGateStatus
} from "./privacyContract"
import { randomBytes, randomInt, randomUUID } from "node:crypto"
import sharp from "sharp"
import { RemotePairingService, PAIRING_CODE_DIGITS } from "./remotePairing"
import { RemoteServer } from "./remoteServer"
import type { RemoteCapabilities } from "./remoteCommands"
import {
  REMOTE_PROTOCOL_VERSION,
  type NormalizedPoint,
  type RemoteEvent,
  type RemoteStatus
} from "./remoteProtocol"
import {
  INPUT_RATE_LIMIT_MESSAGE,
  resolvePoint,
  scrollDeltaToSteps,
  toRemoteDisplay,
  TokenBucket
} from "./remoteInput"
import { toDisplayDescriptor } from "./displayTopologyRuntime"
import { AutopilotCoordinator, type AutopilotUpdate } from "./autopilot"
import {
  getFrontmostApp,
  isFrontmostAppProbeSupported
} from "./frontmostApp"
import type { AutopilotProvider } from "./autopilotPolicy"
import { PrivacyAcknowledgementStore } from "./privacyAcknowledgement"
import { evaluatePrivacyGate } from "./privacyGate"
import { PrivacyPreflightChecker } from "./privacyPreflight"
import { createElectronPrivacyPreflightDependencies } from "./privacyPreflightRuntime"
import { PrivacyPreflightSessionState } from "./privacyPreflightSession"

export function initializeIpcHandlers(appState: AppState): void {
  const inputAutomation = new InputAutomationHelper()

  // Declared up front because the autopilot coordinator below closes over
  // `broadcastRemote`, and the server it forwards to is only constructed once
  // the pairing store exists. Null whenever remote access is switched off,
  // which is the default.
  let remoteServer: RemoteServer | null = null

  /** Fan out a run event to every connected phone. No-op when none are. */
  function broadcastRemote(event: RemoteEvent): void {
    remoteServer?.broadcast(event)
  }

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

  const autopilot = new AutopilotCoordinator({
    session: {
      start: (goal) => teachingSession.start(goal),
      next: () => teachingSession.next(),
      actuatePending: () => teachingSession.actuatePending(),
      noteHistory: (entry) => teachingSession.noteHistory(entry),
      stop: () => teachingSession.stop()
    },
    getProvider: (): AutopilotProvider =>
      appState.processingHelper.getLLMHelper().isUsingOllama()
        ? "ollama"
        : "gemini",
    showTarget: (step) => appState.applyTeachingResult(step),
    clearTarget: () => appState.clearTeachingOverlay(),
    emit: (update: AutopilotUpdate) => {
      const mainWindow = appState.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("autopilot-update", update)
      }
      // The desktop overlay is no longer the only subscriber: a paired phone
      // watches the same run and needs the same authoritative state.
      broadcastRemote({ type: "autopilot-update", update })

      // A phone can't see the screen the way someone sitting at the machine
      // can, so push a fresh frame at exactly the moment it is asked to
      // approve an action. Approving what you cannot see is not consent.
      if (update.phase === "awaiting-confirmation") {
        void pushScreenFrame()
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

  const systemAudioConsentStore = new PrivacyAcknowledgementStore(
    path.join(app.getPath("userData"), "system-audio-consent.json"),
    {
      readFile: (filePath) => fs.promises.readFile(filePath, "utf8"),
      writeFile: (filePath, contents) =>
        fs.promises.writeFile(filePath, contents, "utf8"),
      now: () => new Date()
    },
    SYSTEM_AUDIO_CONSENT_VERSION
  )

  async function getSystemAudioConsent() {
    return {
      consented: await systemAudioConsentStore.isAcknowledged(),
      text: SYSTEM_AUDIO_CONSENT_TEXT,
      version: SYSTEM_AUDIO_CONSENT_VERSION
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
      lastPreflightResult: privacyPreflightSession.getLastResult()
    }
  }

  // ---------------------------------------------------------------------------
  // Remote access (phone on the same Wi-Fi)
  //
  // The capability object below is the entire surface the network can reach.
  // Everything in it either observes, or goes through a path that already
  // enforces the privacy gate and autopilot consent — there is deliberately no
  // capability that drives the mouse or keyboard directly.
  // ---------------------------------------------------------------------------

  const remoteConsentStore = new PrivacyAcknowledgementStore(
    path.join(app.getPath("userData"), "remote-control-consent.json"),
    {
      readFile: (filePath) => fs.promises.readFile(filePath, "utf8"),
      writeFile: (filePath, contents) =>
        fs.promises.writeFile(filePath, contents, "utf8"),
      now: () => new Date()
    },
    REMOTE_CONTROL_CONSENT_VERSION
  )

  // Cached so `isControlEnabled` can answer synchronously on every request
  // without an fs round trip. Refreshed whenever consent changes.
  let remoteControlEnabled = false
  void remoteConsentStore.isAcknowledged().then((value) => {
    remoteControlEnabled = value
  })

  async function getRemoteConsent() {
    return {
      consented: await remoteConsentStore.isAcknowledged(),
      text: REMOTE_CONTROL_CONSENT_TEXT,
      version: REMOTE_CONTROL_CONSENT_VERSION
    }
  }

  const remoteInputConsentStore = new PrivacyAcknowledgementStore(
    path.join(app.getPath("userData"), "remote-input-consent.json"),
    {
      readFile: (filePath) => fs.promises.readFile(filePath, "utf8"),
      writeFile: (filePath, contents) =>
        fs.promises.writeFile(filePath, contents, "utf8"),
      now: () => new Date()
    },
    REMOTE_INPUT_CONSENT_VERSION
  )

  // Two separate flags on purpose. Consent is a durable "I understand what this
  // does"; the toggle is a live "and I want it on right now". The kill switch
  // flips the toggle without discarding the consent, so taking control back is
  // one keystroke and handing it over again does not mean re-reading a notice.
  let remoteInputConsented = false
  let remoteInputAllowed = false
  void remoteInputConsentStore.isAcknowledged().then((value) => {
    remoteInputConsented = value
    remoteInputAllowed = value
  })

  /** Both halves must hold before a single keystroke reaches the OS. */
  function isRemoteInputEnabled(): boolean {
    return remoteInputConsented && remoteInputAllowed
  }

  async function getRemoteInputConsent() {
    return {
      consented: await remoteInputConsentStore.isAcknowledged(),
      allowed: remoteInputAllowed,
      text: REMOTE_INPUT_CONSENT_TEXT,
      version: REMOTE_INPUT_CONSENT_VERSION
    }
  }

  /**
   * Push fresh status to every phone.
   *
   * Called whenever input is enabled or disabled, so a phone whose Stop button
   * just became its only option finds out immediately rather than on its next
   * refused tap.
   */
  function broadcastRemoteStatus(): void {
    void getRemoteStatus()
      .then((status) => broadcastRemote({ type: "status", status }))
      .catch((error) => console.error("[remote] status broadcast failed:", error))
  }

  /**
   * Revoke input without touching consent. Wired to the desktop kill switch:
   * someone who walks back to the machine takes it back in one keystroke.
   */
  function disableRemoteInput(reason: string): void {
    if (!remoteInputAllowed) {
      return
    }
    remoteInputAllowed = false
    console.log(`[remote] phone input disabled (${reason})`)
    broadcastRemoteStatus()
    notifyRemoteState()
  }

  appState.registerRemoteInputKillSwitch(() =>
    disableRemoteInput("desktop kill switch")
  )

  const remotePairing = new RemotePairingService(
    path.join(app.getPath("userData"), "remote-devices.json"),
    {
      now: () => Date.now(),
      // randomInt is uniform over the range; a modulo of randomBytes would not
      // be, and a guessable pairing code is the whole ballgame here.
      randomCode: () =>
        String(randomInt(0, 10 ** PAIRING_CODE_DIGITS)).padStart(
          PAIRING_CODE_DIGITS,
          "0"
        ),
      randomToken: () => randomBytes(32).toString("hex"),
      randomId: () => randomUUID(),
      readFile: (filePath) => fs.promises.readFile(filePath, "utf8"),
      writeFile: (filePath, contents) =>
        fs.promises.writeFile(filePath, contents, "utf8")
    }
  )

  /**
   * Capture the active display and shrink it for a phone. Full-resolution
   * screenshots are several megabytes; over Wi-Fi that turns "show me what
   * you're about to click" into a multi-second wait, so it goes out at roughly
   * phone width as a mid-quality JPEG.
   */
  async function captureRemoteFrame() {
    const capture = await appState
      .getScreenshotHelper()
      .captureDisplayBuffer(activeRemoteDisplayId)
    const resized = await sharp(capture.png)
      .resize({ width: 900, withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toBuffer({ resolveWithObject: true })

    return {
      dataUrl: `data:image/jpeg;base64,${resized.data.toString("base64")}`,
      width: resized.info.width,
      height: resized.info.height,
      capturedAt: new Date().toISOString(),
      // Stamped with the display it came from so a tap on this frame resolves
      // against the same geometry that produced it, even if the phone switches
      // displays while the frame is in flight.
      displayId: capture.displayId
    }
  }

  /**
   * Raw JPEG for the MJPEG stream, at the caller's chosen size and quality.
   *
   * Shares the pinned-display capture with `captureRemoteFrame` but skips the
   * base64 hop: at ten frames a second a data URL would add a third again to
   * every frame for a format the stream never uses.
   */
  async function captureRemoteJpeg(options: { width: number; quality: number }) {
    const capture = await appState
      .getScreenshotHelper()
      .captureDisplayBuffer(activeRemoteDisplayId)
    const jpeg = await sharp(capture.png)
      .resize({ width: options.width, withoutEnlargement: true })
      .jpeg({ quality: options.quality })
      .toBuffer()

    return { jpeg, displayId: capture.displayId }
  }

  /** Push a frame to connected phones, swallowing capture failures. */
  async function pushScreenFrame(): Promise<void> {
    if (!remoteServer || remoteServer.getInfo().connectedDevices === 0) {
      return
    }
    try {
      broadcastRemote({ type: "screen-frame", frame: await captureRemoteFrame() })
    } catch (error) {
      // A missing Screen Recording permission must not take down a run.
      console.error("[remote] screen frame failed:", error)
    }
  }

  /**
   * Which display the phone is watching and driving.
   *
   * Pinned rather than following the cursor, which is what the chat capture
   * does. Remote clicking moves the cursor, so a cursor-following stream would
   * hop to another monitor the moment you tapped near an edge — and every
   * subsequent tap would be resolved against a display you did not choose.
   */
  let activeRemoteDisplayId: number | null = null

  function listRemoteDisplays() {
    const primaryId = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((display) =>
      toRemoteDisplay(
        { ...toDisplayDescriptor(display), label: display.label },
        primaryId
      )
    )
  }

  function selectRemoteDisplay(displayId: number): void {
    if (!screen.getAllDisplays().some((display) => display.id === displayId)) {
      throw new Error("That display is not attached.")
    }
    activeRemoteDisplayId = displayId
    broadcastRemoteStatus()
  }

  async function getRemoteStatus(): Promise<RemoteStatus> {
    const gate = evaluatePrivacyGate(await getPrivacyGateStatus())
    const autopilotConsent = await getAutopilotConsent()
    return {
      protocolVersion: REMOTE_PROTOCOL_VERSION,
      controlEnabled: remoteControlEnabled,
      inputEnabled: isRemoteInputEnabled(),
      // The phone cannot satisfy any of these — they need the laptop — so the
      // point is to name the blocker precisely enough to act on.
      gateBlockedBy: gate.canStart
        ? autopilotConsent.consented
          ? null
          : "autopilot-consent"
        : gate.blockingReason ?? null,
      autopilotRunning: autopilot.isRunning(),
      deviceName: "Quip",
      displays: listRemoteDisplays(),
      activeDisplayId: activeRemoteDisplayId ?? screen.getPrimaryDisplay().id
    }
  }

  // Sized for a real gesture, not a stream of them: a drag or a flick is a
  // handful of events, so 40 absorbs one comfortably, while 30/sec sustained is
  // already far past what a hand produces and well short of what a runaway loop
  // would. Exceeding it fails the command rather than queueing it — a backlog
  // of stale clicks replayed late is worse than a refusal.
  const inputRateLimit = new TokenBucket(40, 30)

  function takeInputToken(): void {
    if (!inputRateLimit.tryTake()) {
      throw new Error(INPUT_RATE_LIMIT_MESSAGE)
    }
  }

  /** Live display geometry, re-read per event rather than cached. */
  function displayDescriptors() {
    return screen.getAllDisplays().map(toDisplayDescriptor)
  }

  function resolveInputPoint(point: NormalizedPoint) {
    return resolvePoint(point, displayDescriptors())
  }

  /**
   * Note the absence of a focus-settle delay here, unlike the autopilot path.
   * That delay exists because autopilot clicks a field and immediately types
   * into it while macOS is still activating the app. A person tapping a phone
   * supplies their own delay between the two, and adding a fixed one to every
   * event would make direct control feel laggy for no benefit.
   */
  const remoteInputCapabilities = {
    inputClick: async (
      point: NormalizedPoint,
      options: { button: "left" | "right"; clicks: 1 | 2 }
    ) => {
      takeInputToken()
      const target = resolveInputPoint(point)
      if (options.button === "right") {
        await inputAutomation.rightClickAt(target)
        return
      }
      if (options.clicks === 2) {
        await inputAutomation.doubleClickAt(target)
        return
      }
      await inputAutomation.clickAt(target)
    },

    inputDrag: async (from: NormalizedPoint, to: NormalizedPoint) => {
      takeInputToken()
      await inputAutomation.dragTo(resolveInputPoint(from), resolveInputPoint(to))
    },

    inputScroll: async (
      point: NormalizedPoint,
      delta: { dx: number; dy: number }
    ) => {
      takeInputToken()
      const target = resolveInputPoint(point)
      for (const axis of scrollDeltaToSteps(delta)) {
        await inputAutomation.scrollAt(target, axis.direction, axis.steps)
      }
    },

    inputText: async (text: string) => {
      takeInputToken()
      await inputAutomation.typeText(text)
    },

    inputKey: async (combo: string) => {
      takeInputToken()
      await inputAutomation.pressKey(combo)
    }
  }

  const remoteCapabilities: RemoteCapabilities = {
    getStatus: getRemoteStatus,
    captureFrame: captureRemoteFrame,
    captureJpeg: captureRemoteJpeg,
    selectDisplay: async (displayId) => selectRemoteDisplay(displayId),
    // Routed through the same handler logic the desktop uses, so the privacy
    // gate and autopilot consent checks apply identically to a remote start.
    autopilotStart: (goal, options) => startAutopilotRun(goal, options),
    autopilotConfirm: () => autopilot.confirm(),
    autopilotReject: () => autopilot.reject(),
    autopilotStop: () => autopilot.stop(),
    chatSend: (request) => runRemoteChat(request),
    chatCancel: (requestId) => {
      activeChatStreams.get(requestId)?.abort()
      activeChatStreams.delete(requestId)
    },
    ...remoteInputCapabilities
  }

  /**
   * Stream a chat answer to the phone over SSE. Mirrors runChatStream, but the
   * deltas go to every connected phone rather than to one renderer.
   */
  async function runRemoteChat(request: {
    requestId: string
    message: string
    withScreen: boolean
    persona?: string
  }): Promise<void> {
    const { requestId, message, withScreen, persona } = request
    const controller = new AbortController()
    activeChatStreams.set(requestId, controller)

    const llm = appState.processingHelper.getLLMHelper()
    const onChunk = (delta: string) => {
      if (controller.signal.aborted) return
      broadcastRemote({ type: "chat-chunk", requestId, delta })
    }

    try {
      const text = withScreen
        ? await llm.chatWithImageStream(
            message,
            [await appState.getScreenshotHelper().captureForChatBuffer()],
            onChunk,
            controller.signal,
            [],
            persona
          )
        : await llm.chatWithGeminiStream(
            message,
            onChunk,
            controller.signal,
            [],
            persona
          )
      if (!controller.signal.aborted) {
        broadcastRemote({ type: "chat-done", requestId, text })
      }
    } catch (error: any) {
      if (!controller.signal.aborted) {
        broadcastRemote({
          type: "chat-error",
          requestId,
          message: String(error?.message ?? error)
        })
      }
    } finally {
      activeChatStreams.delete(requestId)
    }
  }

  async function startRemoteServer() {
    if (!remoteServer) {
      remoteServer = new RemoteServer({
        pairing: remotePairing,
        capabilities: remoteCapabilities,
        isControlEnabled: () => remoteControlEnabled,
        // Read per request rather than captured: consent, the toggle, and the
        // kill switch all change while the server is up.
        isInputEnabled: isRemoteInputEnabled,
        isAutopilotRunning: () => autopilot.isRunning(),
        onConnectionsChanged: notifyRemoteConnections
      })
    }
    return remoteServer.start()
  }

  /**
   * Tell the overlay how many phones are attached and whether any of them may
   * type here. A machine a phone can drive must never look identical to one a
   * phone is merely watching, so the count alone is not enough.
   */
  function notifyRemoteConnections(count: number): void {
    const mainWindow = appState.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("remote-connections-changed", {
        count,
        inputEnabled: isRemoteInputEnabled()
      })
    }
  }

  /** Re-push connection state after a consent or toggle change. */
  function notifyRemoteState(): void {
    notifyRemoteConnections(remoteServer?.getInfo().connectedDevices ?? 0)
  }

  async function stopRemoteServer() {
    await remoteServer?.stop()
    remoteServer = null
    remotePairing.clearCode()
  }

  // main calls this during before-quit: a server that outlives the window
  // would leave the machine reachable with no UI to turn it off.
  appState.registerRemoteShutdown(() => stopRemoteServer())

  ipcMain.handle("remote-get-state", async () => ({
    server: remoteServer?.getInfo() ?? {
      running: false,
      port: null,
      url: null,
      connectedDevices: 0
    },
    consent: await getRemoteConsent(),
    inputConsent: await getRemoteInputConsent(),
    devices: await remotePairing.listDevices(),
    pairingCode: remotePairing.getActiveCode(),
    displays: listRemoteDisplays()
  }))

  ipcMain.handle("remote-acknowledge-consent", async () => {
    await remoteConsentStore.acknowledge()
    remoteControlEnabled = true
    return getRemoteConsent()
  })

  ipcMain.handle("remote-acknowledge-input-consent", async () => {
    await remoteInputConsentStore.acknowledge()
    remoteInputConsented = true
    // Accepting the notice turns it on: the user pressed a button that says so.
    // The separate toggle exists to switch it off again without re-consenting.
    remoteInputAllowed = true
    broadcastRemoteStatus()
    notifyRemoteState()
    return getRemoteInputConsent()
  })

  ipcMain.handle("remote-set-input-allowed", async (_, allowed: boolean) => {
    if (!allowed) {
      disableRemoteInput("settings toggle")
      return getRemoteInputConsent()
    }
    // Never let the toggle stand in for the notice.
    if (!remoteInputConsented) {
      throw new Error("Accept the screen-control notice before allowing input.")
    }
    remoteInputAllowed = true
    broadcastRemoteStatus()
    notifyRemoteState()
    return getRemoteInputConsent()
  })

  ipcMain.handle("remote-start-server", async () => {
    try {
      return { success: true, server: await startRemoteServer() }
    } catch (error: any) {
      return { success: false, error: error?.message ?? String(error) }
    }
  })

  ipcMain.handle("remote-stop-server", async () => {
    await stopRemoteServer()
    return { success: true }
  })

  ipcMain.handle("remote-issue-pairing-code", async () => {
    if (!remoteServer?.isRunning()) {
      throw new Error("Start the remote server before pairing a device.")
    }
    const { code, expiresAt } = remotePairing.issueCode()
    return { code, expiresAt, url: remoteServer.getInfo().url }
  })

  ipcMain.handle("remote-revoke-device", async (_, deviceId: string) => {
    const revoked = await remotePairing.revoke(deviceId)
    remoteServer?.revokeDeviceTickets(deviceId)
    return { success: revoked, devices: await remotePairing.listDevices() }
  })

  ipcMain.handle("update-content-dimensions", async (event, { width, height }: { width: number; height: number }) => {
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
  ipcMain.handle("analyze-audio-base64", async (event, data: string, mimeType: string, history: ChatTurn[] = [], system?: { data: string; mimeType: string }) => {
    try {
      const result = await appState.processingHelper.processAudioBase64(data, mimeType, history, system)
      return result
    } catch (error: any) {
      console.error("Error in analyze-audio-base64 handler:", error)
      throw error
    }
  })

  // Live Listen's stage one. Transcript only — the answer goes out over the
  // ordinary streaming chat channel, so nothing about answering lives here.
  ipcMain.handle("transcribe-audio", async (event, data: string, mimeType: string) => {
    try {
      return await appState.processingHelper.getLLMHelper().transcribeAudio(data, mimeType)
    } catch (error: any) {
      console.error("Error in transcribe-audio handler:", error)
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

  // `persona` is an optional per-request override of the active mode — quick
  // actions use it so "Translate" isn't answered by an interview copilot.
  ipcMain.handle(
    "gemini-chat-stream",
    async (
      event,
      requestId: string,
      message: string,
      history: ChatTurn[] = [],
      persona?: string
    ) =>
      runChatStream(event, requestId, (onChunk, signal) =>
        appState.processingHelper
          .getLLMHelper()
          .chatWithGeminiStream(message, onChunk, signal, history, persona)
      )
  )

  ipcMain.handle(
    "chat-with-screen-stream",
    async (
      event,
      requestId: string,
      message: string,
      history: ChatTurn[] = [],
      persona?: string
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
          .chatWithImageStream(
            message,
            [shot],
            onChunk,
            signal,
            history,
            persona
          )
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

  ipcMain.handle("system-audio-get-consent", async () => getSystemAudioConsent())

  ipcMain.handle("system-audio-acknowledge-consent", async () => {
    await systemAudioConsentStore.acknowledge()
    return getSystemAudioConsent()
  })

  // Kicks off the unattended loop. Resolves as soon as the run is under way —
  // progress arrives on the "autopilot-update" channel, because a run can last
  // minutes and must stay interruptible.
  //
  // Defined as a function rather than inline in the handler so the remote
  // capability calls this exact code path. Duplicating the gate checks for the
  // phone would mean two places to keep in sync, and the one that drifts is the
  // one that lets an unconsented run start.
  async function startAutopilotRun(
    goal: string,
    options?: { maxSteps?: number }
  ): Promise<{ started: boolean; maxSteps: number }> {
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
      .isUsingOllama()
      ? "ollama"
      : "gemini"

    void autopilot.start(goal, provider, options ?? {}).catch((error) => {
      console.error("Autopilot run failed to start:", error)
    })

    return { started: true, maxSteps: autopilot.getMaxSteps() }
  }

  ipcMain.handle(
    "autopilot-start",
    async (_, goal: string, options?: { maxSteps?: number }) =>
      startAutopilotRun(goal, options)
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

  // Who the user is (Settings → Profile), carried by every chat flow.
  ipcMain.handle("set-user-profile", async (_, text: string) => {
    appState.processingHelper.getLLMHelper().setUserProfile(text)
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
