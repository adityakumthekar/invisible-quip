// The accelerators were 11 literal strings inside registerGlobalShortcuts, which
// made collisions invisible. Naming them here lets a test assert uniqueness and
// gives the record binding one place to change.
export const GLOBAL_ACCELERATORS = {
  SHOW: "CommandOrControl+Shift+Space",
  SCREENSHOT: "CommandOrControl+H",
  ASK_AI: "CommandOrControl+Enter",
  // ⌥M: a two-key chord that macOS actually delivers. Punctuation accelerators
  // (⌘/, ⌥.) register without error here and then silently never fire, so the
  // record key has to be a letter.
  RECORD: "Alt+M",
  RESET: "CommandOrControl+R",
  // Chat-only reset, as opposed to RESET which tears down the whole workspace.
  NEW_CHAT: "CommandOrControl+N",
  MOVE_LEFT: "CommandOrControl+Left",
  MOVE_RIGHT: "CommandOrControl+Right",
  MOVE_DOWN: "CommandOrControl+Down",
  MOVE_UP: "CommandOrControl+Up",
  TOGGLE: "CommandOrControl+B",
  TEACH_EXECUTE: "CommandOrControl+Shift+Return",
  TEACH_ABORT: "CommandOrControl+Shift+Backspace"
} as const
