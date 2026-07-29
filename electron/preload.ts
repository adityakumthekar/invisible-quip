import { contextBridge, ipcRenderer } from "electron"
import { TeachingResult } from "./teaching"
import type { TeachingOverlayTargetEvent } from "./teachingOverlayContract"
import type { PrivacyGateStatus, PrivacyPreflightResult } from "./privacyContract"
import type { AutopilotUpdate } from "./autopilot"

export interface AutopilotConsent {
  consented: boolean
  text: string
  version: number
}

export interface OllamaPullProgress {
  model: string
  status: string
  completed?: number
  total?: number
}

// Types for the exposed Electron API
interface ElectronAPI {
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  setIgnoreMouseEvents: (ignore: boolean) => Promise<void>
  startWindowDrag: () => Promise<void>
  endWindowDrag: () => Promise<void>
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
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
  autopilotStart: (
    goal: string,
    options?: { maxSteps?: number }
  ) => Promise<{ started: boolean; maxSteps: number }>
  autopilotConfirm: () => Promise<{ success: true }>
  autopilotReject: () => Promise<{ success: true }>
  autopilotStop: () => Promise<{ success: true }>
  onAutopilotUpdate: (callback: (update: AutopilotUpdate) => void) => () => void

  // Local model management
  getOllamaModelCapabilities: (model: string) => Promise<{ vision: boolean }>
  pullOllamaModel: (
    model: string
  ) => Promise<{ success: boolean; error?: string }>
  onOllamaPullProgress: (
    callback: (progress: OllamaPullProgress) => void
  ) => () => void

  quitApp: () => Promise<void>
  
  // LLM Model Management
  getCurrentLlmConfig: () => Promise<{ provider: "ollama" | "gemini"; model: string; isOllama: boolean }>
  getAvailableOllamaModels: () => Promise<string[]>
  switchToOllama: (model?: string, url?: string) => Promise<{ success: boolean; error?: string }>
  switchToGemini: (apiKey?: string) => Promise<{ success: boolean; error?: string }>
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

export const PROCESSING_EVENTS = {
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

// Expose the Electron API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  setIgnoreMouseEvents: (ignore: boolean) =>
    ipcRenderer.invoke("set-ignore-mouse-events", ignore),
  startWindowDrag: () => ipcRenderer.invoke("window-drag-start"),
  endWindowDrag: () => ipcRenderer.invoke("window-drag-end"),
  takeScreenshot: () => ipcRenderer.invoke("take-screenshot"),
  getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
  deleteScreenshot: (path: string) =>
    ipcRenderer.invoke("delete-screenshot", path),

  // Event listeners
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("screenshot-taken", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-taken", subscription)
    }
  },
  onSolutionsReady: (callback: (solutions: string) => void) => {
    const subscription = (_: any, solutions: string) => callback(solutions)
    ipcRenderer.on("solutions-ready", subscription)
    return () => {
      ipcRenderer.removeListener("solutions-ready", subscription)
    }
  },
  onResetView: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("reset-view", subscription)
    return () => {
      ipcRenderer.removeListener("reset-view", subscription)
    }
  },
  onSolutionStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription)
    }
  },
  onDebugStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_START, subscription)
    }
  },

  onDebugSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("debug-success", subscription)
    return () => {
      ipcRenderer.removeListener("debug-success", subscription)
    }
  },
  onDebugError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    }
  },
  onSolutionError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
        subscription
      )
    }
  },
  onProcessingNoScreenshots: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    }
  },

  onAskAiHotkey: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("ask-ai-hotkey", subscription)
    return () => {
      ipcRenderer.removeListener("ask-ai-hotkey", subscription)
    }
  },

  onRecordHotkey: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("record-hotkey", subscription)
    return () => {
      ipcRenderer.removeListener("record-hotkey", subscription)
    }
  },

  onNewChatHotkey: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("new-chat-hotkey", subscription)
    return () => {
      ipcRenderer.removeListener("new-chat-hotkey", subscription)
    }
  },

  onContentLimits: (
    callback: (limits: { maxHeight: number; maxWidth: number }) => void
  ) => {
    const subscription = (
      _: any,
      limits: { maxHeight: number; maxWidth: number }
    ) => callback(limits)
    ipcRenderer.on("content-limits", subscription)
    return () => {
      ipcRenderer.removeListener("content-limits", subscription)
    }
  },

  onProblemExtracted: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.PROBLEM_EXTRACTED,
        subscription
      )
    }
  },
  onSolutionSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.SOLUTION_SUCCESS,
        subscription
      )
    }
  },
  onUnauthorized: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    }
  },
  moveWindowLeft: () => ipcRenderer.invoke("move-window-left"),
  moveWindowRight: () => ipcRenderer.invoke("move-window-right"),
  moveWindowUp: () => ipcRenderer.invoke("move-window-up"),
  moveWindowDown: () => ipcRenderer.invoke("move-window-down"),
  analyzeAudioFromBase64: (data: string, mimeType: string, history: { role: "user" | "gemini"; text: string }[] = []) => ipcRenderer.invoke("analyze-audio-base64", data, mimeType, history),
  analyzeAudioFile: (path: string) => ipcRenderer.invoke("analyze-audio-file", path),
  analyzeImageFile: (path: string) => ipcRenderer.invoke("analyze-image-file", path),
  teachStart: (goal: string) => ipcRenderer.invoke("teach-start", goal),
  teachNext: () => ipcRenderer.invoke("teach-next"),
  teachExecute: () => ipcRenderer.invoke("teach-execute"),
  teachStop: () => ipcRenderer.invoke("teach-stop"),
  onTeachingOverlayTarget: (
    callback: (data: TeachingOverlayTargetEvent) => void
  ) => {
    const subscription = (_: unknown, data: TeachingOverlayTargetEvent) =>
      callback(data)
    ipcRenderer.on("teaching-overlay-target", subscription)
    return () => {
      ipcRenderer.removeListener("teaching-overlay-target", subscription)
    }
  },
  onTeachingOverlayClear: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("teaching-overlay-clear", subscription)
    return () => {
      ipcRenderer.removeListener("teaching-overlay-clear", subscription)
    }
  },
  onTeachingHotkey: (callback: (kind: "execute" | "abort") => void) => {
    const subscription = (_: unknown, kind: "execute" | "abort") =>
      callback(kind)
    ipcRenderer.on("teaching-hotkey", subscription)
    return () => {
      ipcRenderer.removeListener("teaching-hotkey", subscription)
    }
  },
  teachingOverlayReady: () => ipcRenderer.invoke("teaching-overlay-ready"),
  privacyGetStatus: () => ipcRenderer.invoke("privacy-get-status"),
  privacyAcknowledge: () => ipcRenderer.invoke("privacy-acknowledge"),
  privacyRunPreflight: () => ipcRenderer.invoke("privacy-run-preflight"),

  // Autopilot
  autopilotGetConsent: () => ipcRenderer.invoke("autopilot-get-consent"),
  autopilotAcknowledgeConsent: () =>
    ipcRenderer.invoke("autopilot-acknowledge-consent"),
  autopilotStart: (goal: string, options?: { maxSteps?: number }) =>
    ipcRenderer.invoke("autopilot-start", goal, options),
  autopilotConfirm: () => ipcRenderer.invoke("autopilot-confirm"),
  autopilotReject: () => ipcRenderer.invoke("autopilot-reject"),
  autopilotStop: () => ipcRenderer.invoke("autopilot-stop"),
  onAutopilotUpdate: (callback: (update: AutopilotUpdate) => void) => {
    const subscription = (_: unknown, update: AutopilotUpdate) =>
      callback(update)
    ipcRenderer.on("autopilot-update", subscription)
    return () => {
      ipcRenderer.removeListener("autopilot-update", subscription)
    }
  },

  quitApp: () => ipcRenderer.invoke("quit-app"),

  // LLM Model Management
  getCurrentLlmConfig: () => ipcRenderer.invoke("get-current-llm-config"),
  getAvailableOllamaModels: () => ipcRenderer.invoke("get-available-ollama-models"),
  getOllamaModelCapabilities: (model: string) =>
    ipcRenderer.invoke("ollama-model-capabilities", model),
  pullOllamaModel: (model: string) =>
    ipcRenderer.invoke("ollama-pull-model", model),
  onOllamaPullProgress: (callback: (progress: OllamaPullProgress) => void) => {
    const subscription = (_: unknown, progress: OllamaPullProgress) =>
      callback(progress)
    ipcRenderer.on("ollama-pull-progress", subscription)
    return () => {
      ipcRenderer.removeListener("ollama-pull-progress", subscription)
    }
  },
  switchToOllama: (model?: string, url?: string) => ipcRenderer.invoke("switch-to-ollama", model, url),
  switchToGemini: (apiKey?: string) => ipcRenderer.invoke("switch-to-gemini", apiKey),
  testLlmConnection: () => ipcRenderer.invoke("test-llm-connection"),
  
  onChatStreamChunk: (
    callback: (data: { requestId: string; delta: string }) => void
  ) => {
    const subscription = (_: any, data: { requestId: string; delta: string }) =>
      callback(data)
    ipcRenderer.on("chat-stream-chunk", subscription)
    return () => {
      ipcRenderer.removeListener("chat-stream-chunk", subscription)
    }
  },
  onChatStreamDone: (
    callback: (data: { requestId: string; text: string }) => void
  ) => {
    const subscription = (_: any, data: { requestId: string; text: string }) =>
      callback(data)
    ipcRenderer.on("chat-stream-done", subscription)
    return () => {
      ipcRenderer.removeListener("chat-stream-done", subscription)
    }
  },
  onChatStreamError: (
    callback: (data: { requestId: string; message: string }) => void
  ) => {
    const subscription = (
      _: any,
      data: { requestId: string; message: string }
    ) => callback(data)
    ipcRenderer.on("chat-stream-error", subscription)
    return () => {
      ipcRenderer.removeListener("chat-stream-error", subscription)
    }
  },
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args)
} as ElectronAPI)
