import React, { useCallback, useEffect, useReducer, useRef, useState } from "react"
import {
  autopilotSessionReducer,
  initialAutopilotSessionState,
  isAutopilotBusy
} from "../src/lib/autopilotSession"
import type {
  RemoteCommand,
  RemoteEvent,
  RemoteScreenFrame,
  RemoteStatus
} from "../src/lib/remoteProtocol"
import { hasBaseUrl } from "./lib/config"
import {
  clearStoredToken,
  getStoredToken,
  openEventStream,
  RemoteError,
  sendCommand
} from "./lib/remoteClient"
import ConnectScreen from "./components/ConnectScreen"
import PairScreen from "./components/PairScreen"
import RunPanel from "./components/RunPanel"
import ScreenView from "./components/ScreenView"
import AskPanel, { type ChatEntry } from "./components/AskPanel"

type Tab = "screen" | "run" | "ask"

// Screen leads: it is the reason this app exists, and the other two are things
// you ask for rather than things you watch.
const TABS: { id: Tab; label: string }[] = [
  { id: "screen", label: "Screen" },
  { id: "run", label: "Run" },
  { id: "ask", label: "Ask" }
]

const App: React.FC = () => {
  const [located, setLocated] = useState(hasBaseUrl)
  const [paired, setPaired] = useState(() => getStoredToken() !== null)
  const [tab, setTab] = useState<Tab>("screen")
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [frame, setFrame] = useState<RemoteScreenFrame | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)

  const [session, dispatch] = useReducer(
    autopilotSessionReducer,
    initialAutopilotSessionState
  )

  const [thread, setThread] = useState<ChatEntry[]>([])
  const [chatError, setChatError] = useState<string | null>(null)
  // The in-flight chat request, so deltas land on the right bubble and Stop
  // knows what to cancel.
  const streamingId = useRef<string | null>(null)
  const [streaming, setStreaming] = useState(false)

  const handleEvent = useCallback((event: RemoteEvent) => {
    switch (event.type) {
      case "status":
        setStatus(event.status)
        return

      case "autopilot-update":
        dispatch({ type: "update", update: event.update })
        return

      case "screen-frame":
        setFrame(event.frame)
        return

      case "chat-chunk":
        if (streamingId.current !== event.requestId) {
          return
        }
        setThread((entries) =>
          entries.map((entry) =>
            entry.id === event.requestId
              ? { ...entry, text: entry.text + event.delta }
              : entry
          )
        )
        return

      case "chat-done":
        if (streamingId.current !== event.requestId) {
          return
        }
        // Take the final text verbatim rather than trusting that every delta
        // arrived — a dropped frame mid-stream would otherwise leave a gap.
        setThread((entries) =>
          entries.map((entry) =>
            entry.id === event.requestId ? { ...entry, text: event.text } : entry
          )
        )
        streamingId.current = null
        setStreaming(false)
        return

      case "chat-error":
        if (streamingId.current !== event.requestId) {
          return
        }
        setChatError(event.message)
        streamingId.current = null
        setStreaming(false)
        return
    }
  }, [])

  useEffect(() => {
    if (!paired) {
      return
    }
    return openEventStream({
      onEvent: handleEvent,
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false)
    })
  }, [paired, handleEvent])

  /** Run a command, surfacing a revoked pairing as a return to the pair screen. */
  const run = useCallback(
    async <T,>(command: RemoteCommand): Promise<T | null> => {
      setCommandError(null)
      try {
        return (await sendCommand<T>(command)) ?? null
      } catch (caught) {
        if (caught instanceof RemoteError && caught.status === 401) {
          clearStoredToken()
          setPaired(false)
          return null
        }
        setCommandError(caught instanceof Error ? caught.message : String(caught))
        return null
      }
    },
    []
  )

  const refreshStatus = useCallback(async () => {
    const next = await run<RemoteStatus>({ type: "status/get" })
    if (next) {
      setStatus(next)
    }
  }, [run])

  const startRun = useCallback(
    async (goal: string) => {
      dispatch({ type: "set-goal", goal })
      dispatch({ type: "start-requested" })
      const started = await run({ type: "autopilot/start", goal })
      if (!started) {
        // `run` already surfaced why; reset so the goal box comes back rather
        // than leaving a spinner that will never resolve.
        dispatch({ type: "reset" })
        void refreshStatus()
      }
    },
    [run, refreshStatus]
  )

  const sendChat = useCallback(
    (message: string, withScreen: boolean, persona: string) => {
      const requestId =
        globalThis.crypto?.randomUUID?.() ?? `r-${Date.now()}-${Math.random()}`
      streamingId.current = requestId
      setStreaming(true)
      setChatError(null)
      setThread((entries) => [
        ...entries,
        { id: `${requestId}-q`, role: "user", text: message },
        { id: requestId, role: "assistant", text: "" }
      ])
      void run({
        type: "chat/send",
        requestId,
        message,
        withScreen,
        persona
      }).then((result) => {
        // A refused send never streams, so don't leave the composer disabled.
        if (result === null && streamingId.current === requestId) {
          streamingId.current = null
          setStreaming(false)
        }
      })
    },
    [run]
  )

  const cancelChat = useCallback(() => {
    const requestId = streamingId.current
    if (!requestId) {
      return
    }
    streamingId.current = null
    setStreaming(false)
    void run({ type: "chat/cancel", requestId })
  }, [run])

  useEffect(() => {
    if (paired) {
      void refreshStatus()
    }
  }, [paired, refreshStatus])

  if (!located) {
    return (
      <div className="app">
        <header className="header">
          <h1>Quip Remote</h1>
        </header>
        <ConnectScreen onConnected={() => setLocated(true)} />
      </div>
    )
  }

  if (!paired) {
    return (
      <div className="app">
        <header className="header">
          <h1>Quip Remote</h1>
        </header>
        <PairScreen onPaired={() => setPaired(true)} />
      </div>
    )
  }

  const runBusy = isAutopilotBusy(session)

  return (
    <div className="app">
      <header className="header">
        <h1>Quip Remote</h1>
        <span className="conn" data-state={connected ? "live" : "down"} role="status">
          {connected ? "Connected" : "Reconnecting…"}
        </span>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {commandError && (
        <p className="error" style={{ padding: "10px 16px 0" }} role="alert">
          {commandError}
        </p>
      )}

      {tab === "screen" && (
        <ScreenView
          displays={status?.displays ?? []}
          activeDisplayId={status?.activeDisplayId ?? null}
          // Both halves must hold, and the laptop is the authority on both —
          // never infer this locally.
          inputEnabled={status?.inputEnabled === true}
          onCommand={run}
          onSelectDisplay={(displayId) => {
            void run({ type: "screen/select", displayId }).then(refreshStatus)
          }}
        />
      )}

      {tab === "run" && (
        <RunPanel
          session={session}
          status={status}
          latestFrame={frame?.dataUrl ?? null}
          onStart={startRun}
          onConfirm={() => void run({ type: "autopilot/confirm" })}
          onReject={() => void run({ type: "autopilot/reject" })}
        />
      )}

      {tab === "ask" && (
        <AskPanel
          thread={thread}
          streaming={streaming}
          error={chatError}
          onSend={sendChat}
          onCancel={cancelChat}
        />
      )}

      {/* Pinned outside the panels and shown for the whole run, not just while
          a step is pending. The desktop kill-switch shortcut is unreachable
          when you're not at the machine, so this is the only stop that exists —
          it must never be a scroll away. */}
      {runBusy && tab !== "ask" && (
        <div className="stopbar">
          <button
            type="button"
            className="danger"
            onClick={() => void run({ type: "autopilot/stop" })}
          >
            Stop
          </button>
        </div>
      )}
    </div>
  )
}

export default App
