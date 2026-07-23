// Single source for the keybinds shown in the bar tooltip and the Settings tab.
// ponytail: display only — shortcuts are registered statically in electron/shortcuts.ts.
export interface Shortcut {
  action: string
  keys: string[]
}

export const SHORTCUTS: Shortcut[] = [
  { action: "Show / hide window", keys: ["⌘", "B"] },
  { action: "Screenshot", keys: ["⌘", "H"] },
  { action: "Ask AI / Solve", keys: ["⌘", "↵"] },
  { action: "Move window", keys: ["⌘", "↑↓←→"] },
  { action: "Reset", keys: ["⌘", "R"] },
  { action: "Quit", keys: ["⌘", "Q"] }
]
