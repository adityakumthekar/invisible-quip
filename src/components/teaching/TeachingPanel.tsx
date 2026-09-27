import React from "react"
import { ArrowRight, RefreshCw, Square, X } from "lucide-react"
import type {
  TeachingOperation,
  TeachingSessionState
} from "../../lib/teachingSession"
import { evaluatePrivacyGate } from "../../lib/privacyGate"
import PrivacyGateNotice, {
  type TeachingPrivacyState
} from "./PrivacyGateNotice"
import VisibleModeBanner from "./VisibleModeBanner"
import AutopilotView, { type AutopilotConsentState } from "./AutopilotView"
import type { AutopilotSessionState } from "../../lib/autopilotSession"
import {
  describePendingAction,
  isAutopilotBusy
} from "../../lib/autopilotSession"

export type { TeachingPrivacyState }

/** "guide" walks the user through each step; "auto" performs them itself. */
export type TeachingMode = "guide" | "auto"

interface TeachingPanelProps {
  session: TeachingSessionState
  privacy: TeachingPrivacyState
  mode: TeachingMode
  autopilot: AutopilotSessionState
  autopilotConsent: AutopilotConsentState
  onModeChange: (mode: TeachingMode) => void
  onGoalChange: (goal: string) => void
  onStart: () => void
  onNext: () => void
  onRetry: (operation: TeachingOperation) => void
  onStop: () => void
  onClose: () => void
  onAcknowledgePrivacy: () => void
  onRunPrivacyCheck: () => void
  onAutopilotGoalChange: (goal: string) => void
  onAutopilotStart: () => void
  onAutopilotConfirm: () => void
  onAutopilotReject: () => void
  onAutopilotStop: () => void
  onAcceptAutopilotConsent: () => void
}

const MODES: { value: TeachingMode; label: string }[] = [
  { value: "guide", label: "Guide me" },
  { value: "auto", label: "Do it for me" }
]

const TeachingPanel: React.FC<TeachingPanelProps> = ({
  session,
  privacy,
  mode,
  autopilot,
  autopilotConsent,
  onModeChange,
  onGoalChange,
  onStart,
  onNext,
  onRetry,
  onStop,
  onClose,
  onAcknowledgePrivacy,
  onRunPrivacyCheck,
  onAutopilotGoalChange,
  onAutopilotStart,
  onAutopilotConfirm,
  onAutopilotReject,
  onAutopilotStop,
  onAcceptAutopilotConsent
}) => {
  const loading = session.phase === "loading"
  const hasResult =
    session.phase === "step" ||
    session.phase === "complete" ||
    session.phase === "blocked" ||
    (loading && session.result !== undefined)

  const gate = privacy.status ? evaluatePrivacyGate(privacy.status) : null
  const showGoalForm =
    mode === "guide" && session.phase === "idle" && gate?.canStart === true
  const autopilotRunning = isAutopilotBusy(autopilot)
  // Switching modes mid-run would leave a loop driving the cursor with no
  // visible controls, so the toggle locks while either mode is active.
  const modeLocked = autopilotRunning || session.phase !== "idle"
  const showPrivacyGate =
    gate?.canStart !== true && (mode === "auto" || session.phase === "idle")

  return (
    <section
      className="glass-panel-dark panel-enter w-[min(440px,100%)] p-4 no-drag"
      aria-labelledby="teaching-panel-title"
      aria-busy={loading || autopilotRunning}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2
            id="teaching-panel-title"
            className="text-title font-semibold tracking-tight glass-heading"
          >
            Teach Me
          </h2>
          <p className="mt-0.5 text-meta glass-subtle">
            {mode === "guide"
              ? "Step-by-step guidance from your current screen"
              : "Quip works through the task on your screen"}
          </p>
        </div>
        <button
          type="button"
          className="p-1.5 rounded-inner glass-icon hover:text-glass-heading hover:bg-glass-hover"
          onClick={onClose}
          aria-label="Close teaching"
        >
          <X className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </div>

      <div
        className="mt-3 flex gap-1 rounded-nested bg-glass-soft p-0.5"
        role="tablist"
        aria-label="Teaching mode"
      >
        {MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            id={`teaching-tab-${option.value}`}
            aria-controls="teaching-tabpanel"
            aria-selected={mode === option.value}
            disabled={modeLocked && mode !== option.value}
            onClick={() => onModeChange(option.value)}
            className={`flex-1 rounded-inner px-2.5 py-1.5 text-meta transition-colors disabled:opacity-40 ${
              mode === option.value
                ? "glass-action"
                : "glass-text hover:bg-glass-hover"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Deliberately not tied to session phase — while Quip is capturable the
          warning stays up through every step and through an autopilot run.
          Outside the tabpanel below for the same reason: it belongs to the
          session, not to whichever mode is selected. */}
      {privacy.status?.visibleMode && <VisibleModeBanner />}

      {/* The tablist above declared role="tab" but pointed at nothing — there
          was no element with role="tabpanel" anywhere in the component, so a
          screen reader announced a tab that controls no region. */}
      <div
        id="teaching-tabpanel"
        role="tabpanel"
        aria-labelledby={`teaching-tab-${mode}`}
      >
        {showPrivacyGate && (
          <PrivacyGateNotice
            privacy={privacy}
            onAcknowledge={onAcknowledgePrivacy}
            onRunCheck={onRunPrivacyCheck}
          />
        )}

        {mode === "auto" && gate?.canStart === true && (
          <AutopilotView
            session={autopilot}
            consent={autopilotConsent}
            onGoalChange={onAutopilotGoalChange}
            onStart={onAutopilotStart}
            onConfirm={onAutopilotConfirm}
            onReject={onAutopilotReject}
            onStop={onAutopilotStop}
            onAcceptConsent={onAcceptAutopilotConsent}
          />
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
              className="block text-body glass-text"
            >
              What do you want to learn?
            </label>
            <div className="flex gap-2">
              <input
                id="teaching-goal"
                className="glass-control min-w-0 flex-1 rounded-nested px-3 py-2 text-body"
                value={session.goal}
                onChange={(event) => onGoalChange(event.target.value)}
                placeholder="For example, create a calendar event"
                autoFocus
                aria-label="Teaching goal"
              />
              <button
                type="submit"
                disabled={!session.goal.trim()}
                className="glass-action rounded-nested px-3 py-2 text-meta disabled:opacity-40"
              >
                Start
              </button>
            </div>
          </form>
        )}

        {mode === "guide" && session.phase === "error" && session.error && (
          <div className="mt-4" role="alert">
            <p className="text-body leading-relaxed glass-text">
              {session.error.message}
            </p>
          </div>
        )}

        {mode === "guide" && hasResult && session.result && (
          <div className="mt-4" aria-live="polite">
            <p className="text-meta uppercase tracking-wide glass-muted">
              {session.result.state === "step"
                ? "Current instruction"
                : session.result.state === "complete"
                  ? "Complete"
                  : "Can’t continue"}
            </p>
            <p className="mt-2 text-title leading-relaxed glass-heading">
              {session.result.instruction}
            </p>
            {session.result.label && (
              <p className="mt-2 text-meta glass-muted">
                Target:{" "}
                <span className="glass-text">{session.result.label}</span>
              </p>
            )}
            {session.result.state === "step" && (
              <div className="mt-3 rounded-nested bg-glass-soft px-2.5 py-2">
                <p className="text-meta glass-text">
                  {describePendingAction(session.result)}
                </p>
                <p className="mt-1 text-meta glass-muted">
                  Press ⌘/Ctrl+⇧+Enter to perform · Esc to stop
                </p>
              </div>
            )}
          </div>
        )}

        {mode === "guide" && loading && (
          <p className="mt-3 text-meta glass-muted animate-pulse" role="status">
            {session.pendingOperation === "start"
              ? "Looking at your screen…"
              : "Capturing a fresh view…"}
          </p>
        )}

        {mode === "guide" && session.phase !== "idle" && (
          <div className="mt-4 flex items-center gap-2">
            {session.phase === "step" && (
              <button
                type="button"
                onClick={onNext}
                disabled={loading}
                className="glass-action flex items-center gap-1.5 rounded-nested px-3 py-2 text-meta disabled:opacity-40"
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
                  className="glass-action flex items-center gap-1.5 rounded-nested px-3 py-2 text-meta disabled:opacity-40"
                >
                  <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Retry
                </button>
              )}
            <button
              type="button"
              onClick={onStop}
              className="glass-control flex items-center gap-1.5 rounded-nested px-3 py-2 text-meta glass-text"
            >
              <Square className="w-3 h-3" strokeWidth={1.75} />
              Stop
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

export default TeachingPanel
