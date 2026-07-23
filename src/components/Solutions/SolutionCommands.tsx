import React, { useEffect, useRef, useState } from "react"
import { HelpCircle, LogOut } from "lucide-react"

interface SolutionCommandsProps {
  extraScreenshots: any[]
  onTooltipVisibilityChange?: (visible: boolean, height: number) => void
}

const SolutionCommands: React.FC<SolutionCommandsProps> = ({
  extraScreenshots,
  onTooltipVisibilityChange
}) => {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!onTooltipVisibilityChange) return
    let tooltipHeight = 0
    if (tooltipRef.current && isTooltipVisible) {
      tooltipHeight = tooltipRef.current.offsetHeight + 10
    }
    onTooltipVisibilityChange(isTooltipVisible, tooltipHeight)
  }, [isTooltipVisible, onTooltipVisibilityChange])

  return (
    <div className="w-fit">
      <div className="glass-bar draggable-area flex items-center gap-3 px-3 py-1.5 text-[11px] text-white/85">
        <div className="flex items-center gap-1.5 whitespace-nowrap no-drag">
          <span className="text-white/70">Show/Hide</span>
          <span className="kbd">⌘</span>
          <span className="kbd">B</span>
        </div>

        <div className="flex items-center gap-1.5 whitespace-nowrap no-drag">
          <span className="text-white/70 truncate">
            {extraScreenshots.length === 0 ? "Screenshot" : "Screenshot"}
          </span>
          <span className="kbd">⌘</span>
          <span className="kbd">H</span>
        </div>

        {extraScreenshots.length > 0 && (
          <div className="flex items-center gap-1.5 whitespace-nowrap no-drag">
            <span className="text-white/70">Debug</span>
            <span className="kbd">⌘</span>
            <span className="kbd">↵</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 whitespace-nowrap no-drag">
          <span className="text-white/70">Start over</span>
          <span className="kbd">⌘</span>
          <span className="kbd">R</span>
        </div>

        <div
          className="relative no-drag"
          onMouseEnter={() => setIsTooltipVisible(true)}
          onMouseLeave={() => setIsTooltipVisible(false)}
        >
          <button type="button" className="icon-btn" title="Help">
            <HelpCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
          {isTooltipVisible && (
            <div
              ref={tooltipRef}
              className="absolute top-full right-0 mt-2 w-72 z-50"
            >
              <div className="glass-panel-dark p-3 text-[11px] text-white/85 space-y-2">
                <p className="font-medium text-white/95">Shortcuts</p>
                <div className="flex justify-between">
                  <span className="text-white/55">Toggle window</span>
                  <span className="flex gap-1">
                    <span className="kbd">⌘</span>
                    <span className="kbd">B</span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/55">Screenshot</span>
                  <span className="flex gap-1">
                    <span className="kbd">⌘</span>
                    <span className="kbd">H</span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/55">Debug</span>
                  <span className="flex gap-1">
                    <span className="kbd">⌘</span>
                    <span className="kbd">↵</span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/55">Start over</span>
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
          className="icon-btn no-drag text-red-300/80"
          title="Quit"
          onClick={() => window.electronAPI.quitApp()}
        >
          <LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

export default SolutionCommands
