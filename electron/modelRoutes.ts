import fs from "fs"
import path from "path"
import type { SttProvider } from "./speechToText"

/**
 * Which Bedrock model answers each kind of request, and what to try when it
 * fails. Lives in quip.models.json beside .env, so a model can be swapped or
 * demoted without a rebuild. In each list the first ID is the default and the
 * rest are fallbacks, in order. A task the file leaves out uses
 * BEDROCK_MODEL_ID.
 */
export type ModelTask = "voice" | "chat" | "screenshot" | "autopilot"

export const MODEL_TASKS: readonly ModelTask[] = ["voice", "chat", "screenshot", "autopilot"]

export const MODEL_ROUTES_FILE = "quip.models.json"

export interface ModelRoutes {
  /** Overrides AWS_REGION: the profiles listed are only valid in one region. */
  region?: string
  tasks: Partial<Record<ModelTask, string[]>>
  /** Speech-to-text services, default first. Overrides STT_PROVIDER. */
  stt?: SttProvider[]
}

/** Same rule as .env: beside the bundled copy when packaged, the project root in dev. */
export function modelRoutesPath(
  isPackaged: boolean,
  resourcesPath: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (env.QUIP_MODELS_CONFIG) return env.QUIP_MODELS_CONFIG
  return isPackaged ? path.join(resourcesPath, MODEL_ROUTES_FILE) : path.resolve(MODEL_ROUTES_FILE)
}

/** Null when there is no file; a typo throws, naming the field, rather than quietly using defaults. */
export function loadModelRoutes(file: string): ModelRoutes | null {
  if (!fs.existsSync(file)) return null
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${file} is not valid JSON: ${message}`)
  }
  return parseModelRoutes(raw, file)
}

const isIdList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((id) => typeof id === "string" && id.trim().length > 0)

/** Keys starting with "_" are notes for whoever edits the file. */
export function parseModelRoutes(raw: unknown, source: string = MODEL_ROUTES_FILE): ModelRoutes {
  const fail = (problem: string): never => {
    throw new Error(`${source}: ${problem}`)
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("must be a JSON object")
  const routes: ModelRoutes = { tasks: {} }

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith("_")) continue
    if (key === "region") {
      if (typeof value !== "string" || !value.trim()) fail("region must be a region name such as ap-south-1")
      routes.region = (value as string).trim()
    } else if (key === "tasks") {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("tasks must be an object")
      for (const [task, ids] of Object.entries(value as Record<string, unknown>)) {
        if (task.startsWith("_")) continue
        if (!MODEL_TASKS.includes(task as ModelTask)) {
          fail(`unknown task "${task}" (expected voice, chat, screenshot or autopilot)`)
        }
        if (!isIdList(ids)) fail(`tasks.${task} must be a non-empty list of model IDs`)
        routes.tasks[task as ModelTask] = (ids as string[]).map((id) => id.trim())
      }
    } else if (key === "stt") {
      const valid =
        Array.isArray(value) && value.length > 0 && value.every((p) => p === "groq" || p === "sarvam")
      if (!valid) fail('stt must list "groq" and/or "sarvam", default first')
      routes.stt = value as SttProvider[]
    } else {
      fail(`unknown setting "${key}" (expected region, tasks or stt)`)
    }
  }
  return routes
}
