// remoteHttp.ts
//
// The parts of the remote server that are decidable without a socket: header
// parsing, LAN address selection, and static path resolution. Split out from
// remoteServer.ts because that file imports `electron` and so can't be loaded
// in a unit test — and because path traversal and origin checking are exactly
// the logic that most deserves one.
//
// Cookie handling used to live here. It went when the client stopped being
// same-origin with the server: see remoteTickets.ts for what replaced it.

import path from "node:path"
import type os from "node:os"

export const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon"
}

export function contentTypeFor(filePath: string): string {
  return (
    CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream"
  )
}

/**
 * First non-internal IPv4 address. Wi-Fi and Ethernet both land here; if the
 * machine has several, the first is a good enough guess, and the Settings tab
 * shows the resulting URL so the user can see what it picked.
 */
export function findLanAddress(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>
): string | null {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address
      }
    }
  }
  return null
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) {
    return null
  }
  const match = /^Bearer +(\S+)$/.exec(header.trim())
  return match ? match[1] : null
}

/**
 * Resolve a URL path inside `root`, or null if it escapes.
 *
 * Traversal is the classic static-file hole, and this process can read the
 * user's entire home directory, so the check is by resolved prefix rather than
 * by pattern-matching "..": percent-encoding, backslashes, doubled separators,
 * and absolute paths all collapse in `path.resolve` before the comparison.
 */
export function resolveStaticPath(
  root: string,
  urlPath: string
): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes("\0")) {
    return null
  }

  const base = path.resolve(root)
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "")
  const resolved = path.resolve(base, relative)

  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    return null
  }
  return resolved
}

/**
 * Reject a request whose Origin isn't ours. Redundant with the Bearer scheme
 * used for commands, but it costs nothing and closes the gap if a handler is
 * ever added that authenticates by cookie instead.
 */
export function isSameOrigin(
  origin: string | undefined,
  host: string | undefined
): boolean {
  if (!origin) {
    // Non-browser clients (curl, and the pairing fetch on first load) send none.
    return true
  }
  if (!host) {
    return false
  }
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
