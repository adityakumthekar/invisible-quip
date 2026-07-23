import React, { useEffect, useRef, useState } from "react"
import {
  Eye,
  HelpCircle,
  LayoutGrid,
  LogOut,
  Mic,
  Settings2,
  Sparkles
} from "lucide-react"
import { cn } from "../../lib/utils"
import { SHORTCUTS } from "../../lib/shortcuts"
import MicWaveform from "./MicWaveform"

interface ControlBarProps {
  screenshots: Array<{ path: string; preview: string }>
  isRecording: boolean
  recordingSeconds?: number
  micStream?: MediaStream | null
  panelsOpen: boolean
  modelsOpen: boolean
  quickOpen: boolean
  onAskAi: () => void
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
  onAskAi,
  onTogglePanels,
  onToggleModels,
  onToggleQuick,
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

  return (
    <div className="w-fit relative">
      <div className="glass-bar draggable-area flex items-center gap-1 px-2 py-1.5">
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
                {SHORTCUTS.map((s) => (
                  <div key={s.action} className="flex justify-between gap-3">
                    <span className="glass-muted">{s.action}</span>
                    <span className="flex gap-1">
                      {s.keys.map((k, i) => (
                        <span key={i} className="kbd">
                          {k}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
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
