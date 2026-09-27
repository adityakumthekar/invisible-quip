import React, { useEffect, useRef, useState } from "react"
import {
  ChevronsRight,
  GraduationCap,
  Eye,
  LayoutGrid,
  LogOut,
  MessageSquarePlus,
  Mic,
  Settings2,
  Smartphone,
  Sparkles
} from "lucide-react"
import { cn } from "../../lib/utils"
import { SHORTCUTS } from "../../lib/shortcuts"
import {
  beginWindowDrag,
  endWindowDrag,
  isClickNotDrag,
  type ScreenPoint
} from "../../lib/windowDrag"
import MicWaveform from "./MicWaveform"
import ShortcutsTooltip from "./ShortcutsTooltip"

/** How long an armed Quit stays armed before disarming itself. */
const QUIT_CONFIRM_MS = 3000

/**
 * Groups the bar's controls by what they do, so the row reads as four clusters
 * rather than ten equal buttons: ask/teach, session, chrome, and quit on its
 * own. Rendered as a hairline between groups.
 */
const Divider: React.FC = () => (
  <div className="mx-0.5 h-4 w-px bg-glass-line" aria-hidden />
)

/**
 * "Connected" and "can type here" are very different facts about this machine,
 * and the indicator is the only place either is visible while the overlay is
 * collapsed. Saying "remote control is live" for a phone that can only watch
 * would cry wolf; saying "connected" for one that can type would under-report
 * the thing that actually matters.
 */
function remoteIndicatorLabel(count: number, inputEnabled: boolean): string {
  const devices = `${count} phone${count === 1 ? "" : "s"} connected`
  return inputEnabled
    ? `${devices} — can control this screen`
    : `${devices} — watching only`
}

interface ControlBarProps {
  screenshots: Array<{ path: string; preview: string }>
  isRecording: boolean
  recordingSeconds?: number
  micStream?: MediaStream | null
  systemStream?: MediaStream | null
  panelsOpen: boolean
  modelsOpen: boolean
  quickOpen: boolean
  teachingOpen: boolean
  collapsed: boolean
  /** Phones currently attached to the remote server; 0 hides the indicator. */
  remoteConnections: number
  /** The phone may drive the mouse and keyboard, not merely watch. */
  remoteInputEnabled: boolean
  /** Non-null disables the collapse control and explains why in its tooltip. */
  collapseDisabledReason?: string | null
  onToggleCollapsed: () => void
  onAskAi: () => void
  onNewChat: () => void
  onTeachMe: () => void
  onSolve: () => void
  onToggleModels: () => void
  onToggleQuick: () => void
  onRecordClick: () => void
  onTooltipVisibilityChange: (visible: boolean, height: number) => void
}

const ControlBar: React.FC<ControlBarProps> = ({
  screenshots,
  remoteConnections,
  remoteInputEnabled,
  isRecording,
  recordingSeconds = 0,
  micStream,
  systemStream,
  panelsOpen,
  modelsOpen,
  quickOpen,
  teachingOpen,
  collapsed,
  collapseDisabledReason,
  onToggleCollapsed,
  onAskAi,
  onNewChat,
  onTeachMe,
  onSolve,
  onToggleModels,
  onToggleQuick,
  onRecordClick,
  onTooltipVisibilityChange
}) => {
  // End the drag on any release, even one the grip never sees (window blur,
  // pointer lost outside the transparent window).
  useEffect(() => {
    const stop = () => endWindowDrag()
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    window.addEventListener("blur", stop)
    return () => {
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
      window.removeEventListener("blur", stop)
      endWindowDrag()
    }
  }, [])

  // Where the current press started, so the blob can tell a click (expand) from
  // the tail of a drag (don't). See isClickNotDrag for why these are screen and
  // not client coordinates.
  const pressPointRef = useRef<ScreenPoint | null>(null)

  // Quit sits in a bar you drag around by its edge, one cluster away from
  // Collapse, and it ends a session with no undo. It arms on the first click
  // and only fires on the second.
  const [quitArmed, setQuitArmed] = useState(false)
  const quitTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(quitTimer.current), [])

  const onQuitClick = () => {
    if (quitArmed) {
      clearTimeout(quitTimer.current)
      window.electronAPI.quitApp()
      return
    }
    setQuitArmed(true)
    clearTimeout(quitTimer.current)
    quitTimer.current = setTimeout(() => setQuitArmed(false), QUIT_CONFIRM_MS)
  }

  const onGripPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    pressPointRef.current = { x: event.screenX, y: event.screenY }
    // Pointer capture keeps the release on this element even once the window
    // has slid out from under the cursor.
    event.currentTarget.setPointerCapture(event.pointerId)
    beginWindowDrag()
  }

  const onCollapseFromGrip = () => {
    // Drop the drag flag before the bar re-renders as a blob — the grip element
    // that would normally clear it is about to be unmounted.
    endWindowDrag()
    // Same guard the chevron gets from `disabled`; the grip has no such state.
    if (collapseDisabledReason) return
    onToggleCollapsed()
  }

  // The blob is both the drag handle and the expand button, so every drag ends
  // with a click that would otherwise re-expand the bar the moment you finish
  // moving it. Only a press that stayed put counts as a click.
  const onBlobClick = (event: React.MouseEvent) => {
    const start = pressPointRef.current
    pressPointRef.current = null
    if (!isClickNotDrag(start, { x: event.screenX, y: event.screenY })) return
    onToggleCollapsed()
  }

  if (collapsed) {
    return (
      <div className="w-fit relative">
        {/* `glass-bar` is deliberately reused rather than given its own class:
            it is what useClickThrough hit-tests and what index.css grants
            pointer-events to, and those two lists are asserted in sync by
            clickThroughSelectors.test.ts. */}
        <button
          type="button"
          className="glass-bar collapsed-blob no-drag"
          title="Expand Quip"
          aria-label="Expand Quip"
          aria-expanded={false}
          onPointerDown={onGripPointerDown}
          onPointerUp={() => endWindowDrag()}
          onPointerCancel={() => endWindowDrag()}
          onClick={onBlobClick}
        >
          <Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
        {/* Even collapsed, a machine someone can drive from a phone must not
            look identical to one nobody can. */}
        {remoteConnections > 0 && (
          <span
            className="remote-dot"
            data-input={remoteInputEnabled ? "on" : "off"}
            role="status"
            aria-label={remoteIndicatorLabel(remoteConnections, remoteInputEnabled)}
            title={remoteIndicatorLabel(remoteConnections, remoteInputEnabled)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="w-fit relative">
      <div className="glass-bar draggable-area flex items-center gap-1 px-2 py-1.5">
        {/* Dedicated grip. Explicitly no-drag: Chromium's app-region drag is
            unreliable on this transparent click-through window, so the move is
            driven manually from the main process instead. */}
        <div
          className="drag-grip no-drag flex items-center justify-center self-stretch px-1 -ml-0.5 mr-0.5 shrink-0"
          title="Drag to move — double-click to collapse"
          aria-hidden
          onPointerDown={onGripPointerDown}
          onPointerUp={() => endWindowDrag()}
          onPointerCancel={() => endWindowDrag()}
          onDoubleClick={onCollapseFromGrip}
        >
          <span className="drag-grip-dots" />
        </div>

        {remoteConnections > 0 && (
          <span
            className="remote-indicator no-drag"
            data-input={remoteInputEnabled ? "on" : "off"}
            role="status"
            aria-label={remoteIndicatorLabel(remoteConnections, remoteInputEnabled)}
            title={remoteIndicatorLabel(remoteConnections, remoteInputEnabled)}
          >
            <Smartphone className="w-3.5 h-3.5" strokeWidth={1.75} />
          </span>
        )}

        {isRecording && micStream && (
          <MicWaveform
            stream={micStream}
            seconds={recordingSeconds}
            systemStream={systemStream}
          />
        )}

        {/* The labelling rule, stated once so it stops being decided per
            button: a control carries a text label if it is one of the app's
            primary verbs (Ask AI, Teach Me, Show/Hide, Record), and a .kbd
            chip if it has a global shortcut. Everything else is icon-only.
            Labels are not free — the window is sized to this bar's content, so
            each one widens the overlay permanently — which is exactly why the
            rule has to be a rule. */}

        {/* — Ask & teach — */}
        <button
          type="button"
          className={cn("icon-btn no-drag", panelsOpen && "active")}
          onClick={onAskAi}
          title="Ask AI"
          aria-pressed={panelsOpen}
        >
          <Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Ask AI</span>
          <span className="kbd">⌘</span>
          <span className="kbd">↵</span>
        </button>

        <button
          type="button"
          className="icon-btn no-drag"
          onClick={onNewChat}
          title="New chat — clears the conversation (⌘N)"
          aria-label="New chat"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          className={cn("icon-btn no-drag", teachingOpen && "active")}
          onClick={onTeachMe}
          title="Teach Me"
          aria-label="Teach Me"
          aria-pressed={teachingOpen}
        >
          <GraduationCap className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Teach Me</span>
        </button>

        <button
          type="button"
          className={cn("icon-btn no-drag", quickOpen && "active")}
          onClick={onToggleQuick}
          title="Quick actions"
          aria-label="Quick actions"
          aria-pressed={quickOpen}
        >
          <LayoutGrid className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>

        <Divider />

        {/* — Session — */}
        <button
          type="button"
          className="icon-btn no-drag"
          onClick={() => window.electronAPI.invoke("toggle-window")}
          title="Show / Hide"
        >
          <Eye className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Show/Hide</span>
          <span className="kbd">⌘</span>
          <span className="kbd">B</span>
        </button>

        <button
          type="button"
          className={cn(
            "icon-btn no-drag",
            isRecording && "active text-glass-danger"
          )}
          onClick={onRecordClick}
          title={isRecording ? "Stop recording" : "Record voice"}
          aria-pressed={isRecording}
        >
          <Mic className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>{isRecording ? "Stop" : "Record"}</span>
          <span className="kbd">⌥</span>
          <span className="kbd">M</span>
        </button>

        {screenshots.length > 0 && (
          <button
            type="button"
            className="icon-btn no-drag"
            onClick={onSolve}
            title={`Solve ${screenshots.length} queued screenshot(s)`}
          >
            <span>Solve</span>
          </button>
        )}

        <Divider />

        {/* — Chrome — */}
        <button
          type="button"
          className={cn("icon-btn no-drag", modelsOpen && "active")}
          onClick={onToggleModels}
          title="Settings"
          aria-label="Settings"
          aria-pressed={modelsOpen}
        >
          <Settings2 className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>

        <ShortcutsTooltip
          shortcuts={SHORTCUTS}
          onTooltipVisibilityChange={onTooltipVisibilityChange}
        />

        <button
          type="button"
          className="icon-btn no-drag"
          onClick={onToggleCollapsed}
          disabled={Boolean(collapseDisabledReason)}
          title={collapseDisabledReason ?? "Collapse to a dot"}
          aria-label="Collapse to a dot"
          aria-expanded={true}
        >
          <ChevronsRight className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>

        <Divider />

        {/* Quit is alone past its own divider, and arms before it fires. It
            used to sit flush against Collapse — a button you reach for often —
            with no confirmation and no undo. */}
        <button
          type="button"
          className={cn(
            "icon-btn no-drag text-glass-danger",
            quitArmed ? "active opacity-100" : "opacity-80 hover:opacity-100"
          )}
          onClick={onQuitClick}
          onBlur={() => setQuitArmed(false)}
          title={quitArmed ? "Click again to quit Quip" : "Quit"}
          aria-label={quitArmed ? "Confirm quit" : "Quit"}
        >
          <LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />
          {quitArmed && <span>Sure?</span>}
        </button>
      </div>
    </div>
  )
}

export default ControlBar
