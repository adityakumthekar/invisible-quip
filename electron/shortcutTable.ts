// The accelerators were 11 literal strings inside registerGlobalShortcuts, which
// made collisions invisible. Naming them here lets a test assert uniqueness and
// gives the record binding one place to change if ⌘/ conflicts with an editor.
export const GLOBAL_ACCELERATORS = {
  SHOW: "CommandOrControl+Shift+Space",
  SCREENSHOT: "CommandOrControl+H",
  ASK_AI: "CommandOrControl+Enter",
  // ⌘/ was the first choice, but macOS accepts the registration (isRegistered
  // reports true) and then never delivers the key — punctuation accelerators
  // don't reach Electron's Carbon hotkey here. ⌘⇧M is verified to fire.
  RECORD: "CommandOrControl+Shift+M",
  RESET: "CommandOrControl+R",
  MOVE_LEFT: "CommandOrControl+Left",
  MOVE_RIGHT: "CommandOrControl+Right",
  MOVE_DOWN: "CommandOrControl+Down",
  MOVE_UP: "CommandOrControl+Up",
  TOGGLE: "CommandOrControl+B",
  TEACH_EXECUTE: "CommandOrControl+Shift+Return",
  TEACH_ABORT: "CommandOrControl+Shift+Backspace"
} as const
