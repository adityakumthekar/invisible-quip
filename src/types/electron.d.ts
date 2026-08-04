import type { TeachingResult } from "../lib/teaching"
import type { TeachingOverlayTargetEvent } from "../lib/teachingOverlayContract"
import type { PrivacyGateStatus, PrivacyPreflightResult } from "../lib/privacyContract"
import type { AutopilotUpdate } from "../lib/autopilot"

export interface AutopilotConsent {
  consented: boolean
  text: string
  version: number
}

export interface RemoteServerInfo {
  running: boolean
  port: number | null
  /** The LAN URL to put in the QR code, or null when not running. */
  url: string | null
  connectedDevices: number
}

export interface RemoteDeviceSummary {
  id: string
  name: string
  pairedAt: string
  lastSeenAt: string | null
}

/**
 * Consent to the phone driving the mouse and keyboard directly.
 *
 * `consented` and `allowed` are separate on purpose: the first is a durable
 * "I understand what this does", the second a live "and I want it on right
 * now". The desktop kill switch drops `allowed` without discarding `consented`,
 * so taking control back is one keystroke and handing it over again does not
 * mean re-reading the notice.
 */
export interface RemoteInputConsent extends AutopilotConsent {
  allowed: boolean
}

export interface RemoteDisplay {
  id: number
  label: string
  width: number
  height: number
  primary: boolean
}

/** Everything the Settings -> Remote tab needs in one round trip. */
export interface RemoteState {
  server: RemoteServerInfo
  consent: AutopilotConsent
  inputConsent: RemoteInputConsent
  devices: RemoteDeviceSummary[]
  pairingCode: { code: string; expiresAt: number } | null
  displays: RemoteDisplay[]
}

/** Payload of the overlay's remote indicator event. */
export interface RemoteConnectionState {
  count: number
  inputEnabled: boolean
}

export interface OllamaPullProgress {
  model: string
  status: string
  completed?: number
  total?: number
}

export interface ElectronAPI {
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  setIgnoreMouseEvents: (ignore: boolean) => Promise<void>
  startWindowDrag: () => Promise<void>
  endWindowDrag: () => Promise<void>
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>
  deleteScreenshot: (path: string) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (callback: (data: { path: string; preview: string }) => void) => () => void
  onSolutionsReady: (callback: (solutions: string) => void) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onAskAiHotkey: (callback: () => void) => () => void
  onRecordHotkey: (callback: () => void) => () => void
  onNewChatHotkey: (callback: () => void) => () => void
  onContentLimits: (
    callback: (limits: { maxHeight: number; maxWidth: number }) => void
  ) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void
  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
  takeScreenshot: () => Promise<{ path: string; preview: string }>
  moveWindowLeft: () => Promise<void>
  moveWindowRight: () => Promise<void>
  moveWindowUp: () => Promise<void>
  moveWindowDown: () => Promise<void>
  analyzeAudioFromBase64: (data: string, mimeType: string, history?: { role: "user" | "gemini"; text: string }[], system?: { data: string; mimeType: string }) => Promise<{ transcript: string; turns: { speaker: "you" | "them"; text: string }[]; text: string; timestamp: number }>
  analyzeImageFile: (path: string) => Promise<{ text: string; timestamp: number }>
  teachStart: (goal: string) => Promise<TeachingResult>
  teachNext: () => Promise<TeachingResult>
  teachExecute: () => Promise<TeachingResult>
  teachStop: () => Promise<{ success: true }>
  onTeachingOverlayTarget: (
    callback: (data: TeachingOverlayTargetEvent) => void
  ) => () => void
  onTeachingOverlayClear: (callback: () => void) => () => void
  onTeachingHotkey: (
    callback: (kind: "execute" | "abort") => void
  ) => () => void
  teachingOverlayReady: () => Promise<boolean>
  privacyGetStatus: () => Promise<PrivacyGateStatus>
  privacyAcknowledge: () => Promise<PrivacyGateStatus>
  privacyRunPreflight: () => Promise<PrivacyPreflightResult>

  // Autopilot (unattended runs)
  autopilotGetConsent: () => Promise<AutopilotConsent>
  autopilotAcknowledgeConsent: () => Promise<AutopilotConsent>
  systemAudioGetConsent: () => Promise<AutopilotConsent>
  systemAudioAcknowledgeConsent: () => Promise<AutopilotConsent>
  autopilotStart: (
    goal: string,
    options?: { maxSteps?: number }
  ) => Promise<{ started: boolean; maxSteps: number }>
  autopilotConfirm: () => Promise<{ success: true }>
  autopilotReject: () => Promise<{ success: true }>
  autopilotStop: () => Promise<{ success: true }>
  onAutopilotUpdate: (callback: (update: AutopilotUpdate) => void) => () => void

  // Remote access (phone on the same Wi-Fi)
  remoteGetState: () => Promise<RemoteState>
  remoteAcknowledgeConsent: () => Promise<AutopilotConsent>
  remoteAcknowledgeInputConsent: () => Promise<RemoteInputConsent>
  remoteSetInputAllowed: (allowed: boolean) => Promise<RemoteInputConsent>
  remoteStartServer: () => Promise<{
    success: boolean
    server?: RemoteServerInfo
    error?: string
  }>
  remoteStopServer: () => Promise<{ success: true }>
  remoteIssuePairingCode: () => Promise<{
    code: string
    expiresAt: number
    url: string | null
  }>
  remoteRevokeDevice: (
    deviceId: string
  ) => Promise<{ success: boolean; devices: RemoteDeviceSummary[] }>
  onRemoteConnectionsChanged: (
    callback: (state: RemoteConnectionState) => void
  ) => () => void

  quitApp: () => Promise<void>
  getCurrentLlmConfig: () => Promise<{
    provider: "ollama" | "gemini"
    model: string
    isOllama: boolean
  }>
  getAvailableOllamaModels: () => Promise<string[]>
  getOllamaModelCapabilities: (model: string) => Promise<{ vision: boolean }>
  pullOllamaModel: (
    model: string
  ) => Promise<{ success: boolean; error?: string }>
  onOllamaPullProgress: (
    callback: (progress: OllamaPullProgress) => void
  ) => () => void
  switchToOllama: (
    model?: string,
    url?: string
  ) => Promise<{ success: boolean; error?: string }>
  switchToGemini: (
    apiKey?: string
  ) => Promise<{ success: boolean; error?: string }>
  testLlmConnection: () => Promise<{ success: boolean; error?: string }>
  onChatStreamChunk: (
    callback: (data: { requestId: string; delta: string }) => void
  ) => () => void
  onChatStreamDone: (
    callback: (data: { requestId: string; text: string }) => void
  ) => () => void
  onChatStreamError: (
    callback: (data: { requestId: string; message: string }) => void
  ) => () => void
  invoke: (channel: string, ...args: any[]) => Promise<any>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
} 