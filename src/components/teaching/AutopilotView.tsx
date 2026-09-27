import React from "react"
import { AlertTriangle, Check, Play, Square, SkipForward } from "lucide-react"
import type { AutopilotConsent } from "../../types/electron"
import {
  autopilotProgressLabel,
  describeAutopilotPhase,
  describePendingAction,
  isAutopilotBusy,
  type AutopilotSessionState
} from "../../lib/autopilotSession"
import { describeAutonomyLevel, type AutonomyLevel } from "../../lib/autopilot"

const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  guarded: "Guarded",
  balanced: "Balanced",
  handsoff: "Hands-off"
}

export interface AutopilotConsentState {
  status: AutopilotConsent | null
  error: string | null
}

interface AutopilotViewProps {
  session: AutopilotSessionState
  consent: AutopilotConsentState
  onGoalChange: (goal: string) => void
  onStart: () => void
  onConfirm: () => void
  onReject: () => void
  onStop: () => void
  onAcceptConsent: () => void
}

const AutopilotView: React.FC<AutopilotViewProps> = ({
  session,
  consent,
  onGoalChange,
  onStart,
  onConfirm,
  onReject,
  onStop,
  onAcceptConsent
}) => {
  const busy = isAutopilotBusy(session)
  const progress = autopilotProgressLabel(session)
  const pending =
    session.phase === "awaiting-confirmation" ? session.update : null
  const pendingAction = describePendingAction(pending?.result)

  if (consent.error) {
    return (
      <p className="mt-4 text-body leading-relaxed glass-text" role="alert">
        {consent.error}
      </p>
    )
  }

  if (!consent.status) {
    return (
      <p className="mt-4 text-meta glass-muted" role="status">
        Checking autopilot status…
      </p>
    )
  }

  // One-time consent: driving the mouse and keyboard is a bigger ask than
  // capturing the screen, so it is gated separately from the privacy notice.
  if (!consent.status.consented) {
    return (
      <div className="mt-4 space-y-3">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 glass-icon"
            strokeWidth={1.75}
          />
          <p className="text-label leading-relaxed glass-text">
            {consent.status.text}
          </p>
        </div>
        <button
          type="button"
          onClick={onAcceptConsent}
          className="glass-action rounded-nested px-3 py-2 text-meta"
        >
          I understand — enable autopilot
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-3">
      {!busy && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            onStart()
          }}
        >
          <label
            htmlFor="autopilot-goal"
            className="block text-body glass-text"
          >
            What should Quip do?
          </label>
          <div className="flex gap-2">
            <input
              id="autopilot-goal"
              className="glass-control min-w-0 flex-1 rounded-nested px-3 py-2 text-body"
              value={session.goal}
              onChange={(event) => onGoalChange(event.target.value)}
              placeholder="For example, open my calendar and go to next week"
              autoFocus
              aria-label="Autopilot goal"
            />
            <button
              type="submit"
              disabled={!session.goal.trim()}
              className="glass-action flex items-center gap-1.5 rounded-nested px-3 py-2 text-meta disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5" strokeWidth={1.75} />
              Run
            </button>
          </div>
        </form>
      )}

      {(busy || session.update) && (
        <div aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <p className="text-meta uppercase tracking-wide glass-muted">
              {describeAutopilotPhase(session.phase)}
            </p>
            <div className="flex items-center gap-2">
              {/* Which safety envelope this run is under — fixed when it
                  started, so it can differ from what Settings shows now. */}
              {session.update?.autonomy && (
                <p
                  className="text-meta glass-subtle"
                  title={describeAutonomyLevel(session.update.autonomy)}
                >
                  {AUTONOMY_LABELS[session.update.autonomy]}
                </p>
              )}
              {progress && (
                <p className="text-meta glass-muted tabular-nums">{progress}</p>
              )}
            </div>
          </div>

          {session.update?.result?.instruction && (
            <p className="mt-2 text-title leading-relaxed glass-heading">
              {session.update.result.instruction}
            </p>
          )}

          {session.update?.stopReason && (
            <p className="mt-2 text-label glass-text">
              {session.update.stopReason}
            </p>
          )}

          {session.error && (
            <p className="mt-2 text-label glass-text" role="alert">
              {session.error}
            </p>
          )}
        </div>
      )}

      {pending && (
        <div
          className="rounded-nested bg-glass-soft px-2.5 py-2"
          role="alert"
          aria-live="assertive"
        >
          <p className="text-meta glass-heading">{pendingAction}</p>
          {pending.reasons && pending.reasons.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {pending.reasons.map((reason) => (
                <li key={reason} className="text-meta glass-muted">
                  · {reason}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className="glass-action flex items-center gap-1.5 rounded-nested px-3 py-2 text-meta"
            >
              <Check className="w-3.5 h-3.5" strokeWidth={1.75} />
              Approve
            </button>
            <button
              type="button"
              onClick={onReject}
              className="glass-control flex items-center gap-1.5 rounded-nested px-3 py-2 text-meta glass-text"
            >
              <SkipForward className="w-3.5 h-3.5" strokeWidth={1.75} />
              Skip
            </button>
          </div>
          <p className="mt-1.5 text-meta glass-muted">
            ⌘/Ctrl+⇧+Enter to approve · ⌘/Ctrl+⇧+Backspace to stop
          </p>
        </div>
      )}

      {busy && (
        <button
          type="button"
          onClick={onStop}
          className="glass-control flex items-center gap-1.5 rounded-nested px-3 py-2 text-meta glass-text"
        >
          <Square className="w-3 h-3" strokeWidth={1.75} />
          Stop
        </button>
      )}
    </div>
  )
}

export default AutopilotView
