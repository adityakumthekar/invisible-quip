import { ToastProvider } from "./components/ui/toast"
import Queue from "./_pages/Queue"
import { ToastViewport } from "@radix-ui/react-toast"
import { useEffect, useRef, useState } from "react"
import Solutions from "./_pages/Solutions"
import { QueryClient, QueryClientProvider } from "react-query"
import TeachingTargetOverlay from "./components/teaching/TeachingTargetOverlay"
import { useClickThrough } from "./hooks/useClickThrough"

const MainApp: React.FC = () => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: Infinity,
            cacheTime: Infinity
          }
        }
      })
  )
  const [view, setView] = useState<"queue" | "solutions">("queue")
  const containerRef = useRef<HTMLDivElement>(null)
  useClickThrough()

  // Effect for height monitoring
  useEffect(() => {
    const cleanup = window.electronAPI.onResetView(() => {
      console.log("Received 'reset-view' message from main process.")
      queryClient.invalidateQueries(["screenshots"])
      queryClient.invalidateQueries(["problem_statement"])
      queryClient.invalidateQueries(["solution"])
      queryClient.invalidateQueries(["new_solution"])
      setView("queue")
    })

    return () => {
      cleanup()
    }
  }, [])

  // Main owns the height cap because it owns the display's work area. The chat
  // scroller reads it as a CSS variable — it can't use vh, since the viewport
  // is the window and the window is sized from this very content.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onContentLimits(
      ({ maxHeight, maxWidth }) => {
        // Control bar + panel header + input row + the pb-8 shadow guard, none
        // of which live inside the scroller.
        const CHROME_PX = 150
        const budget = Math.max(200, maxHeight - CHROME_PX)
        document.documentElement.style.setProperty("--chat-max-h", `${budget}px`)

        // Same reasoning on the other axis: a panel sized in % or vw resolves
        // against the window, and the window is sized from this content — so a
        // narrow window would latch itself narrow forever. The cap has to come
        // from the display, which only main knows.
        // The window width main grants includes the px-3 wrapper (24) and the
        // WIDTH_PAD chrome allowance (32) that the panel itself can't use.
        const SIDE_CHROME_PX = 56
        const widthBudget = Math.max(560, maxWidth - SIDE_CHROME_PX)
        document.documentElement.style.setProperty(
          "--panel-max-w",
          `${widthBudget}px`
        )
      }
    )
    return () => {
      unsubscribe && unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    const updateHeight = () => {
      if (!containerRef.current) return
      const height = containerRef.current.scrollHeight
      const width = containerRef.current.scrollWidth
      window.electronAPI?.updateContentDimensions({ width, height })
    }

    const resizeObserver = new ResizeObserver(() => {
      updateHeight()
    })

    // Initial height update
    updateHeight()

    // Observe for changes
    resizeObserver.observe(containerRef.current)

    // Also update height when view changes
    const mutationObserver = new MutationObserver(() => {
      updateHeight()
    })

    // childList only — watching attributes/characterData fired setSize on every
    // incidental class or text tick, which stutters an in-flight window drag.
    mutationObserver.observe(containerRef.current, {
      childList: true,
      subtree: true
    })

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [view]) // Re-run when view changes

  useEffect(() => {
    const cleanupFunctions = [
      window.electronAPI.onSolutionStart(() => {
        setView("solutions")
        console.log("starting processing")
      }),

      window.electronAPI.onUnauthorized(() => {
        queryClient.removeQueries(["screenshots"])
        queryClient.removeQueries(["solution"])
        queryClient.removeQueries(["problem_statement"])
        setView("queue")
        console.log("Unauthorized")
      }),
      // Update this reset handler
      window.electronAPI.onResetView(() => {
        console.log("Received 'reset-view' message from main process")

        queryClient.removeQueries(["screenshots"])
        queryClient.removeQueries(["solution"])
        queryClient.removeQueries(["problem_statement"])
        setView("queue")
        console.log("View reset to 'queue' via Command+R shortcut")
      }),
      window.electronAPI.onProblemExtracted((data: any) => {
        if (view === "queue") {
          console.log("Problem extracted successfully")
          queryClient.invalidateQueries(["problem_statement"])
          queryClient.setQueryData(["problem_statement"], data)
        }
      })
    ]
    return () => cleanupFunctions.forEach((cleanup) => cleanup())
  }, [])

  return (
    <div ref={containerRef} className="min-h-0 font-sans">
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          {view === "queue" ? (
            <Queue setView={setView} />
          ) : (
            <Solutions setView={setView} />
          )}
          <ToastViewport />
        </ToastProvider>
      </QueryClientProvider>
    </div>
  )
}

const App: React.FC = () => {
  const route = new URLSearchParams(window.location.search).get("view")
  return route === "teaching-overlay" ? <TeachingTargetOverlay /> : <MainApp />
}

export default App
