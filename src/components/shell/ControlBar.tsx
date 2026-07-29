import React, { useEffect, useRef } from "react"
import {
  ChevronsRight,
  GraduationCap,
  Eye,
  LayoutGrid,
  LogOut,
  MessageSquarePlus,
  Mic,
  Settings2,
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

interface ControlBarProps {
  screenshots: Array<{ path: string; preview: string }>
  isRecording: boolean
  recordingSeconds?: number
  micStream?: MediaStream | null
  panelsOpen: boolean
  modelsOpen: boolean
  quickOpen: boolean
  teachingOpen: boolean
  collapsed: boolean
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
  isRecording,
  recordingSeconds = 0,
  micStream,
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

        {isRecording && micStream && (
          <MicWaveform stream={micStream} seconds={recordingSeconds} />
        )}

        <button
          type="button"
          className={cn("icon-btn no-drag", panelsOpen && "active")}
          onClick={onAskAi}
          title="Ask AI"
        >
          <Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Ask AI</span>
          <span className="kbd">⌘</span>
          <span className="kbd">↵</span>
        </button>

        {/* Icon only: the window is sized to this bar's content, so every text
            label widens the overlay. ⌘N is documented in the shortcuts tooltip. */}
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
        >
          <LayoutGrid className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>

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

        <div className="mx-0.5 h-4 w-px bg-glass-line" />

        <button
          type="button"
          className={cn(
            "icon-btn no-drag",
            isRecording && "active text-glass-danger"
          )}
          onClick={onRecordClick}
          title={isRecording ? "Stop recording" : "Record voice"}
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

        <button
          type="button"
          className={cn("icon-btn no-drag", modelsOpen && "active")}
          onClick={onToggleModels}
          title="Settings"
        >
          <Settings2 className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>

        <ShortcutsTooltip
          shortcuts={SHORTCUTS}
          onTooltipVisibilityChange={onTooltipVisibilityChange}
        />

        {/* Icon only, like New chat above: the window is sized to this bar, so a
            text label here would widen the overlay permanently. */}
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

        <button
          type="button"
          className="icon-btn no-drag text-glass-danger opacity-80 hover:opacity-100"
          onClick={() => window.electronAPI.quitApp()}
          title="Quit"
        >
          <LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

export default ControlBar
