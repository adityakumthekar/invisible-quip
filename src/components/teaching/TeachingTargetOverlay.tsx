import { useEffect, useState } from "react"
import type { TeachingOverlayTargetEvent } from "../../lib/teachingOverlayContract"

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

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div
        className="absolute rounded-xl border-4 border-cyan-300"
        style={{
          left,
          top,
          width,
          height,
          boxShadow:
            "0 0 0 3px rgba(8, 47, 73, 0.9), 0 0 24px 8px rgba(34, 211, 238, 0.75)"
        }}
      />
      <div
        className="absolute max-w-xs -translate-x-1/2 rounded-lg border border-cyan-200 bg-slate-950/95 px-3 py-2 text-center text-sm font-semibold text-white shadow-2xl"
        style={{
          left: left + width / 2,
          top: top + height + 14
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
