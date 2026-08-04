// config.ts
//
// Where the laptop is.
//
// The web build is served by the laptop, so it can just use relative URLs. The
// Capacitor build is not: it runs from http://localhost inside the APK and has
// to be told an address. Baking one in at build time was tempting and wrong —
// a home network hands out a different IP eventually, and an APK that stops
// working when the DHCP lease rolls over is a disposable APK.
//
// So: relative when we were served from the laptop, stored-and-editable when
// we were not.

const BASE_URL_KEY = "quipRemoteBaseUrl"
export const DEFAULT_REMOTE_PORT = 41777

/**
 * True when the page was loaded from the laptop itself, i.e. the browser
 * fallback rather than the installed app. Capacitor serves the bundle from
 * localhost, so that is the tell.
 */
export function isServedByLaptop(): boolean {
  const { hostname, protocol } = window.location
  if (protocol === "capacitor:" || protocol === "file:") {
    return false
  }
  return hostname !== "localhost" && hostname !== "127.0.0.1"
}

function readStoredBaseUrl(): string | null {
  try {
    return localStorage.getItem(BASE_URL_KEY)
  } catch {
    return null
  }
}

/**
 * The origin every request is built against. Empty string means "relative",
 * which is what the browser fallback wants.
 */
export function getBaseUrl(): string {
  if (isServedByLaptop()) {
    return ""
  }
  return readStoredBaseUrl() ?? ""
}

export function hasBaseUrl(): boolean {
  return isServedByLaptop() || readStoredBaseUrl() !== null
}

/**
 * Accept what someone would actually type — "192.168.1.5", with or without a
 * scheme or port — and turn it into an origin. Returns null if it cannot.
 */
export function normalizeBaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "")
  if (!trimmed) {
    return null
  }

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (!url.hostname) {
    return null
  }
  // A bare address means the default port, not port 80.
  if (!url.port && !/:\d+$/.test(trimmed)) {
    url.port = String(DEFAULT_REMOTE_PORT)
  }
  return url.origin
}

export function setBaseUrl(raw: string): string | null {
  const normalized = normalizeBaseUrl(raw)
  if (!normalized) {
    return null
  }
  try {
    localStorage.setItem(BASE_URL_KEY, normalized)
  } catch {
    // Non-fatal: works until the app is closed.
  }
  return normalized
}

export function clearBaseUrl(): void {
  try {
    localStorage.removeItem(BASE_URL_KEY)
  } catch {
    // Nothing to do.
  }
}

/** Build an absolute (or relative) URL for an API path. */
export function apiUrl(path: string): string {
  return `${getBaseUrl()}${path}`
}
