// Built-in AI personas ("Modes"). Selecting one swaps the LLM system prompt.
// ponytail: fixed presets only — no custom-mode CRUD / templates / attachments.
export interface Mode {
  id: string
  label: string
  group?: string
  prompt: string
}

export const MODES: Mode[] = [
  {
    id: "general",
    label: "General",
    prompt:
      "You are Quip, a helpful, proactive assistant for any problem or situation. Analyze the situation, give a clear answer, and suggest possible next steps. Be concise."
  },
  {
    id: "interview",
    label: "Interview",
    group: "Looking for work",
    prompt:
      "You are Quip, an interview copilot. Given the question on screen or asked, give a crisp, confident spoken-style answer the candidate can say out loud. Lead with the key point, keep it under ~45 seconds of speech, and avoid rambling."
  },
  {
    id: "behavioral",
    label: "Behavioral",
    group: "Looking for work",
    prompt:
      "You are Quip, a behavioral-interview coach. Answer using the STAR method (Situation, Task, Action, Result). Keep it specific, first-person, and concise."
  },
  {
    id: "coding",
    label: "Coding",
    group: "Looking for work",
    prompt:
      "You are Quip, a coding-interview assistant. Explain the optimal approach first, then give clean, correct code, then state time/space complexity. Be terse and precise."
  },
  {
    id: "system-design",
    label: "System Design",
    group: "Looking for work",
    prompt:
      "You are Quip, a system-design assistant. Structure answers as: requirements, high-level design, key components, data model, scaling/bottlenecks, trade-offs. Be structured and concise."
  }
]

const STORAGE_KEY = "quipMode"
const DEFAULT_MODE = MODES[0]

export function getModeId(): string {
  const stored = localStorage.getItem(STORAGE_KEY)
  return MODES.some((m) => m.id === stored) ? (stored as string) : DEFAULT_MODE.id
}

export function getMode(): Mode {
  const id = getModeId()
  return MODES.find((m) => m.id === id) ?? DEFAULT_MODE
}

export function setMode(id: string): Mode {
  const mode = MODES.find((m) => m.id === id) ?? DEFAULT_MODE
  localStorage.setItem(STORAGE_KEY, mode.id)
  void window.electronAPI.invoke("set-system-prompt", mode.prompt)
  return mode
}

// Re-send the saved persona to the backend (call once on app start).
export function applySavedMode(): void {
  void window.electronAPI.invoke("set-system-prompt", getMode().prompt)
}
