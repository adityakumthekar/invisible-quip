import React from "react"
import { ArrowRight, RefreshCw, ShieldCheck, Square, X } from "lucide-react"
import type {
  TeachingOperation,
  TeachingSessionState
} from "../../lib/teachingSession"
import type { PrivacyGateStatus } from "../../lib/privacyContract"
import { evaluatePrivacyGate } from "../../lib/privacyGate"

export interface TeachingPrivacyState {
  status: PrivacyGateStatus | null
  checking: boolean
  error: string | null
}

interface TeachingPanelProps {
  session: TeachingSessionState
  privacy: TeachingPrivacyState
  onGoalChange: (goal: string) => void
  onStart: () => void
  onNext: () => void
  onRetry: (operation: TeachingOperation) => void
  onStop: () => void
  onClose: () => void
  onAcknowledgePrivacy: () => void
  onRunPrivacyCheck: () => void
}

const TeachingPanel: React.FC<TeachingPanelProps> = ({
  session,
  privacy,
  onGoalChange,
  onStart,
  onNext,
  onRetry,
  onStop,
  onClose,
  onAcknowledgePrivacy,
  onRunPrivacyCheck
}) => {
  const loading = session.phase === "loading"
  const hasResult =
    session.phase === "step" ||
    session.phase === "complete" ||
    session.phase === "blocked" ||
    (loading && session.result !== undefined)

  const gate = privacy.status ? evaluatePrivacyGate(privacy.status) : null
  const showGoalForm = session.phase === "idle" && gate?.canStart === true

  return (
    <section
      className="glass-panel-dark panel-enter w-[min(440px,100%)] p-4 no-drag"
      aria-labelledby="teaching-panel-title"
      aria-busy={loading}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2
            id="teaching-panel-title"
            className="text-[13px] font-semibold tracking-tight glass-heading"
          >
            Teach Me
          </h2>
          <p className="mt-0.5 text-[10px] glass-subtle">
            Step-by-step guidance from your current screen
          </p>
        </div>
        <button
          type="button"
          className="p-1.5 rounded-md glass-icon hover:text-white hover:bg-white/10"
          onClick={onClose}
          aria-label="Close teaching"
        >
          <X className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {session.phase === "idle" && !privacy.status && !privacy.error && (
        <p className="mt-4 text-[11px] glass-muted" role="status">
          Checking privacy status…
        </p>
      )}

      {session.phase === "idle" && privacy.error && (
        <p className="mt-4 text-[12.5px] leading-relaxed glass-text" role="alert">
          {privacy.error}
        </p>
      )}

      {session.phase === "idle" &&
        privacy.status &&
        gate?.blockingReason === "acknowledgement" && (
          <div className="mt-4 space-y-3">
            <div className="flex items-start gap-2">
              <ShieldCheck
                className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 glass-icon"
                strokeWidth={1.75}
              />
              <p className="text-[11.5px] leading-relaxed glass-text">
                {privacy.status.acknowledgementText}
              </p>
            </div>
            <button
              type="button"
              onClick={onAcknowledgePrivacy}
              className="glass-action rounded-lg px-3 py-2 text-[11px]"
            >
              I understand
            </button>
          </div>
        )}

      {session.phase === "idle" &&
        privacy.status &&
        gate?.blockingReason === "preflight" && (
          <div className="mt-4 space-y-3">
            <p className="text-[11.5px] leading-relaxed glass-text">
              Before teaching this session, Quip runs a local, one-time check
              to see whether a test marker leaks into a screenshot. This is
              best-effort — always verify your own share preview too.
            </p>
            {privacy.status.lastPreflightResult && (
              <div
                role={
                  privacy.status.lastPreflightResult.status === "pass"
                    ? "status"
                    : "alert"
                }
                className="rounded-lg bg-white/5 px-2.5 py-2"
              >
                <p className="text-[11px] glass-muted">
                  {privacy.status.lastPreflightResult.reason}
                </p>
                {privacy.status.lastPreflightResult.remediation && (
                  <p className="mt-1 text-[11px] glass-muted">
                    {privacy.status.lastPreflightResult.remediation}
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={onRunPrivacyCheck}
              disabled={privacy.checking}
              className="glass-action flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] disabled:opacity-40"
            >
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
              {privacy.checking
                ? "Checking…"
                : privacy.status.lastPreflightResult
                  ? "Retry privacy check"
                  : "Run privacy check"}
            </button>
          </div>
        )}

      {showGoalForm && (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            onStart()
          }}
        >
          <label
            htmlFor="teaching-goal"
            className="block text-[12px] glass-text"
          >
            What do you want to learn?
          </label>
          <div className="flex gap-2">
            <input
              id="teaching-goal"
              className="glass-control min-w-0 flex-1 rounded-lg px-3 py-2 text-[12px]"
              value={session.goal}
              onChange={(event) => onGoalChange(event.target.value)}
              placeholder="For example, create a calendar event"
              autoFocus
              aria-label="Teaching goal"
            />
            <button
              type="submit"
              disabled={!session.goal.trim()}
              className="glass-action rounded-lg px-3 py-2 text-[11px] disabled:opacity-40"
            >
              Start
            </button>
          </div>
        </form>
      )}

      {session.phase === "provider-blocked" && (
        <div className="mt-4" role="status">
          <p className="text-[12.5px] leading-relaxed glass-text">
            Teach Me requires Gemini. Switch from Ollama to Gemini in Settings,
            then retry.
          </p>
        </div>
      )}

      {session.phase === "error" && session.error && (
        <div className="mt-4" role="alert">
          <p className="text-[12.5px] leading-relaxed glass-text">
            {session.error.message}
          </p>
        </div>
      )}

      {hasResult && session.result && (
        <div className="mt-4" aria-live="polite">
          <p className="text-[10px] uppercase tracking-wide glass-muted">
            {session.result.state === "step"
              ? "Current instruction"
              : session.result.state === "complete"
                ? "Complete"
                : "Can’t continue"}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed glass-heading">
            {session.result.instruction}
          </p>
          {session.result.label && (
            <p className="mt-2 text-[11px] glass-muted">
              Target:{" "}
              <span className="glass-text">{session.result.label}</span>
            </p>
          )}
          {session.result.state === "step" && (
            <div className="mt-3 rounded-lg bg-white/5 px-2.5 py-2">
              <p className="text-[11px] glass-text">
                {session.result.action === "type" ? (
                  <>
                    Will click, then type{" "}
                    <span className="glass-heading">
                      “{session.result.text}”
                    </span>
                  </>
                ) : (
                  "Will click the highlighted target"
                )}
              </p>
              <p className="mt-1 text-[10px] glass-muted">
                Press ⌘/Ctrl+⇧+Enter to perform · Esc to stop
              </p>
            </div>
          )}
        </div>
      )}

      {loading && (
        <p className="mt-3 text-[11px] glass-muted animate-pulse" role="status">
          {session.pendingOperation === "start"
            ? "Looking at your screen…"
            : "Capturing a fresh view…"}
        </p>
      )}

      {session.phase !== "idle" && (
        <div className="mt-4 flex items-center gap-2">
          {session.phase === "step" && (
            <button
              type="button"
              onClick={onNext}
              disabled={loading}
              className="glass-action flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] disabled:opacity-40"
            >
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
              Next
            </button>
          )}
          {session.phase === "error" &&
            session.error?.recoverable &&
            session.retryOperation && (
              <button
                type="button"
                onClick={() => onRetry(session.retryOperation!)}
                disabled={loading}
                className="glass-action flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] disabled:opacity-40"
              >
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
                Retry
              </button>
            )}
          {session.phase === "provider-blocked" && (
            <button
              type="button"
              onClick={() => onRetry("start")}
              className="glass-action flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px]"
            >
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={onStop}
            className="glass-control flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] glass-text"
          >
            <Square className="w-3 h-3" strokeWidth={1.75} />
            Stop
          </button>
        </div>
      )}
    </section>
  )
}

export default TeachingPanel
