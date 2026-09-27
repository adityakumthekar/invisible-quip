import React from "react"
import { AlertTriangle } from "lucide-react"
import {
  VISIBLE_MODE_REMEDIATION,
  VISIBLE_MODE_WARNING
} from "../../lib/privacyContract"

/**
 * Shown for the whole session whenever INVISIBLE=false. Teaching is allowed in
 * that mode — the preflight can never pass, so gating on it made Teach Me
 * unreachable — but the user must never lose sight of the fact that Quip is
 * currently capturable.
 */
const VisibleModeBanner: React.FC = () => (
  <div
    role="alert"
    className="glass-warning-panel mt-3 flex items-start gap-2 px-2.5 py-2"
  >
    <AlertTriangle
      className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 text-glass-warning"
      strokeWidth={1.75}
    />
    <div>
      <p className="text-label leading-relaxed glass-text">
        {VISIBLE_MODE_WARNING}
      </p>
      <p className="mt-1 text-meta leading-relaxed glass-muted">
        {VISIBLE_MODE_REMEDIATION}
      </p>
    </div>
  </div>
)

export default VisibleModeBanner
