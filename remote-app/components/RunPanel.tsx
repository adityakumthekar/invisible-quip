import React, { useState } from "react"
import {
  autopilotProgressLabel,
  describeAutopilotPhase,
  describePendingAction,
  isAutopilotBusy,
  type AutopilotSessionState
} from "../../src/lib/autopilotSession"
import type { RemoteStatus } from "../../src/lib/remoteProtocol"

interface RunPanelProps {
  session: AutopilotSessionState
  status: RemoteStatus | null
  latestFrame: string | null
  onStart: (goal: string) => void
  onConfirm: () => void
  onReject: () => void
}

/**
 * Turn the status's blocking reason into something actionable. Every one of
 * these can only be cleared at the laptop, so the copy has to say so rather
 * than leaving the user tapping a button that will keep failing.
 */
function describeBlocker(status: RemoteStatus | null): string | null {
  if (!status) {
    return null
  }
  if (!status.controlEnabled) {
    return "Remote control isn't enabled yet. On the laptop, open Settings → Remote and accept the remote-control notice."
  }
  switch (status.gateBlockedBy) {
    case "acknowledgement":
      return "The laptop still needs its privacy notice acknowledged before autopilot can run."
    case "preflight":
      return "The laptop needs to pass its privacy check. Run it from Settings there, then try again."
    case "autopilot-consent":
      return "Autopilot hasn't been consented to on the laptop yet."
    default:
      return null
  }
}

const RunPanel: React.FC<RunPanelProps> = ({
  session,
  status,
  latestFrame,
  onStart,
  onConfirm,
  onReject
}) => {
  const [goal, setGoal] = useState("")
  const busy = isAutopilotBusy(session)
  const progress = autopilotProgressLabel(session)
  const pending =
    session.phase === "awaiting-confirmation" ? session.update : null
  const pendingAction = describePendingAction(pending?.result)
  const blocker = describeBlocker(status)

  return (
    <div className="panel">
      {blocker && (
        <div className="card">
          <p className="notice" role="status">
            {blocker}
          </p>
        </div>
      )}

      {!busy && (
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = goal.trim()
            if (trimmed) {
              onStart(trimmed)
            }
          }}
        >
          <label htmlFor="goal">What should Quip do?</label>
          <textarea
            id="goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value.slice(0, 2000))}
            placeholder="Open my calendar and go to next week"
            rows={2}
          />
          <button
            type="submit"
            className="primary"
            style={{ width: "100%", marginTop: 12 }}
            disabled={!goal.trim() || Boolean(blocker)}
          >
            Run
          </button>
        </form>
      )}

      {(busy || session.update) && (
        <div className="card" aria-live="polite">
          <div className="phase">
            <strong>{describeAutopilotPhase(session.phase)}</strong>
            {progress && <span>{progress}</span>}
          </div>

          {session.update?.result?.instruction && (
            <p className="instruction">{session.update.result.instruction}</p>
          )}

          {session.update?.stopReason && (
            <p className="notice" style={{ marginTop: 8 }}>
              {session.update.stopReason}
            </p>
          )}

          {session.error && (
            <p className="error" style={{ marginTop: 8 }} role="alert">
              {session.error}
            </p>
          )}

          {pending && (
            <div className="pending" role="alert" aria-live="assertive">
              <p>{pendingAction}</p>

              {pending.reasons && pending.reasons.length > 0 && (
                <ul className="reasons">
                  {pending.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}

              {/* The screen as it was when the step was proposed. Approving an
                  action you cannot see is not meaningful consent, so this sits
                  inside the prompt rather than on a separate tab. */}
              {latestFrame && (
                <img
                  className="frame"
                  src={latestFrame}
                  alt="The laptop screen at the moment this action was proposed"
                  style={{ marginBottom: 10 }}
                />
              )}

              <div className="row">
                <button type="button" className="primary" onClick={onConfirm}>
                  Approve
                </button>
                <button type="button" onClick={onReject}>
                  Skip
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default RunPanel
