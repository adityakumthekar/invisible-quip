import type { PrivacyGateDecision, PrivacyGateStatus } from "./privacyContract"

/**
 * Single source of truth for whether Teach Me is allowed to start. Checked
 * both client-side (to drive the gating UI) and server-side inside the
 * `teach-start` IPC handler, so it can't be bypassed from the renderer.
 */
export function evaluatePrivacyGate(status: PrivacyGateStatus): PrivacyGateDecision {
  if (!status.acknowledged) {
    return { canStart: false, blockingReason: "acknowledgement" }
  }
  // INVISIBLE=false is a deliberate opt-out of capture protection, so the
  // preflight can never pass and gating on it would make Teach Me unreachable.
  // Warn loudly instead of blocking; the banner stays up for the whole session.
  if (status.visibleMode) {
    return { canStart: true, warning: "visible-mode" }
  }
  if (!status.preflightPassed) {
    return { canStart: false, blockingReason: "preflight" }
  }
  return { canStart: true }
}
