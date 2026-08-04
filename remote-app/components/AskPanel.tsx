import React, { useEffect, useRef, useState } from "react"
import { MODES } from "../../src/lib/modes"

export interface ChatEntry {
  id: string
  role: "user" | "assistant"
  text: string
}

interface AskPanelProps {
  thread: ChatEntry[]
  streaming: boolean
  error: string | null
  onSend: (message: string, withScreen: boolean, persona: string) => void
  onCancel: () => void
}

/**
 * Modes are resolved here rather than on the laptop. MODES is pure data, so the
 * phone bundle imports the same list the overlay uses and sends the prompt text
 * along with each message — which the existing chat handler already accepts as
 * a per-request persona override. Nothing about mode state has to be mirrored
 * in the main process.
 */
const AskPanel: React.FC<AskPanelProps> = ({
  thread,
  streaming,
  error,
  onSend,
  onCancel
}) => {
  const [message, setMessage] = useState("")
  const [withScreen, setWithScreen] = useState(false)
  const [modeId, setModeId] = useState(MODES[0].id)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" })
  }, [thread])

  const send = () => {
    const trimmed = message.trim()
    if (!trimmed || streaming) {
      return
    }
    const mode = MODES.find((entry) => entry.id === modeId) ?? MODES[0]
    onSend(trimmed, withScreen, mode.prompt)
    setMessage("")
  }

  return (
    <>
      <div className="panel">
        <div className="card">
          <div className="frame-meta">
            <select
              value={modeId}
              onChange={(event) => setModeId(event.target.value)}
              aria-label="Mode"
              style={{
                flex: 1,
                minHeight: 40,
                background: "var(--surface-raised)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "0 10px",
                font: "inherit"
              }}
            >
              {MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
            <label
              style={{
                margin: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 6
              }}
            >
              <input
                type="checkbox"
                checked={withScreen}
                onChange={(event) => setWithScreen(event.target.checked)}
                style={{ width: 20, minHeight: 20 }}
              />
              Screen
            </label>
          </div>
        </div>

        {thread.length === 0 && (
          <p className="notice">
            Ask anything. Tick “Screen” to include a picture of the laptop
            display with your question.
          </p>
        )}

        <div className="thread">
          {thread.map((entry) => (
            <div key={entry.id} className={`bubble ${entry.role}`}>
              {entry.text || (entry.role === "assistant" ? "…" : "")}
            </div>
          ))}
          <div ref={bottom} />
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="composer">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, 8000))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          placeholder="Ask Quip…"
          rows={1}
          aria-label="Message"
        />
        {streaming ? (
          <button type="button" onClick={onCancel}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={send}
            disabled={!message.trim()}
          >
            Send
          </button>
        )}
      </div>
    </>
  )
}

export default AskPanel
