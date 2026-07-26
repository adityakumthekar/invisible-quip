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
}

export type PrivacyGateBlockReason = "acknowledgement" | "preflight"

export interface PrivacyGateDecision {
  canStart: boolean
  blockingReason?: PrivacyGateBlockReason
}
