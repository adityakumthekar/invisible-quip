import React, { useEffect, useRef } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Copy, Monitor, Send, X } from "lucide-react"
import { cn } from "../../lib/utils"

export interface ChatMessage {
  role: "user" | "gemini"
  text: string
}

interface AIResponseProps {
  title?: string
  messages: ChatMessage[]
  loading: boolean
  modelLabel: string
  input: string
  includeScreen: boolean
  onInputChange: (value: string) => void
  onSend: () => void
  onToggleIncludeScreen: () => void
  onClose?: () => void
  className?: string
}

const AIResponse: React.FC<AIResponseProps> = ({
  title = "AI response",
  messages,
  loading,
  modelLabel,
  input,
  includeScreen,
  onInputChange,
  onSend,
  onToggleIncludeScreen,
  onClose,
  className
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const lastAssistant = [...messages].reverse().find((m) => m.role === "gemini")
  const hasContent = messages.length > 0 || loading

  const handleCopy = async () => {
    if (!lastAssistant?.text) return
    try {
      await navigator.clipboard.writeText(lastAssistant.text)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={cn(
        "glass-panel-dark panel-enter flex flex-col w-full overflow-hidden transition-[min-height] duration-200",
        hasContent ? "min-h-[240px] max-h-[460px]" : "min-h-0",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5",
          hasContent && "border-b border-glass"
        )}
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-[13px] font-semibold tracking-tight glass-heading">
            {title}
          </h2>
          {!hasContent && (
            <span className="text-[11px] glass-subtle truncate">
              {modelLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="no-drag p-1.5 rounded-md glass-icon hover:text-white hover:bg-glass-hover"
            onClick={handleCopy}
            title="Copy last response"
            disabled={!lastAssistant}
          >
            <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
          {onClose && (
            <button
              type="button"
              className="no-drag p-1.5 rounded-md glass-icon hover:text-white hover:bg-glass-hover"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {hasContent && (
        <div
          ref={scrollRef}
          className="glass-reading flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[120px]"
        >
          {messages.length > 0 &&
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={cn(
                "text-[13px] leading-[1.6]",
                msg.role === "user"
                  ? "glass-muted pl-3 border-l-2 border-glass"
                  : "glass-text"
              )}
            >
              {msg.role === "user" ? (
                <p>{msg.text}</p>
              ) : (
                <div className="chat-md chat-md-dark">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.text}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          ))}
          {loading && (
            <p className="text-xs glass-muted animate-pulse">Thinking…</p>
          )}
        </div>
      )}

      <form
        className={cn(
          "no-drag flex items-center gap-1.5 px-3 pb-3 pt-2.5",
          // Conditional, or an empty panel renders two abutting 1px lines.
          hasContent && "border-t border-glass"
        )}
        onSubmit={(e) => {
          e.preventDefault()
          onSend()
        }}
      >
        <button
          type="button"
          onClick={onToggleIncludeScreen}
          title={
            includeScreen
              ? "Screen will be sent with your message"
              : "Include a screenshot"
          }
          aria-pressed={includeScreen}
          className={cn(
            "p-2 rounded-lg border transition-colors",
            includeScreen ? "glass-action" : "glass-control glass-icon"
          )}
        >
          <Monitor className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
        <input
          ref={inputRef}
          className="glass-control flex-1 rounded-lg px-3 py-2 text-[12.5px]"
          placeholder={
            includeScreen ? "Ask about your screen…" : "Ask a follow-up…"
          }
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="glass-action p-2 rounded-lg disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </form>
    </div>
  )
}

export default AIResponse
