import { useEffect, DependencyList, RefObject } from "react"

// Reports the ref'd element's size to the main process so it can resize the
// (frameless, content-fitted) window. extraHeight accounts for overlays, like
// a hover tooltip, that aren't part of contentRef's own scrollHeight.
export function useContentDimensions(
  contentRef: RefObject<HTMLDivElement>,
  extraHeight: number,
  deps: DependencyList
) {
  useEffect(() => {
    const updateDimensions = () => {
      if (!contentRef.current) return
      const contentWidth = contentRef.current.scrollWidth
      const contentHeight = contentRef.current.scrollHeight + extraHeight
      window.electronAPI.updateContentDimensions({
        width: contentWidth,
        height: contentHeight
      })
    }

    const resizeObserver = new ResizeObserver(updateDimensions)
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current)
    }
    updateDimensions()

    return () => resizeObserver.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
