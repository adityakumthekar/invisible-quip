import React from "react"
import { RefreshCw, ShieldCheck } from "lucide-react"
import type { PrivacyGateStatus } from "../../lib/privacyContract"
import { evaluatePrivacyGate } from "../../lib/privacyGate"

export interface TeachingPrivacyState {
  status: PrivacyGateStatus | null
  checking: boolean
  error: string | null
}

interface PrivacyGateNoticeProps {
  privacy: TeachingPrivacyState
  onAcknowledge: () => void
  onRunCheck: () => void
}

/**
 * The one-time capture disclosure plus the per-process preflight check.
 * Shared by both panel modes — extracted from TeachingPanel so adding
 * autopilot didn't duplicate ~70 lines of gate rendering.
 */
const PrivacyGateNotice: React.FC<PrivacyGateNoticeProps> = ({
  privacy,
  onAcknowledge,
  onRunCheck
}) => {
  if (!privacy.status && !privacy.error) {
    return (
      <p className="mt-4 text-meta glass-muted" role="status">
        Checking privacy status…
      </p>
    )
  }

  if (privacy.error) {
    return (
      <p className="mt-4 text-body leading-relaxed glass-text" role="alert">
        {privacy.error}
      </p>
    )
  }

  if (!privacy.status) {
    return null
  }

  const gate = evaluatePrivacyGate(privacy.status)

  if (gate.blockingReason === "acknowledgement") {
    return (
      <div className="mt-4 space-y-3">
        <div className="flex items-start gap-2">
          <ShieldCheck
            className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 glass-icon"
            strokeWidth={1.75}
          />
          <p className="text-label leading-relaxed glass-text">
            {privacy.status.acknowledgementText}
          </p>
        </div>
        <button
          type="button"
          onClick={onAcknowledge}
          className="glass-action rounded-nested px-3 py-2 text-meta"
        >
          I understand
        </button>
      </div>
    )
  }

  if (gate.blockingReason === "preflight") {
    return (
      <div className="mt-4 space-y-3">
        <p className="text-label leading-relaxed glass-text">
          Before this session, Quip runs a local, one-time check to see whether
          a test marker leaks into a screenshot. This is best-effort — always
          verify your own share preview too.
        </p>
        {privacy.status.lastPreflightResult && (
          <div
            role={
              privacy.status.lastPreflightResult.status === "pass"
                ? "status"
                : "alert"
            }
            className="rounded-nested bg-glass-soft px-2.5 py-2"
          >
            <p className="text-meta glass-muted">
              {privacy.status.lastPreflightResult.reason}
            </p>
            {privacy.status.lastPreflightResult.remediation && (
              <p className="mt-1 text-meta glass-muted">
                {privacy.status.lastPreflightResult.remediation}
              </p>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onRunCheck}
          disabled={privacy.checking}
          className="glass-action flex items-center gap-1.5 rounded-nested px-3 py-2 text-meta disabled:opacity-40"
        >
          <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
          {privacy.checking
            ? "Checking…"
            : privacy.status.lastPreflightResult
              ? "Retry privacy check"
              : "Run privacy check"}
        </button>
      </div>
    )
  }

  return null
}

export default PrivacyGateNotice
