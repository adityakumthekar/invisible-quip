import { useEffect, useRef } from "react"
import { isWindowDragging } from "../lib/windowDrag"

const HIT_SELECTOR =
  ".hit-region, .glass-bar, .glass-panel-dark, .glass-panel-light, .glass-panel-secondary"

/**
 * Keep Electron click-through in sync with the cursor: ignore mouse (with
 * forward) over empty areas; capture clicks only when over interactive glass UI.
 */
export function useClickThrough(): void {
  const ignoringRef = useRef(true)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.setIgnoreMouseEvents) return

    const setIgnore = (ignore: boolean) => {
      if (ignoringRef.current === ignore) return
      ignoringRef.current = ignore
      void api.setIgnoreMouseEvents(ignore)
    }

    const onMove = (event: MouseEvent) => {
      // While the grip drag is running, stay interactive no matter where the
      // cursor is — setIgnoreMouseEvents(true) mid-gesture kills the drag.
      if (isWindowDragging() || event.buttons !== 0) {
        setIgnore(false)
        return
      }
      const el = document.elementFromPoint(event.clientX, event.clientY)
      const overHit = Boolean(el?.closest(HIT_SELECTOR))
      setIgnore(!overHit)
    }

    const onLeave = (event: MouseEvent) => {
      // A drag fires mouseleave with buttons === 0 on this window, so the
      // explicit drag flag — not the button state — is what guards it.
      if (isWindowDragging() || event.buttons !== 0) return
      setIgnore(true)
    }

    // Start in pass-through mode (matches WindowHelper default).
    void api.setIgnoreMouseEvents(true)
    ignoringRef.current = true

    // Capture phase so we see moves even if a child stops propagation.
    window.addEventListener("mousemove", onMove, true)
    document.addEventListener("mouseleave", onLeave)

    return () => {
      window.removeEventListener("mousemove", onMove, true)
      document.removeEventListener("mouseleave", onLeave)
    }
  }, [])
}
