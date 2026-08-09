import React, { useEffect, useRef, useState } from "react"
import { HelpCircle } from "lucide-react"
import type { Shortcut } from "../../lib/shortcuts"

interface ShortcutsTooltipProps {
  shortcuts: Shortcut[]
  onTooltipVisibilityChange: (visible: boolean, height: number) => void
  triggerTitle?: string
}

const ShortcutsTooltip: React.FC<ShortcutsTooltipProps> = ({
  shortcuts,
  onTooltipVisibilityChange,
  triggerTitle = "Shortcuts"
}) => {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let tooltipHeight = 0
    if (tooltipRef.current && isTooltipVisible) {
      // The tooltip is absolutely positioned, so its height is reported into
      // the window measurement by hand. The slack covers the panel's contact
      // ring and its mt-2 offset, which would otherwise be clipped at the
      // window edge. It was 26 when the panel still cast a 24px drop shadow.
      tooltipHeight = tooltipRef.current.offsetHeight + 4
    }
    onTooltipVisibilityChange(isTooltipVisible, tooltipHeight)
  }, [isTooltipVisible, onTooltipVisibilityChange])

  return (
    <div
      className="relative no-drag"
      onMouseEnter={() => setIsTooltipVisible(true)}
      onMouseLeave={() => setIsTooltipVisible(false)}
    >
      <button type="button" className="icon-btn" title={triggerTitle}>
        <HelpCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
      </button>
      {isTooltipVisible && (
        <div
          ref={tooltipRef}
          className="absolute top-full right-0 mt-2 w-72 z-50"
        >
          <div className="glass-panel-dark p-3 text-meta glass-text space-y-2.5">
            <p className="font-medium glass-heading">Shortcuts</p>
            {shortcuts.map((s) => (
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
  )
}

export default ShortcutsTooltip
