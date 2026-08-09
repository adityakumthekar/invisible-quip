// ProcessingHelper.ts

import { app } from "electron"
import fs from "fs"
import path from "path"
import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import { abortAllChatStreams } from "./chatStreams"
import { ChatTurn } from "./chatHistory"
import {
  LLM_SETTINGS_FILENAME,
  parseLlmSettings,
  type LlmSettings
} from "./llmSettingsStore"
import dotenv from "dotenv"

dotenv.config()

/**
 * What the user last chose in Settings, or null when they never have.
 *
 * Read synchronously because the constructor below is synchronous and runs
 * before any window exists — it's one small file, once, at startup. A missing
 * or corrupt file yields null so the environment still decides, which is what
 * an .env-only setup has always relied on.
 */
function readStoredLlmSettings(): LlmSettings | null {
  try {
    return parseLlmSettings(
      fs.readFileSync(
        path.join(app.getPath("userData"), LLM_SETTINGS_FILENAME),
        "utf8"
      )
    )
  } catch {
    return null
  }
}

const isDev = process.env.NODE_ENV === "development"
const isDevTest = process.env.IS_DEV_TEST === "true"
const MOCK_API_WAIT_TIME = Number(process.env.MOCK_API_WAIT_TIME) || 500

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper
  private currentProcessingAbortController: AbortController | null = null

  constructor(appState: AppState) {
    this.appState = appState
    
    // What the user picked in Settings wins; the environment is the fallback,
    // so an existing .env-only setup keeps behaving exactly as it did.
    const stored = readStoredLlmSettings()

    const useOllama = stored
      ? stored.provider === "ollama"
      : process.env.USE_OLLAMA === "true"
    const useQwen = stored
      ? stored.provider === "qwen"
      : process.env.USE_QWEN === "true"

    // Don't default the Ollama model here; let LLMHelper auto-detect.
    const ollamaModel = stored?.ollama?.model ?? process.env.OLLAMA_MODEL
    const ollamaUrl =
      stored?.ollama?.url ?? process.env.OLLAMA_URL ?? "http://localhost:11434"
    const qwenBaseUrl =
      stored?.qwen?.baseUrl ??
      process.env.QWEN_BASE_URL ??
      "http://100.123.38.63:8000/v1"
    const qwenModel =
      stored?.qwen?.model ??
      process.env.QWEN_MODEL ??
      "Qwen/Qwen3-VL-4B-Instruct"
    const qwenApiKey =
      stored?.qwen?.apiKey ?? process.env.QWEN_API_KEY ?? "EMPTY"

    if (useOllama) {
      console.log("[ProcessingHelper] Initializing with Ollama")
      this.llmHelper = new LLMHelper(undefined, true, ollamaModel, ollamaUrl)
    } else if (useQwen) {
      console.log("[ProcessingHelper] Initializing with Qwen (vLLM)")
      this.llmHelper = new LLMHelper(
        undefined,
        false,
        undefined,
        undefined,
        true,
        qwenBaseUrl,
        qwenModel,
        qwenApiKey
      )
    } else {
      const apiKey = stored?.gemini?.apiKey ?? process.env.GEMINI_API_KEY
      if (!apiKey) {
        throw new Error(
          "GEMINI_API_KEY not found in environment variables. Set GEMINI_API_KEY, enable Ollama with USE_OLLAMA=true, or enable Qwen with USE_QWEN=true"
        )
      }
      console.log("[ProcessingHelper] Initializing with Gemini")
      this.llmHelper = new LLMHelper(apiKey, false)
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.appState.getMainWindow()
    if (!mainWindow) return

    const screenshotQueue = this.appState.getScreenshotHelper().getScreenshotQueue()
    if (screenshotQueue.length === 0) {
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    const lastPath = screenshotQueue[screenshotQueue.length - 1]

    mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START)
    this.appState.setView("solutions")
    this.currentProcessingAbortController = new AbortController()
    try {
      const imageResult = await this.llmHelper.analyzeImageFile(lastPath);
      const problemInfo = {
        problem_statement: imageResult.text,
        input_format: { description: "Generated from screenshot", parameters: [] as any[] },
        output_format: { description: "Generated from screenshot", type: "string", subtype: "text" },
        complexity: { time: "N/A", space: "N/A" },
        test_cases: [] as any[],
        validation_type: "manual",
        difficulty: "custom"
      };
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo);
      this.appState.setProblemInfo(problemInfo);
    } catch (error: any) {
      console.error("Image processing error:", error)
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message)
    } finally {
      this.currentProcessingAbortController = null
    }
  }

  public cancelOngoingRequests(): void {
    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
    }

    // Streaming chat requests live outside this class, in their own registry.
    abortAllChatStreams()

    this.appState.setHasDebugged(false)
  }

  public async processAudioBase64(
    data: string,
    mimeType: string,
    history: ChatTurn[] = [],
    system?: { data: string; mimeType: string }
  ) {
    // Directly use LLMHelper to analyze inline base64 audio
    return this.llmHelper.analyzeAudioFromBase64(data, mimeType, history, system);
  }

  public getLLMHelper() {
    return this.llmHelper;
  }
}
