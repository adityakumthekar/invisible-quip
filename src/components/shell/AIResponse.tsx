import React, { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { dracula } from "react-syntax-highlighter/dist/esm/styles/prism"
import {
  ArrowDown,
  Check,
  Copy,
  MessageSquare,
  Mic,
  Monitor,
  MonitorDot,
  Send,
  Settings2,
  Square,
  X
} from "lucide-react"
import { cn } from "../../lib/utils"
import { languageFromClassName } from "../../lib/codeLanguage"
import { copyableText, extractCodeBlocks } from "../../lib/markdownCode"
import {
  formatClock,
  formatDuration,
  lastExchangeStart,
  startsExchange,
  type ChatMessage
} from "../../lib/chatMessages"

export type { ChatMessage }

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath]
const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex]

/**
 * Breathing room above the pinned question. The anchor turn carries the
 * exchange hairline on its own top edge (border-t + pt-3), so scrolling it
 * flush would clip the rule against the scroller.
 */
const ANCHOR_TOP_GAP = 12

/** Shared by the header and per-block copy buttons: writes, then confirms. */
function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = (text: string) => {
    if (!text) return
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {
        /* ignore */
      })
  }

  return [copied, copy]
}

const CopyButton: React.FC<{
  text: string
  label: string
  className?: string
  disabled?: boolean
}> = ({ text, label, className, disabled }) => {
  const [copied, copy] = useCopy()
  const Icon = copied ? Check : Copy

  return (
    <button
      type="button"
      className={cn(
        "no-drag p-1.5 rounded-inner glass-icon hover:text-white hover:bg-glass-hover",
        className
      )}
      onClick={() => copy(text)}
      title={copied ? "Copied" : label}
      aria-label={label}
      disabled={disabled}
    >
      <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
    </button>
  )
}

/**
 * Fenced blocks get Prism highlighting; inline code keeps the plain <code> so
 * the chip styling in index.css still applies. react-markdown v9 dropped the
 * `inline` prop, so a block is anything with a language tag or a newline —
 * that second test is what catches an untagged fence.
 */
const CodeBlock: React.FC<{
  className?: string
  children?: React.ReactNode
}> = ({ className, children }) => {
  const text = String(children ?? "").replace(/\n$/, "")
  const language = languageFromClassName(className)
  const isBlock = language !== null || text.includes("\n")

  if (!isBlock) {
    return <code className={className}>{children}</code>
  }

  return (
    <div className="chat-code">
      {/* Outside the scroller, or it would slide away with a wide line. */}
      <CopyButton text={text} label="Copy code" className="chat-code-copy" />
      <div className="chat-code-scroll">
        <SyntaxHighlighter
          language={language ?? undefined}
          style={dracula}
          PreTag="div"
          customStyle={{
            margin: 0,
            padding: "0.7em",
            background: "transparent",
            fontSize: "0.9em"
          }}
          codeTagProps={{ style: { fontFamily: "inherit" } }}
        >
          {text}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}

// One 11px line per turn. On a 560px translucent panel over an arbitrary
// desktop, avatars and chat bubbles cost width and contrast without adding
// information — the source icon and the clock are what make a long mixed
// session scannable.
const SOURCE_META: Record<
  ChatMessage["source"],
  { icon: typeof Mic; label: string }
> = {
  typed: { icon: MessageSquare, label: "You" },
  voice: { icon: Mic, label: "You · voice" },
  screen: { icon: MonitorDot, label: "Screen" },
  system: { icon: Settings2, label: "Quip" }
}

const TurnHeader: React.FC<{ msg: ChatMessage }> = ({ msg }) => {
  const { icon: Icon, label: sourceLabel } = SOURCE_META[msg.source]
  // The other side of the call is still a "user" turn, but labelling it "You"
  // would attribute the interviewer's question to the person reading it.
  const label = msg.speaker === "them" ? "Them · voice" : sourceLabel
  return (
    <div className="flex items-center gap-1.5 text-meta glass-subtle mb-1">
      <Icon className="w-3 h-3 shrink-0" strokeWidth={1.75} />
      <span className="truncate">{label}</span>
      {msg.durationSec !== undefined && (
        <span className="tabular-nums">
          · {formatDuration(msg.durationSec)}
        </span>
      )}
      <span className="ml-auto tabular-nums">{formatClock(msg.at)}</span>
    </div>
  )
}

// A fenced block renders its own surface, so the default <pre> wrapper would
// just stack a second background behind it.
const MARKDOWN_COMPONENTS = {
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  code: CodeBlock
}

interface AIResponseProps {
  title?: string
  messages: ChatMessage[]
  loading: boolean
  /**
   * True for the whole lifetime of a request, unlike `loading`, which drops as
   * soon as the first token lands. The stop control keys off this.
   */
  streaming?: boolean
  modelLabel: string
  input: string
  includeScreen: boolean
  onInputChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  onToggleIncludeScreen: () => void
  onClose?: () => void
  className?: string
}

const AIResponse: React.FC<AIResponseProps> = ({
  title = "AI response",
  messages,
  loading,
  streaming = false,
  modelLabel,
  input,
  includeScreen,
  onInputChange,
  onSend,
  onStop,
  onToggleIncludeScreen,
  onClose,
  className
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // The panel used to pin itself to scrollHeight on every stream frame, which
  // meant you watched the tail of an answer being written and had to hunt
  // backwards for your own question to read it from the top. Instead: park the
  // newest question at the top of the scroller and let the answer fill in
  // beneath it.
  //
  // `followRef` drives the scrolling and `detached` only paints the Latest
  // chip: the anchoring effect runs on every stream chunk and must read the
  // current value without re-subscribing per render.
  const followRef = useRef(true)
  const [detached, setDetached] = useState(false)
  const anchorId = messages[lastExchangeStart(messages)]?.id

  const setFollowing = (next: boolean) => {
    followRef.current = next
    setDetached(!next)
  }

  const anchorToTop = () => {
    const container = scrollRef.current
    if (!container || !anchorId) return
    const anchor = container.querySelector<HTMLElement>(
      `[data-msg-id="${anchorId}"]`
    )
    if (!anchor) return
    const offset =
      anchor.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop
    container.scrollTop = Math.max(0, offset - ANCHOR_TOP_GAP)
  }

  // A new exchange re-arms anchoring, whatever the reader did during the last.
  useEffect(() => {
    setFollowing(true)
  }, [anchorId])

  // Re-applied on every frame, not just at turn start: the assistant turn is an
  // empty placeholder when the exchange opens, so there is nothing below the
  // question to scroll against and the browser clamps the write. Re-running as
  // the answer grows walks the question up to the top and holds it there.
  useEffect(() => {
    if (!followRef.current) return
    anchorToTop()
  }, [messages, loading, anchorId])

  // Hand control over on the gesture itself rather than on a scroll event: main
  // resizes the window from content height all through a stream (see App.tsx),
  // and the resulting clamp of scrollTop is indistinguishable from a reader
  // scrolling. A trackpad two-finger scroll fires wheel, which is the real case.
  const releaseFollow = () => {
    setFollowing(false)
  }

  // Back to the current exchange, rather than to the raw bottom: the whole
  // point of anchoring is that the question stays readable from the top.
  const jumpToLatest = () => {
    setFollowing(true)
    anchorToTop()
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "gemini")
  const hasContent = messages.length > 0 || loading

  // Copying an answer is nearly always about the code; the raw markdown would
  // paste fence tags and LaTeX into an editor. Prose-only replies still copy
  // whole, and each block carries its own button for picking just one.
  const answer = lastAssistant?.text ?? ""
  const hasCode = extractCodeBlocks(answer).length > 0

  return (
    <div
      className={cn(
        "glass-panel-dark panel-enter flex flex-col w-full overflow-hidden transition-[min-height] duration-200",
        "min-h-0",
        className
      )}
      // Display-aware cap, published by main (see App.tsx). The 460px fallback
      // is what applies before the first resize round-trip lands.
      style={{ maxHeight: "var(--chat-max-h, 460px)" }}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5",
          hasContent && "border-b border-glass"
        )}
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-title font-semibold tracking-tight glass-heading">
            {title}
          </h2>
          {/* Always on, not only on an empty panel. With the Gemini ↔ remote
              Qwen toggle live, "which model wrote that?" is a question you get
              mid-session, and this header is the only place that answers it. */}
          {/* Chipped, not bare: the panel header has no reading scrim, and at
              the `subtle` tier over a thin fill on a white desktop this
              measures 3.36:1 — the chip takes it to 5.01:1. */}
          <span
            className="glass-badge text-meta glass-subtle shrink-0 truncate"
            title={modelLabel}
          >
            {modelLabel}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <CopyButton
            text={copyableText(answer)}
            label={hasCode ? "Copy code" : "Copy last response"}
            disabled={!lastAssistant}
          />
          {onClose && (
            <button
              type="button"
              className="no-drag p-1.5 rounded-inner glass-icon hover:text-white hover:bg-glass-hover"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {hasContent && (
        <div className="relative flex min-h-0 flex-1">
          <div
            ref={scrollRef}
            onWheel={releaseFollow}
            onTouchMove={releaseFollow}
            className="glass-reading flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[120px]"
          >
            {messages.map((msg, idx) => {
              // One hairline per exchange, so consecutive turns of the same
              // exchange stay visually joined.
              const rule = startsExchange(messages[idx - 1], msg)

              if (msg.source === "system") {
                return (
                  <div
                    key={msg.id}
                    className={cn(
                      "text-meta glass-subtle text-center",
                      rule && "border-t border-glass pt-3"
                    )}
                  >
                    {msg.text}
                  </div>
                )
              }

              return (
                <div
                  key={msg.id}
                  data-msg-id={msg.id}
                  className={cn(
                    "text-title leading-[1.6]",
                    rule && "border-t border-glass pt-3",
                    msg.role === "user" ? "glass-muted" : "glass-text"
                  )}
                >
                  {msg.role === "user" ? (
                    <>
                      <TurnHeader msg={msg} />
                      {/* A header-only turn is how a screen glance or a silent
                        clip shows its provenance without a body. */}
                      {msg.text && (
                        <p className="pl-3 border-l-2 border-glass">
                          {msg.text}
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="chat-md chat-md-dark">
                      <ReactMarkdown
                        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
                        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                        components={MARKDOWN_COMPONENTS}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              )
            })}
            {loading && (
              <p className="text-body glass-muted animate-pulse">Thinking…</p>
            )}
          </div>
          {/* Only while detached. Pinned is the common case, and a permanent
              floating chip over the transcript would cost more than it earns. */}
          {detached && (
            <button
              type="button"
              onClick={jumpToLatest}
              className="glass-control absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-2.5 py-1 text-meta glass-text"
            >
              <ArrowDown className="w-3 h-3" strokeWidth={1.75} />
              Latest
            </button>
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
          // Enter is still live while an answer streams (the input stays
          // enabled so you can compose the follow-up), but firing a second
          // request now would leave two streams writing the same last message.
          if (streaming) return
          // You just acted — go to it, wherever you'd scrolled to.
          setFollowing(true)
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
            "p-2 rounded-nested border transition-colors",
            includeScreen ? "glass-action" : "glass-control glass-icon"
          )}
        >
          <Monitor className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
        <input
          ref={inputRef}
          className="glass-control flex-1 rounded-nested px-3 py-2 text-body"
          placeholder={
            includeScreen ? "Ask about your screen…" : "Ask a follow-up…"
          }
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
        />
        {/* Stop replaces Send for the duration of a request, rather than
            sitting beside it: the two are never both useful, and the bar's
            width is the overlay's width. Keyed off `streaming`, not `loading` —
            loading drops the instant the first token lands, so a stop button
            gated on it would vanish exactly when you want it. */}
        {streaming && onStop ? (
          <button
            type="button"
            onClick={onStop}
            className="glass-action p-2 rounded-nested"
            title="Stop generating"
            aria-label="Stop generating"
          >
            <Square
              className="w-3.5 h-3.5"
              strokeWidth={1.75}
              fill="currentColor"
            />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="glass-action p-2 rounded-nested disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        )}
      </form>
    </div>
  )
}

export default AIResponse
