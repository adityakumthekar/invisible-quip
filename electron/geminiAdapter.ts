/** Compatibility boundary for the preserved local/developer flows, backed by the supported SDK. */
import {
  GoogleGenAI,
  type Content,
  type Part,
  type GenerateContentConfig,
} from "@google/genai";
export type { Part };
export interface GenerateContentRequest {
  contents: Content[];
  generationConfig?: GenerateContentConfig;
  systemInstruction?: Content;
}
export class GoogleGenerativeAI {
  private client: GoogleGenAI;
  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }
  getGenerativeModel({ model }: { model: string }) {
    return new GenerativeModel(this.client, model);
  }
}
export class GenerativeModel {
  constructor(
    private client: GoogleGenAI,
    private model: string,
  ) {}
  private params(request: GenerateContentRequest | string) {
    if (typeof request === "string")
      return { model: this.model, contents: request };
    return {
      model: this.model,
      contents: request.contents,
      config: {
        ...request.generationConfig,
        systemInstruction: request.systemInstruction,
      },
    };
  }
  async generateContent(request: GenerateContentRequest | string) {
    const result = await this.client.models.generateContent(
      this.params(request),
    );
    return {
      response: {
        text: () => result.text || "",
        candidates: result.candidates,
      },
    };
  }
  async generateContentStream(request: GenerateContentRequest) {
    const result = await this.client.models.generateContentStream(
      this.params(request),
    );
    return {
      stream: (async function* () {
        for await (const item of result) yield { text: () => item.text || "" };
      })(),
    };
  }
}
