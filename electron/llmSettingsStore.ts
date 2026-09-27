// llmSettingsStore.ts
//
// Remembers which model the user picked in Settings.
//
// Without this, `switchToQwen`/`switchToGemini` only mutate LLMHelper's fields
// and ProcessingHelper reads process.env at construction — so the Settings
// choice quietly reverted to whatever .env said on the next launch.
//
// Same split as privacyAcknowledgement.ts: a pure parser plus a store over
// injected I/O. The parser is exported on its own because ProcessingHelper's
// constructor is synchronous and reads the file with fs.readFileSync — it
// shares the parsing without sharing the async plumbing.

export const LLM_SETTINGS_VERSION = 1

/**
 * Lives here rather than next to either reader so that ipcHandlers (which
 * writes it) and ProcessingHelper (which reads it at startup) can share the
 * name without importing each other — that would close a require cycle through
 * main.ts.
 */
export const LLM_SETTINGS_FILENAME = "llm-settings.json"

export type StoredProvider = "gemini" | "qwen" | "ollama"

export interface LlmSettings {
  version: number
  provider: StoredProvider
  qwen?: {
    baseUrl?: string
    model?: string
    apiKey?: string
  }
  gemini?: {
    apiKey?: string
  }
  ollama?: {
    url?: string
    model?: string
  }
}

const PROVIDERS: readonly StoredProvider[] = ["gemini", "qwen", "ollama"]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function parseSection<K extends string>(
  raw: unknown,
  keys: readonly K[]
): Partial<Record<K, string>> | undefined {
  if (!isPlainObject(raw)) {
    return undefined
  }

  const section: Partial<Record<K, string>> = {}
  for (const key of keys) {
    const value = optionalString(raw[key])
    if (value !== undefined) {
      section[key] = value
    }
  }
  return Object.keys(section).length > 0 ? section : undefined
}

/**
 * Returns null for anything unrecognised, so a corrupt file degrades to the
 * environment rather than throwing during app startup.
 */
export function parseLlmSettings(raw: string): LlmSettings | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isPlainObject(data) || data.version !== LLM_SETTINGS_VERSION) {
    return null
  }

  if (
    typeof data.provider !== "string" ||
    !PROVIDERS.includes(data.provider as StoredProvider)
  ) {
    return null
  }

  const settings: LlmSettings = {
    version: LLM_SETTINGS_VERSION,
    provider: data.provider as StoredProvider
  }

  const qwen = parseSection(data.qwen, ["baseUrl", "model", "apiKey"] as const)
  if (qwen) settings.qwen = qwen

  const gemini = parseSection(data.gemini, ["apiKey"] as const)
  if (gemini) settings.gemini = gemini

  const ollama = parseSection(data.ollama, ["url", "model"] as const)
  if (ollama) settings.ollama = ollama

  return settings
}

export interface LlmSettingsStoreDependencies {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, contents: string) => Promise<void>
}

export class LlmSettingsStore {
  constructor(
    private readonly filePath: string,
    private readonly dependencies: LlmSettingsStoreDependencies
  ) {}

  public async read(): Promise<LlmSettings | null> {
    try {
      return parseLlmSettings(await this.dependencies.readFile(this.filePath))
    } catch {
      return null
    }
  }

  /**
   * Merge one provider's settings over whatever is stored and make it current.
   * Merging rather than replacing keeps the other provider's details around, so
   * switching to Gemini and back doesn't lose the vLLM URL you typed.
   */
  public async save(
    provider: StoredProvider,
    details: Pick<LlmSettings, "qwen" | "gemini" | "ollama">
  ): Promise<LlmSettings> {
    const existing = await this.read()
    const settings: LlmSettings = {
      version: LLM_SETTINGS_VERSION,
      provider,
      ...(existing?.qwen || details.qwen
        ? { qwen: { ...existing?.qwen, ...details.qwen } }
        : {}),
      ...(existing?.gemini || details.gemini
        ? { gemini: { ...existing?.gemini, ...details.gemini } }
        : {}),
      ...(existing?.ollama || details.ollama
        ? { ollama: { ...existing?.ollama, ...details.ollama } }
        : {})
    }

    await this.dependencies.writeFile(
      this.filePath,
      JSON.stringify(settings, null, 2)
    )
    return settings
  }
}
