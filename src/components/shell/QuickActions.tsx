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

/**
 * These are explicit one-off tasks, not questions put to the active mode — a
 * "Translate" run under Interview mode was being answered by an interview
 * copilot. Sent as a per-request persona override, so the user's chosen mode is
 * untouched and the next typed question still uses it.
 */
export const QUICK_ACTION_PERSONA =
  "You are Quip, a precise assistant. Perform exactly the task asked of the content on screen and nothing more — no commentary on the task, no suggestions beyond it."

const ACTIONS: QuickAction[] = [
  {
    label: "Summarize screen",
    icon: FileText,
    prompt:
      "Summarize what's on my screen as bullet points — the substance, not a description of the layout.",
    useScreen: true
  },
  {
    label: "Explain this",
    icon: Sparkles,
    prompt:
      "Explain what's shown on my screen in plain language: what it is, what it does, and why it matters.",
    useScreen: true
  },
  {
    label: "Draft a reply",
    icon: MessageSquareReply,
    prompt:
      "Draft a reply to the message on my screen. Match its tone and register, and answer every question it asks. Output the reply text only.",
    useScreen: true
  },
  {
    label: "Key points",
    icon: ListChecks,
    prompt:
      "Pull the key points and action items off my screen. Give each action item its owner and deadline where the screen states one.",
    useScreen: true
  },
  {
    label: "Improve / fix",
    icon: Wand2,
    prompt:
      "Improve or fix the text or code on my screen. Output the corrected version in full, then one line on what changed and why.",
    useScreen: true
  },
  {
    label: "Translate",
    icon: Languages,
    prompt:
      "Translate the text on my screen to English. Output the translation only, keeping the original's structure and line breaks.",
    useScreen: true
  }
]

interface QuickActionsProps {
  onRun: (prompt: string, useScreen: boolean, persona: string) => void
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
          onClick={() => onRun(prompt, useScreen, QUICK_ACTION_PERSONA)}
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
