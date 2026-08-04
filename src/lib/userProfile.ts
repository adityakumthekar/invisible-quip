// Who the user is, in their own words — role, seniority, stack, what they're
// interviewing for. The model had no such signal at all, which is why answers
// came back pitched at nobody in particular. Same shape as modes.ts: persisted
// in localStorage here, pushed to main, injected into every chat flow there.

const STORAGE_KEY = "quipProfile"

/**
 * The profile rides on every single request, so it spends the same budget the
 * transcript does (HISTORY_MAX_CHARS is 16000 in electron/chatHistory.ts). Two
 * thousand characters is a generous paragraph or two and leaves the session's
 * own history room to grow across a long interview.
 */
export const PROFILE_MAX_CHARS = 2000

export function getProfile(): string {
  return localStorage.getItem(STORAGE_KEY) ?? ""
}

export function setProfile(text: string): string {
  const clamped = text.slice(0, PROFILE_MAX_CHARS)
  localStorage.setItem(STORAGE_KEY, clamped)
  void window.electronAPI.invoke("set-user-profile", clamped)
  return clamped
}

/** Re-send the saved profile to the backend (call once on app start). */
export function applySavedProfile(): void {
  void window.electronAPI.invoke("set-user-profile", getProfile())
}
