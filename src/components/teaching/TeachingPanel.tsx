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
    gate?.canStart !== true &&
    (mode === "auto" || session.phase === "idle")

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
            className="text-[13px] font-semibold tracking-tight glass-heading"
          >
            Teach Me
          </h2>
          <p className="mt-0.5 text-[11px] glass-subtle">
            {mode === "guide"
              ? "Step-by-step guidance from your current screen"
              : "Quip works through the task on your screen"}
          </p>
        </div>
        <button
          type="button"
          className="p-1.5 rounded-md glass-icon hover:text-glass-heading hover:bg-glass-hover"
          onClick={onClose}
          aria-label="Close teaching"
        >
          <X className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </div>

      <div
        className="mt-3 flex gap-1 rounded-lg bg-glass-soft p-0.5"
        role="tablist"
        aria-label="Teaching mode"
      >
        {MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={mode === option.value}
            disabled={modeLocked && mode !== option.value}
            onClick={() => onModeChange(option.value)}
            className={`flex-1 rounded-md px-2.5 py-1.5 text-[11px] transition-colors disabled:opacity-40 ${
              mode === option.value
                ? "glass-action"
                : "glass-text hover:bg-glass-hover"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

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

      {mode === "guide" && session.phase === "error" && session.error && (
        <div className="mt-4" role="alert">
          <p className="text-[12.5px] leading-relaxed glass-text">
            {session.error.message}
          </p>
        </div>
      )}

      {mode === "guide" && hasResult && session.result && (
        <div className="mt-4" aria-live="polite">
          <p className="text-[11px] uppercase tracking-wide glass-muted">
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
            <div className="mt-3 rounded-lg bg-glass-soft px-2.5 py-2">
              <p className="text-[11px] glass-text">
                {describePendingAction(session.result)}
              </p>
              <p className="mt-1 text-[11px] glass-muted">
                Press ⌘/Ctrl+⇧+Enter to perform · Esc to stop
              </p>
            </div>
          )}
        </div>
      )}

      {mode === "guide" && loading && (
        <p className="mt-3 text-[11px] glass-muted animate-pulse" role="status">
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
