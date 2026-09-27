// autonomyStore.ts
//
// Persists how much autopilot may do without asking. Modelled on
// PrivacyAcknowledgementStore: a pure parser plus a thin store over injected
// file I/O, so the parsing is unit-testable without touching a disk.
//
// This is a safety envelope, so it lives in main rather than renderer
// localStorage (where the appearance and mode preferences live) — the renderer
// asks for a change, main decides whether to honour it, and the loop reads the
// stored value at the start of each run.

import {
  DEFAULT_AUTONOMY_LEVEL,
  parseAutonomyLevel,
  type AutonomyLevel
} from "./autopilotPolicy"

export const AUTONOMY_RECORD_VERSION = 1

export interface AutonomyRecord {
  version: number
  level: AutonomyLevel
  updatedAt: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Returns null for anything we don't recognise — the caller then defaults. */
export function parseAutonomyRecord(raw: string): AutonomyRecord | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isPlainObject(data) || data.version !== AUTONOMY_RECORD_VERSION) {
    return null
  }

  const level = parseAutonomyLevel(data.level)
  if (level === null || typeof data.updatedAt !== "string") {
    return null
  }

  return { version: AUTONOMY_RECORD_VERSION, level, updatedAt: data.updatedAt }
}

export interface AutonomyStoreDependencies {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, contents: string) => Promise<void>
  now: () => Date
}

export class AutonomyStore {
  /**
   * Cached so the loop can read the level synchronously at run start, the same
   * way it reads the provider. Populated by `load()` and kept current by
   * `setLevel()`; until the first load it reports the default.
   */
  private cached: AutonomyLevel = DEFAULT_AUTONOMY_LEVEL

  constructor(
    private readonly filePath: string,
    private readonly dependencies: AutonomyStoreDependencies
  ) {}

  /** The last known level. Never throws — a missing file means the default. */
  public getLevel(): AutonomyLevel {
    return this.cached
  }

  public async load(): Promise<AutonomyLevel> {
    try {
      const raw = await this.dependencies.readFile(this.filePath)
      this.cached = parseAutonomyRecord(raw)?.level ?? DEFAULT_AUTONOMY_LEVEL
    } catch {
      this.cached = DEFAULT_AUTONOMY_LEVEL
    }
    return this.cached
  }

  public async setLevel(level: AutonomyLevel): Promise<AutonomyRecord> {
    const record: AutonomyRecord = {
      version: AUTONOMY_RECORD_VERSION,
      level,
      updatedAt: this.dependencies.now().toISOString()
    }
    await this.dependencies.writeFile(this.filePath, JSON.stringify(record))
    this.cached = level
    return record
  }
}
