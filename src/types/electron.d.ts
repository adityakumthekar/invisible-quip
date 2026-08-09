import type { TeachingResult } from "../lib/teaching"
import type { TeachingOverlayTargetEvent } from "../lib/teachingOverlayContract"
import type { PrivacyGateStatus, PrivacyPreflightResult } from "../lib/privacyContract"
import type { AutonomyLevel, AutopilotUpdate } from "../lib/autopilot"

export interface AutopilotConsent {
  consented: boolean
  text: string
  version: number
}

export interface AutopilotAutonomy {
  level: AutonomyLevel
  description: string
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
  analyzeAudioFromBase64: (data: string, mimeType: string, history?: { role: "user" | "gemini"; text: string }[]) => Promise<{ transcript: string; text: string; timestamp: number }>
  analyzeAudioFile: (path: string) => Promise<{ text: string; timestamp: number }>
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
  autopilotGetAutonomy: () => Promise<AutopilotAutonomy>
  autopilotSetAutonomy: (level: AutonomyLevel) => Promise<AutopilotAutonomy>
  autopilotStart: (
    goal: string,
    options?: { maxSteps?: number }
  ) => Promise<{ started: boolean; maxSteps: number }>
  autopilotConfirm: () => Promise<{ success: true }>
  autopilotReject: () => Promise<{ success: true }>
  autopilotStop: () => Promise<{ success: true }>
  onAutopilotUpdate: (callback: (update: AutopilotUpdate) => void) => () => void

  quitApp: () => Promise<void>
  getCurrentLlmConfig: () => Promise<{
    provider: "ollama" | "gemini" | "qwen"
    model: string
    isOllama: boolean
    isQwen: boolean
    qwenBaseUrl: string
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
  switchToQwen: (
    baseUrl?: string,
    model?: string,
    apiKey?: string
  ) => Promise<{ success: boolean; error?: string }>
  listQwenModels: (baseUrl?: string, apiKey?: string) => Promise<string[]>
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