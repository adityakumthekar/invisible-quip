import {
  BedrockRuntimeClient,
  ContentBlock,
  ConverseCommand,
  ConverseStreamCommand,
  Message
} from "@aws-sdk/client-bedrock-runtime"
import { ConverseTurn } from "./chatHistory"

export interface BedrockConfig {
  /** A Bedrock API key — sent as a bearer token, not SigV4. */
  apiKey: string
  region: string
  /** A Claude model or inference-profile ID, copied from the Bedrock console. */
  modelId: string
}

export interface ConverseRequest {
  system?: string
  messages: Message[]
  temperature: number
  maxTokens: number
}

/**
 * Thin wrapper over the Converse API: the only place that knows the SDK's
 * shapes, so LLMHelper deals in strings and image buffers.
 */
export class BedrockClient {
  private client: BedrockRuntimeClient

  constructor(readonly config: BedrockConfig) {
    this.client = new BedrockRuntimeClient({
      region: config.region,
      token: { token: config.apiKey },
      // SigV4 is the SDK's first choice. Without this, AWS credentials lying
      // around in ~/.aws would be used instead of the key the user gave us.
      authSchemePreference: ["httpBearerAuth"]
    })
  }

  private command(req: ConverseRequest) {
    return {
      modelId: this.config.modelId,
      messages: req.messages,
      ...(req.system ? { system: [{ text: req.system }] } : {}),
      inferenceConfig: {
        temperature: req.temperature,
        maxTokens: req.maxTokens
      }
    }
  }

  async converse(
    req: ConverseRequest
  ): Promise<{ text: string; stopReason?: string }> {
    const response = await this.client.send(
      new ConverseCommand(this.command(req))
    )
    const text = (response.output?.message?.content ?? [])
      .map((block) => block.text ?? "")
      .join("")
    return { text, stopReason: response.stopReason }
  }

  /**
   * Same contract as `consumeGeminiStream`: forward each delta, return the full
   * text. The signal also goes to the SDK, so an abort cancels the request
   * instead of paying for tokens nobody will read — and that cancellation is a
   * normal end, not an error.
   */
  async converseStream(
    req: ConverseRequest,
    onChunk: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    let text = ""
    try {
      const response = await this.client.send(
        new ConverseStreamCommand(this.command(req)),
        { abortSignal: signal }
      )
      for await (const event of response.stream ?? []) {
        if (signal?.aborted) break
        const delta = event.contentBlockDelta?.delta?.text
        if (!delta) continue
        text += delta
        onChunk(delta)
      }
    } catch (error) {
      if (signal?.aborted) return text
      throw error
    }
    return text
  }
}

export function imageBlock(bytes: Buffer, format: "png" | "jpeg"): ContentBlock {
  return { image: { format, source: { bytes } } }
}

/**
 * Append this turn's user content to the history. History can end on a user
 * turn (an aborted answer), and Converse rejects two in a row, so that case
 * merges into it rather than appending.
 */
export function withUserTurn(
  history: ConverseTurn[],
  content: ContentBlock[]
): Message[] {
  const messages: Message[] = history.map((turn) => ({
    role: turn.role,
    content: [...turn.content]
  }))
  const last = messages[messages.length - 1]
  if (last?.role === "user") {
    last.content = [...(last.content ?? []), ...content]
  } else {
    messages.push({ role: "user", content })
  }
  return messages
}
