// Shared, Electron-agnostic types and constants for the Teach Me privacy
// gate (one-time acknowledgement + per-process self-capture preflight).
// Consumed by both the main process and the renderer (via src/lib re-exports).

export const PRIVACY_ACKNOWLEDGEMENT_VERSION = 1

/**
 * Exact, required copy for the one-time Teach Me acknowledgement. Do not
 * reword: it must not claim universal invisibility, and must direct the
 * user to verify their own share preview.
 */
export const PRIVACY_ACKNOWLEDGEMENT_TEXT =
  "Quip uses capture protection and is normally hidden from Zoom/Meet/Teams-style sharing, but exclusion is best-effort and the user must verify the share preview."

export const AUTOPILOT_CONSENT_VERSION = 1

/**
 * Separate, one-time consent for unattended control. Screenshotting the screen
 * and driving the mouse and keyboard on it are materially different asks, so
 * acknowledging the first does not imply the second.
 */
export const AUTOPILOT_CONSENT_TEXT =
  "In autopilot, Quip clicks, types, and scrolls on your real screen by itself. It pauses for your approval before actions that are hard to undo, but its view of the screen can be wrong. Stay at the machine and press Cmd/Ctrl+Shift+Backspace to stop it at any time."

/**
 * Shown whenever INVISIBLE=false. That switch is a deliberate opt-out of
 * capture protection, so the self-capture preflight can never pass and gating
 * on it would leave Teach Me permanently unreachable. Teaching is allowed and
 * this warning stays on screen for the whole session instead.
 */
export const VISIBLE_MODE_WARNING =
  "INVISIBLE=false disables capture protection for debugging, so Quip is intentionally capturable right now."
export const VISIBLE_MODE_REMEDIATION =
  "Set INVISIBLE=true (or unset it) and restart Quip before teaching during a real screen share."

export interface PrivacyAcknowledgementRecord {
  version: number
  acknowledgedAt: string
}

export type PrivacyPreflightStatus = "pass" | "fail" | "error"

export interface PrivacyPreflightResult {
  status: PrivacyPreflightStatus
  reason: string
  remediation?: string
  debugMode: boolean
}

export interface PrivacyGateStatus {
  acknowledged: boolean
  acknowledgementText: string
  acknowledgementVersion: number
  preflightPassed: boolean
  lastPreflightResult: PrivacyPreflightResult | null
  /**
   * INVISIBLE=false — Quip is capturable right now. Read from the environment
   * rather than from `lastPreflightResult.debugMode`, so the gate knows before
   * the preflight has ever run and the user needs no extra click.
   */
  visibleMode: boolean
}

export type PrivacyGateBlockReason = "acknowledgement" | "preflight"

export type PrivacyGateWarning = "visible-mode"

export interface PrivacyGateDecision {
  canStart: boolean
  blockingReason?: PrivacyGateBlockReason
  /** Set when teaching is allowed but something must stay visible on screen. */
  warning?: PrivacyGateWarning
}
