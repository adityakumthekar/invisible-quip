import { useEffect, useState } from "react"
import type { TeachingOverlayTargetEvent } from "../../lib/teachingOverlayContract"
import glowCursor from "../../assets/teaching/glow-cursor.svg"

/** Rendered size of glow-cursor.svg, in DIP — roughly a system cursor. */
const GLOW_CURSOR_SIZE = 44
/** How far down the graphic its tip sits — must match the CSS translate. */
const GLOW_CURSOR_TIP_RATIO = 0.094

export default function TeachingTargetOverlay() {
  const [target, setTarget] = useState<TeachingOverlayTargetEvent | null>(null)

  useEffect(() => {
    const removeTargetListener =
      window.electronAPI.onTeachingOverlayTarget(setTarget)
    const removeClearListener = window.electronAPI.onTeachingOverlayClear(() =>
      setTarget(null)
    )
    void window.electronAPI.teachingOverlayReady().catch((error) => {
      console.error("Failed to initialize teaching overlay:", error)
    })

    return () => {
      removeTargetListener()
      removeClearListener()
    }
  }, [])

  if (!target) {
    return null
  }

  const width = Math.max(target.target.width, 28)
  const height = Math.max(target.target.height, 28)
  const left = target.target.x - (width - target.target.width) / 2
  const top = target.target.y - (height - target.target.height) / 2
  // Same point perform-click actuates through nut.js (dipRectCenter).
  const centerX = left + width / 2
  const centerY = top + height / 2
  // Clear both the target box and the pointer hanging below the tip, whichever
  // reaches lower.
  const labelTop =
    Math.max(
      top + height,
      centerY + GLOW_CURSOR_SIZE * (1 - GLOW_CURSOR_TIP_RATIO)
    ) + 14

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div
        className="absolute rounded-xl border-2 border-cyan-300/70"
        style={{
          left,
          top,
          width,
          height,
          boxShadow:
            "0 0 0 2px rgba(8, 47, 73, 0.6), 0 0 14px 3px rgba(34, 211, 238, 0.35)"
        }}
      />
      <img
        src={glowCursor}
        alt=""
        aria-hidden
        draggable={false}
        className="teach-glow-cursor absolute"
        style={{
          left: centerX,
          top: centerY,
          width: GLOW_CURSOR_SIZE,
          height: GLOW_CURSOR_SIZE
        }}
      />
      <div
        className="absolute max-w-xs -translate-x-1/2 rounded-lg border border-cyan-200 bg-slate-950/95 px-3 py-2 text-center text-sm font-semibold text-white shadow-2xl"
        style={{
          left: centerX,
          top: labelTop
        }}
      >
        <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-l border-t border-cyan-200 bg-slate-950" />
        {target.label && (
          <span className="mr-1 text-cyan-300">{target.label}:</span>
        )}
        {target.instruction}
      </div>
    </div>
  )
}
