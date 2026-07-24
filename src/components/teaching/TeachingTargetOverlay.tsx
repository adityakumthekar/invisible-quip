import { useEffect, useState } from "react"
import type { TeachingOverlayTargetEvent } from "../../lib/teachingOverlayContract"
import glowCursor from "../../assets/teaching/glow-cursor.svg"

/** Rendered size of glow-cursor.svg, in DIP — roughly a system cursor. */
const GLOW_CURSOR_SIZE = 44

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

  // The pointer is the whole overlay: no box, no label. The instruction and
  // label already read in the teaching panel, so anything drawn here would be
  // a second highlight competing with the cursor.
  // Same point perform-click actuates through nut.js (dipRectCenter).
  const centerX = target.target.x + target.target.width / 2
  const centerY = target.target.y + target.target.height / 2

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
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
    </div>
  )
}
