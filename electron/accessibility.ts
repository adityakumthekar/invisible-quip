// accessibility.ts
//
// macOS gates synthetic mouse/keyboard input behind the Accessibility
// permission (separate from Screen Recording). This helper checks — and, the
// first time, prompts for — that permission before we actuate any input.

import { systemPreferences } from "electron"

export const ACCESSIBILITY_PERMISSION_ERROR =
  "Input control blocked by macOS. Grant Accessibility permission to this app in System Settings → Privacy & Security → Accessibility, then restart the app."

/**
 * Ensure this process is trusted to control the mouse and keyboard. On macOS
 * that requires Accessibility permission; when not yet granted and `prompt` is
 * true, macOS opens the settings pane. Throws an actionable error until it is
 * granted. No-op on other platforms.
 */
export function ensureAccessibilityPermission(prompt = true): void {
  if (process.platform !== "darwin") {
    return
  }
  if (!systemPreferences.isTrustedAccessibilityClient(prompt)) {
    throw new Error(ACCESSIBILITY_PERMISSION_ERROR)
  }
}
