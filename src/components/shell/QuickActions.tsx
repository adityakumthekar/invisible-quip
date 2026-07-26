import React from "react"
import {
  FileText,
  Languages,
  ListChecks,
  MessageSquareReply,
  Sparkles,
  Wand2
} from "lucide-react"

export interface QuickAction {
  label: string
  icon: React.ElementType
  prompt: string
  useScreen: boolean
}

const ACTIONS: QuickAction[] = [
  {
    label: "Summarize screen",
    icon: FileText,
    prompt: "Summarize what's on my screen in a few bullet points.",
    useScreen: true
  },
  {
    label: "Explain this",
    icon: Sparkles,
    prompt: "Explain what's shown on my screen simply.",
    useScreen: true
  },
  {
    label: "Draft a reply",
    icon: MessageSquareReply,
    prompt:
      "Draft a concise, friendly reply to the message on my screen.",
    useScreen: true
  },
  {
    label: "Key points",
    icon: ListChecks,
    prompt: "Pull out the key points and any action items from my screen.",
    useScreen: true
  },
  {
    label: "Improve / fix",
    icon: Wand2,
    prompt: "Improve or fix the text or code shown on my screen.",
    useScreen: true
  },
  {
    label: "Translate",
    icon: Languages,
    prompt: "Translate the text on my screen to English.",
    useScreen: true
  }
]

interface QuickActionsProps {
  onRun: (prompt: string, useScreen: boolean) => void
}

const QuickActions: React.FC<QuickActionsProps> = ({ onRun }) => (
  <div className="glass-panel-dark panel-enter w-[300px] p-3 no-drag">
    <p className="text-[11px] uppercase tracking-wide glass-muted pb-2">
      Quick actions
    </p>
    <div className="grid grid-cols-2 gap-1.5">
      {ACTIONS.map(({ label, icon: Icon, prompt, useScreen }) => (
        <button
          key={label}
          type="button"
          onClick={() => onRun(prompt, useScreen)}
          className="glass-control flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] glass-text hover:bg-glass-hover transition-colors"
        >
          <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  </div>
)

export default QuickActions
