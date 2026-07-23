import React, { useEffect, useRef, useState } from "react"
import {
  Eye,
  HelpCircle,
  LogOut,
  Mic,
  Settings2,
  Sparkles
} from "lucide-react"
import { cn } from "../../lib/utils"

interface ControlBarProps {
  screenshots: Array<{ path: string; preview: string }>
  isRecording: boolean
  recordingSeconds?: number
  panelsOpen: boolean
  modelsOpen: boolean
  onAskAi: () => void
  onTogglePanels: () => void
  onToggleModels: () => void
  onRecordClick: () => void
  onTooltipVisibilityChange: (visible: boolean, height: number) => void
}

const ControlBar: React.FC<ControlBarProps> = ({
  screenshots,
  isRecording,
  recordingSeconds = 0,
  panelsOpen,
  modelsOpen,
  onAskAi,
  onTogglePanels,
  onToggleModels,
  onRecordClick,
  onTooltipVisibilityChange
}) => {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let tooltipHeight = 0
    if (tooltipRef.current && isTooltipVisible) {
      tooltipHeight = tooltipRef.current.offsetHeight + 10
    }
    onTooltipVisibilityChange(isTooltipVisible, tooltipHeight)
  }, [isTooltipVisible, onTooltipVisibilityChange])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  }

  return (
    <div className="w-fit relative">
      <div className="glass-bar draggable-area flex items-center gap-1 px-2 py-1.5">
        {isRecording && (
          <div className="no-drag flex items-center gap-2 px-2 text-[11px] text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
            <span className="tabular-nums">{formatTime(recordingSeconds)}</span>
          </div>
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
          title="Models"
        >
          <Settings2 className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>

        <div
          className="relative no-drag"
          onMouseEnter={() => setIsTooltipVisible(true)}
          onMouseLeave={() => setIsTooltipVisible(false)}
        >
          <button type="button" className="icon-btn" title="Shortcuts">
            <HelpCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
          {isTooltipVisible && (
            <div
              ref={tooltipRef}
              className="absolute top-full right-0 mt-2 w-72 z-50"
            >
              <div className="glass-panel-dark p-3 text-[11px] glass-text space-y-2.5">
                <p className="font-medium glass-heading">Shortcuts</p>
                <div className="flex justify-between gap-3">
                  <span className="glass-muted">Toggle window</span>
                  <span className="flex gap-1">
                    <span className="kbd">⌘</span>
                    <span className="kbd">B</span>
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="glass-muted">Screenshot</span>
                  <span className="flex gap-1">
                    <span className="kbd">⌘</span>
                    <span className="kbd">H</span>
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="glass-muted">Ask AI / Solve</span>
                  <span className="flex gap-1">
                    <span className="kbd">⌘</span>
                    <span className="kbd">↵</span>
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="glass-muted">Reset</span>
                  <span className="flex gap-1">
                    <span className="kbd">⌘</span>
                    <span className="kbd">R</span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

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
