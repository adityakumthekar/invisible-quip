import React, { useEffect } from "react"
import {
  GraduationCap,
  Eye,
  LayoutGrid,
  LogOut,
  Mic,
  Settings2,
  Sparkles
} from "lucide-react"
import { cn } from "../../lib/utils"
import { SHORTCUTS } from "../../lib/shortcuts"
import { beginWindowDrag, endWindowDrag } from "../../lib/windowDrag"
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
  onAskAi: () => void
  onTeachMe: () => void
  onTogglePanels: () => void
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
  onAskAi,
  onTeachMe,
  onTogglePanels,
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

  const onGripPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    // Pointer capture keeps the release on this element even once the window
    // has slid out from under the cursor.
    event.currentTarget.setPointerCapture(event.pointerId)
    beginWindowDrag()
  }

  return (
    <div className="w-fit relative">
      <div className="glass-bar draggable-area flex items-center gap-1 px-2 py-1.5">
        {/* Dedicated grip. Explicitly no-drag: Chromium's app-region drag is
            unreliable on this transparent click-through window, so the move is
            driven manually from the main process instead. */}
        <div
          className="drag-grip no-drag flex items-center justify-center self-stretch px-1 -ml-0.5 mr-0.5 shrink-0"
          title="Drag to move"
          aria-hidden
          onPointerDown={onGripPointerDown}
          onPointerUp={() => endWindowDrag()}
          onPointerCancel={() => endWindowDrag()}
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

        <div className="mx-0.5 h-4 w-px bg-white/15" />

        <button
          type="button"
          className={cn(
            "icon-btn no-drag",
            isRecording && "active text-red-300"
          )}
          onClick={onRecordClick}
          title={isRecording ? "Stop recording" : "Record voice"}
        >
          <Mic className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>{isRecording ? "Stop" : "Record"}</span>
        </button>

        {screenshots.length > 0 && (
          <button
            type="button"
            className="icon-btn no-drag"
            onClick={onTogglePanels}
            title="Open panels"
          >
            <span>Solve</span>
            <span className="kbd">⌘</span>
            <span className="kbd">↵</span>
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

        <button
          type="button"
          className="icon-btn no-drag text-red-300/80 hover:text-red-300"
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
