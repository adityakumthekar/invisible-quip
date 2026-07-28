// frontmostApp.ts
//
// Who owns the screen right now. Autopilot's whole pipeline is pixel-based — it
// clicks a point, it has no idea what lives there — so this is the one place
// that answers "which application am I about to type into?".
//
// macOS only, via osascript, with no new dependency. Every failure path returns
// null rather than throwing: a missing answer is handled upstream as
// "fail closed, ask the human", which is safe, whereas a throw would kill a run.

import { execFile } from "child_process"

export interface FrontmostApp {
  bundleId: string
  name: string
}

/**
 * Pass `fresh` to bypass the cache — used when re-checking focus after a human
 * confirmation, where a stale reading is exactly the thing we're guarding against.
 */
export type FrontmostAppProbe = (fresh?: boolean) => Promise<FrontmostApp | null>

/** Runs the probe command and resolves its stdout. Injected so tests never shell out. */
export type ProbeRunner = () => Promise<string>

/** osascript can hang on a wedged System Events; cap it well under a step's settle time. */
export const PROBE_TIMEOUT_MS = 600

/**
 * How long a reading stays fresh. A single step probes twice (once to classify,
 * once again after a confirmation to catch focus moving), and back-to-back
 * probes should not pay for two subprocesses.
 */
export const PROBE_CACHE_MS = 500

const OSASCRIPT_ARGS = [
  "-e",
  // The parentheses matter: without them AppleScript applies `whose` to the
  // property list rather than to the process, and errors out.
  'tell application "System Events" to get {bundle identifier, name} of (first application process whose frontmost is true)'
]

/** True when this platform has a frontmost-app probe at all. */
export function isFrontmostAppProbeSupported(
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === "darwin"
}

const defaultRunner: ProbeRunner = () =>
  new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      OSASCRIPT_ARGS,
      { timeout: PROBE_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(stdout)
      }
    )
  })

/**
 * osascript prints an AppleScript list as `com.apple.Terminal, Terminal`. App
 * names can contain commas, so only the first separator is significant.
 */
export function parseFrontmostAppOutput(raw: string): FrontmostApp | null {
  const line = raw.trim()
  if (!line) {
    return null
  }

  const separator = line.indexOf(",")
  if (separator === -1) {
    return null
  }

  const bundleId = line.slice(0, separator).trim()
  const name = line.slice(separator + 1).trim()
  if (!bundleId || !name) {
    return null
  }

  return { bundleId, name }
}

export function createFrontmostAppProbe(
  run: ProbeRunner = defaultRunner,
  options: {
    supported?: boolean
    cacheMs?: number
    now?: () => number
  } = {}
): FrontmostAppProbe {
  const supported = options.supported ?? isFrontmostAppProbeSupported()
  const cacheMs = options.cacheMs ?? PROBE_CACHE_MS
  const now = options.now ?? Date.now

  let cached: FrontmostApp | null = null
  let cachedAt = -Infinity

  return async (fresh = false) => {
    if (!supported) {
      return null
    }

    if (!fresh && now() - cachedAt < cacheMs) {
      return cached
    }

    let result: FrontmostApp | null = null
    try {
      result = parseFrontmostAppOutput(await run())
    } catch {
      // Not granted, timed out, osascript missing — all "we don't know".
      result = null
    }

    cached = result
    cachedAt = now()
    return result
  }
}

/** The app-wide probe, shared so its cache is shared. */
export const getFrontmostApp: FrontmostAppProbe = createFrontmostAppProbe()
