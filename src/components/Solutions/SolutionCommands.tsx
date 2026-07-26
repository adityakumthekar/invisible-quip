import React from "react"
import { LogOut } from "lucide-react"
import type { Shortcut } from "../../lib/shortcuts"
import ShortcutsTooltip from "../shell/ShortcutsTooltip"

interface SolutionCommandsProps {
  extraScreenshots: any[]
  onTooltipVisibilityChange?: (visible: boolean, height: number) => void
}

const SolutionCommands: React.FC<SolutionCommandsProps> = ({
  extraScreenshots,
  onTooltipVisibilityChange
}) => {
  const shortcuts: Shortcut[] = [
    { action: "Toggle window", keys: ["⌘", "B"] },
    { action: "Screenshot", keys: ["⌘", "H"] },
    ...(extraScreenshots.length > 0
      ? [{ action: "Debug", keys: ["⌘", "↵"] }]
      : []),
    { action: "Start over", keys: ["⌘", "R"] }
  ]

  return (
    <div className="w-fit">
      <div className="glass-bar draggable-area flex items-center gap-3 px-3 py-1.5 text-[11px] glass-text">
        <div className="flex items-center gap-1.5 whitespace-nowrap no-drag">
          <span className="glass-muted">Show/Hide</span>
          <span className="kbd">⌘</span>
          <span className="kbd">B</span>
        </div>

        <div className="flex items-center gap-1.5 whitespace-nowrap no-drag">
          <span className="glass-muted truncate">Screenshot</span>
          <span className="kbd">⌘</span>
          <span className="kbd">H</span>
        </div>

        {extraScreenshots.length > 0 && (
          <div className="flex items-center gap-1.5 whitespace-nowrap no-drag">
            <span className="glass-muted">Debug</span>
            <span className="kbd">⌘</span>
            <span className="kbd">↵</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 whitespace-nowrap no-drag">
          <span className="glass-muted">Start over</span>
          <span className="kbd">⌘</span>
          <span className="kbd">R</span>
        </div>

        <ShortcutsTooltip
          shortcuts={shortcuts}
          onTooltipVisibilityChange={onTooltipVisibilityChange ?? (() => {})}
          triggerTitle="Help"
        />

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
