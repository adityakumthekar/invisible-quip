// ProcessingHelper.ts

import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import { abortAllChatStreams } from "./chatStreams"
import { ChatTurn } from "./chatHistory"
import dotenv from "dotenv"

dotenv.config()

const isDev = process.env.NODE_ENV === "development"
const isDevTest = process.env.IS_DEV_TEST === "true"
const MOCK_API_WAIT_TIME = Number(process.env.MOCK_API_WAIT_TIME) || 500

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper
  private currentProcessingAbortController: AbortController | null = null

  constructor(appState: AppState) {
    this.appState = appState
    
    // Check if user wants to use Ollama
    const useOllama = process.env.USE_OLLAMA === "true"
    const ollamaModel = process.env.OLLAMA_MODEL // Don't set default here, let LLMHelper auto-detect
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434"
    
    if (useOllama) {
      console.log("[ProcessingHelper] Initializing with Ollama")
      this.llmHelper = new LLMHelper(undefined, true, ollamaModel, ollamaUrl)
    } else {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY not found in environment variables. Set GEMINI_API_KEY or enable Ollama with USE_OLLAMA=true")
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
