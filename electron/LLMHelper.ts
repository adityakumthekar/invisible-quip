import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"
import fs from "fs"
import {
  parseTeachingResponse,
  TeachingStepResponse
} from "./teaching"

export function buildTeachingPrompt(
  goal: string,
  history: string[],
  imageSize: { width: number; height: number }
): string {
  const priorSteps =
    history.length > 0
      ? history.map((step, index) => `${index + 1}. ${step}`).join("\n")
      : "None."

  return `You are a visual teaching assistant guiding a user toward this goal:
${goal}

Prior step summaries:
${priorSteps}

Inspect the attached screenshot (${imageSize.width}×${imageSize.height} pixels) and return exactly one concise instruction for only the immediate next action. Do not provide a list or multiple actions. After you respond, the user confirms and the app performs the action for them, so choose one small, safe, reversible action at a time.

Return only one strict JSON object with this exact contract:
{
  "state": "step" | "complete" | "blocked",
  "instruction": "one concise instruction",
  "label": "optional short visible label",
  "action": "click" | "type",
  "text": "text to type (only when action is type)",
  "target": { "x": number, "y": number, "width": number, "height": number }
}

Use state "step" when the user can take a visible next action. target is required only for state "step".
IMPORTANT — target coordinates use Gemini's normalized 0–1000 space (NOT raw screenshot pixels):
- (0, 0) is the top-left of the image; (1000, 1000) is the bottom-right.
- x/y are the top-left corner of the UI element in that 0–1000 space.
- width/height are also in 0–1000 space. Always provide them so the click lands on the element center.
- Example: an element covering the middle of the screen might be {"x":400,"y":450,"width":200,"height":100}.
Set action to "click" to click the target, or "type" to click the target and then enter text. Include "text" only when action is "type"; omit it for clicks. Default to "click" when unsure.
Use state "complete" when the screenshot shows the goal is finished.
Use state "blocked" when no safe visible next action can be identified, and briefly explain what is missing.
For "complete" and "blocked", omit target, action, and text. Omit label when it is not useful. Do not add properties, markdown, or commentary.`
}

export function parseTeachingModelText(text: string): TeachingStepResponse {
  // Gemini often wraps JSON in a ```json code fence even when told not to;
  // strip it before parsing, mirroring cleanJsonResponse on the other paths.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error("Invalid teaching JSON response")
  }
  return parseTeachingResponse(parsed)
}

interface OllamaResponse {
  response: string
  done: boolean
}

const SOLUTION_JSON_FORMAT = `{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}
Important: Return ONLY the JSON object, without any markdown formatting or code blocks.`

export class LLMHelper {
  private model: GenerativeModel | null = null
  private systemPrompt = `You are Quip, a helpful, proactive assistant for any kind of problem or situation (not just coding). For any user input, analyze the situation, provide a clear problem statement, relevant context, and suggest several possible responses or actions the user could take next. Always explain your reasoning. Present your suggestions as a list of options or next steps.`
  private useOllama: boolean = false
  private ollamaModel: string = "llama3.2"
  private ollamaUrl: string = "http://localhost:11434"
  // gemini-2.0-flash was shut down June 1, 2026 — use 3.5 Flash (override with GEMINI_MODEL)
  private geminiModel: string = process.env.GEMINI_MODEL || "gemini-3.5-flash"

  constructor(apiKey?: string, useOllama: boolean = false, ollamaModel?: string, ollamaUrl?: string) {
    this.useOllama = useOllama
    
    if (useOllama) {
      this.ollamaUrl = ollamaUrl || "http://localhost:11434"
      this.ollamaModel = ollamaModel || "gemma:latest" // Default fallback
      console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)
      
      // Auto-detect and use first available model if specified model doesn't exist
      this.initializeOllamaModel()
    } else if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey)
      this.model = genAI.getGenerativeModel({ model: this.geminiModel })
      console.log(`[LLMHelper] Using Google Gemini (${this.geminiModel})`)
    } else {
      throw new Error("Either provide Gemini API key or enable Ollama mode")
    }
  }

  private async fileToGenerativePart(imagePath: string) {
    const imageData = await fs.promises.readFile(imagePath)
    return {
      inlineData: {
        data: imageData.toString("base64"),
        mimeType: "image/png"
      }
    }
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  private async callOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9,
          }
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data: OllamaResponse = await response.json()
      return data.response
    } catch (error) {
      console.error("[LLMHelper] Error calling Ollama:", error)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to connect to Ollama: ${message}. Make sure Ollama is running on ${this.ollamaUrl}`)
    }
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  private async initializeOllamaModel(): Promise<void> {
    try {
      const availableModels = await this.getOllamaModels()
      if (availableModels.length === 0) {
        console.warn("[LLMHelper] No Ollama models found")
        return
      }

      // Check if current model exists, if not use the first available
      if (!availableModels.includes(this.ollamaModel)) {
        this.ollamaModel = availableModels[0]
        console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`)
      }

      // Test the selected model works
      await this.callOllama("Hello")
      console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[LLMHelper] Failed to initialize Ollama model: ${message}`)
      // Try to use first available model as fallback
      try {
        const models = await this.getOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError)
        console.error(`[LLMHelper] Fallback also failed: ${fallbackMessage}`)
      }
    }
  }

  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      const imageParts = await Promise.all(imagePaths.map(path => this.fileToGenerativePart(path)))
      
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const result = await this.model.generateContent([prompt, ...imageParts])
      const response = await result.response
      const text = this.cleanJsonResponse(response.text())
      return JSON.parse(text)
    } catch (error) {
      console.error("Error extracting problem from images:", error)
      throw error
    }
  }

  public async generateSolution(problemInfo: any) {
    const prompt = `${this.systemPrompt}\n\nGiven this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n${SOLUTION_JSON_FORMAT}`

    console.log("[LLMHelper] Calling Gemini LLM for solution...");
    try {
      const result = await this.model.generateContent(prompt)
      console.log("[LLMHelper] Gemini LLM returned result.");
      const response = await result.response
      const text = this.cleanJsonResponse(response.text())
      const parsed = JSON.parse(text)
      console.log("[LLMHelper] Parsed LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("[LLMHelper] Error in generateSolution:", error);
      throw error;
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    try {
      const imageParts = await Promise.all(debugImagePaths.map(path => this.fileToGenerativePart(path)))
      
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n${SOLUTION_JSON_FORMAT}`

      const result = await this.model.generateContent([prompt, ...imageParts])
      const response = await result.response
      const text = this.cleanJsonResponse(response.text())
      const parsed = JSON.parse(text)
      console.log("[LLMHelper] Parsed debug LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("Error debugging solution with images:", error)
      throw error
    }
  }

  public async analyzeAudioFile(audioPath: string) {
    try {
      const audioData = await fs.promises.readFile(audioPath);
      const audioPart = {
        inlineData: {
          data: audioData.toString("base64"),
          mimeType: "audio/mp3"
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user.`;
      const result = await this.model.generateContent([prompt, audioPart]);
      const response = await result.response;
      const text = response.text();
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio file:", error);
      throw error;
    }
  }

  public async analyzeAudioFromBase64(data: string, mimeType: string) {
    try {
      const audioPart = {
        inlineData: {
          data,
          mimeType
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user and be concise.`;
      const result = await this.model.generateContent([prompt, audioPart]);
      const response = await result.response;
      const text = response.text();
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio from base64:", error);
      throw error;
    }
  }

  public async analyzeImageFile(imagePath: string) {
    try {
      const imageData = await fs.promises.readFile(imagePath);
      const imagePart = {
        inlineData: {
          data: imageData.toString("base64"),
          mimeType: "image/png"
        }
      };
      const prompt = `${this.systemPrompt}\n\nDescribe the content of this image in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the image. Do not return a structured JSON object, just answer naturally as you would to a user. Be concise and brief.`;
      const result = await this.model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing image file:", error);
      throw error;
    }
  }

  public setSystemPrompt(text: string): void {
    // Fall back to the default persona if a caller clears it.
    this.systemPrompt = text?.trim() ? text.trim() : this.systemPrompt
  }

  public async chatWithGemini(message: string): Promise<string> {
    // Prepend the active mode/persona so Modes actually shape plain chat.
    const prompt = `${this.systemPrompt}\n\nUser: ${message}`;
    try {
      if (this.useOllama) {
        return this.callOllama(prompt);
      } else if (this.model) {
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        return response.text();
      } else {
        throw new Error("No LLM provider configured");
      }
    } catch (error) {
      console.error("[LLMHelper] Error in chatWithGemini:", error);
      throw error;
    }
  }

  public async chat(message: string): Promise<string> {
    return this.chatWithGemini(message);
  }

  public async chatWithImage(message: string, imagePaths: string[]): Promise<string> {
    try {
      // ponytail: most Ollama models are text-only — fall back to a text reply.
      if (this.useOllama) {
        return this.callOllama(message);
      }
      if (!this.model) {
        throw new Error("No LLM provider configured");
      }
      const imageParts = await Promise.all(imagePaths.map((p) => this.fileToGenerativePart(p)));
      const prompt = `${this.systemPrompt}\n\nThe user is looking at the attached screenshot(s) of their screen. Answer their message based on what is visible. Answer naturally and concisely.\n\nUser: ${message}`;
      const result = await this.model.generateContent([prompt, ...imageParts]);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error("[LLMHelper] Error in chatWithImage:", error);
      throw error;
    }
  }

  public async generateTeachingStep(
    goal: string,
    history: string[],
    screenshotPath: string,
    imageSize: { width: number; height: number }
  ): Promise<TeachingStepResponse> {
    if (this.useOllama) {
      throw new Error(
        "Teaching mode requires Gemini. Switch to Gemini and try again."
      )
    }
    if (!this.model) {
      throw new Error("Gemini is not configured for teaching mode.")
    }

    const imagePart = await this.fileToGenerativePart(screenshotPath)
    const result = await this.model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: buildTeachingPrompt(goal, history, imageSize) },
            imagePart
          ]
        }
      ],
      generationConfig: {
        temperature: 0,
        candidateCount: 1,
        // gemini-3.5-flash is a thinking model and maxOutputTokens caps the
        // TOTAL output including invisible reasoning tokens. 350 was consumed
        // by thinking, truncating the JSON (finishReason MAX_TOKENS). Give
        // generous headroom so the model can think AND emit the full object;
        // it stops naturally (finishReason STOP) once done, so a high cap only
        // adds safety, not cost. Override with TEACHING_MAX_OUTPUT_TOKENS.
        maxOutputTokens: Number(process.env.TEACHING_MAX_OUTPUT_TOKENS) || 8192
      }
    })
    const response = await result.response

    const finishReason = (response as any).candidates?.[0]?.finishReason
    let rawText = ""
    try {
      rawText = response.text()
    } catch (err) {
      console.error("[teaching] response.text() threw:", err)
    }

    // Turn a truncated/empty response into a clear, actionable error instead of
    // a cryptic "Invalid teaching JSON response".
    if (finishReason === "MAX_TOKENS") {
      throw new Error(
        "Teaching response was cut off before completing (MAX_TOKENS). " +
          "Increase maxOutputTokens or simplify the step and retry."
      )
    }
    if (!rawText.trim()) {
      throw new Error(
        `Teaching model returned no text (finishReason: ${finishReason ?? "unknown"}).`
      )
    }

    return parseTeachingModelText(rawText)
  }

  public isUsingOllama(): boolean {
    return this.useOllama;
  }

  public async getOllamaModels(): Promise<string[]> {
    if (!this.useOllama) return [];
    
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed to fetch models');
      
      const data = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      console.error("[LLMHelper] Error fetching Ollama models:", error);
      return [];
    }
  }

  public getCurrentProvider(): "ollama" | "gemini" {
    return this.useOllama ? "ollama" : "gemini";
  }

  public getCurrentModel(): string {
    return this.useOllama ? this.ollamaModel : this.geminiModel;
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    this.useOllama = true;
    if (url) this.ollamaUrl = url;
    
    if (model) {
      this.ollamaModel = model;
    } else {
      // Auto-detect first available model
      await this.initializeOllamaModel();
    }
    
    console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel} at ${this.ollamaUrl}`);
  }

  public async switchToGemini(apiKey?: string): Promise<void> {
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      this.model = genAI.getGenerativeModel({ model: this.geminiModel });
    }
    
    if (!this.model && !apiKey) {
      throw new Error("No Gemini API key provided and no existing model instance");
    }
    
    this.useOllama = false;
    console.log(`[LLMHelper] Switched to Gemini (${this.geminiModel})`);
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.useOllama) {
        const available = await this.checkOllamaAvailable();
        if (!available) {
          return { success: false, error: `Ollama not available at ${this.ollamaUrl}` };
        }
        // Test with a simple prompt
        await this.callOllama("Hello");
        return { success: true };
      } else {
        if (!this.model) {
          return { success: false, error: "No Gemini model configured" };
        }
        // Test with a simple prompt
        const result = await this.model.generateContent("Hello");
        const response = await result.response;
        const text = response.text(); // Ensure the response is valid
        if (text) {
          return { success: true };
        } else {
          return { success: false, error: "Empty response from Gemini" };
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
} 