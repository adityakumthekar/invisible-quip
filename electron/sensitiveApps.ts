// sensitiveApps.ts
//
// Which applications autopilot is never allowed to touch unattended. Pure data
// plus a matcher — no Electron, no I/O — so the list can't drift out of reach of
// the tests, and so autopilotPolicy.ts stays about *rules* while this file is
// about *which apps*.
//
// Deliberately biased toward over-matching, same as DANGER_LEXICON: a false
// positive costs one keypress, a false negative costs a message sent to your
// whole team or a command run in a shell.

import type { FrontmostApp } from "./frontmostApp"

export type SensitiveCategory = "system" | "terminal" | "messaging"

/**
 * How hard the gate is for a category.
 *
 * "always" — every step needs a human. One Return in a shell runs a command and
 * one click in System Settings changes something global, so there is no such
 * thing as a harmless action here.
 *
 * "transmit" — only actions that can send or commit something need a human.
 * Reading a Slack thread is harmless; pressing Return in its compose box is not.
 */
export type AppGate = "always" | "transmit"

export function gateForCategory(category: SensitiveCategory): AppGate {
  return category === "messaging" ? "transmit" : "always"
}

/** Exact bundle identifiers, lower-cased at match time. */
export const SENSITIVE_BUNDLE_IDS: Readonly<Record<string, SensitiveCategory>> = {
  // System / credentials — changes here are global and often irreversible.
  "com.apple.systempreferences": "system",
  "com.apple.keychainaccess": "system",
  "com.apple.finder": "system",
  "com.apple.installer": "system",
  "com.apple.diskutility": "system",
  "com.1password.1password": "system",
  "com.1password.7": "system",
  "com.agilebits.onepassword7": "system",
  "com.agilebits.onepassword-osx": "system",

  // Terminals and editors with embedded terminals — one Return runs a command.
  "com.apple.terminal": "terminal",
  "com.googlecode.iterm2": "terminal",
  "dev.warp.warp-stable": "terminal",
  "com.mitchellh.ghostty": "terminal",
  "net.kovidgoyal.kitty": "terminal",
  "io.alacritty": "terminal",
  "co.zeit.hyper": "terminal",
  "com.microsoft.vscode": "terminal",
  "com.microsoft.vscodeinsiders": "terminal",
  "com.todesktop.230313mzl4w4u92": "terminal", // Cursor
  "com.apple.dt.xcode": "terminal",

  // Messaging — anything sent here reaches another human immediately.
  "net.whatsapp.whatsapp": "messaging",
  "desktop.whatsapp": "messaging",
  "com.tinyspeck.slackmacgap": "messaging",
  "com.apple.mobilesms": "messaging",
  "ru.keepcoder.telegram": "messaging",
  "org.telegram.desktop": "messaging",
  "org.whispersystems.signal-desktop": "messaging",
  "com.hnc.discord": "messaging",
  "com.microsoft.teams": "messaging",
  "com.microsoft.teams2": "messaging",
  "us.zoom.xos": "messaging",
  "com.apple.mail": "messaging",
  "com.readdle.smartemail-mac": "messaging",
  "com.superhuman.electron": "messaging"
}

/**
 * Name fallback, so an unlisted build — a Slack beta, a terminal released after
 * this list was written — still trips the rule. Word-boundary matched against
 * the app's display name.
 */
const SENSITIVE_NAME_PATTERNS: readonly { pattern: RegExp; category: SensitiveCategory }[] = [
  { pattern: /\bsystem (settings|preferences)\b/, category: "system" },
  { pattern: /\bkeychain\b/, category: "system" },
  { pattern: /\b1password\b/, category: "system" },
  { pattern: /\bbitwarden\b/, category: "system" },
  { pattern: /\blastpass\b/, category: "system" },
  { pattern: /\bterminal\b/, category: "terminal" },
  { pattern: /\biterm\b/, category: "terminal" },
  { pattern: /\bghostty\b/, category: "terminal" },
  { pattern: /\balacritty\b/, category: "terminal" },
  { pattern: /\bwarp\b/, category: "terminal" },
  { pattern: /\bconsole\b/, category: "terminal" },
  { pattern: /\bwhatsapp\b/, category: "messaging" },
  { pattern: /\bslack\b/, category: "messaging" },
  { pattern: /\bmessages\b/, category: "messaging" },
  { pattern: /\btelegram\b/, category: "messaging" },
  { pattern: /\bsignal\b/, category: "messaging" },
  { pattern: /\bdiscord\b/, category: "messaging" },
  { pattern: /\bteams\b/, category: "messaging" },
  { pattern: /\bmail\b/, category: "messaging" },
  { pattern: /\bmessenger\b/, category: "messaging" }
]

/** Our own app, which is frontmost whenever the Quip panel has focus. */
export const QUIP_BUNDLE_ID = "com.electron.quip"

export function describeSensitiveCategory(category: SensitiveCategory): string {
  switch (category) {
    case "system":
      return "System and password apps"
    case "terminal":
      return "Terminals and code editors"
    case "messaging":
      return "Messaging and email apps"
  }
}

/**
 * The category an app falls into, or null when autopilot may act unattended.
 * A null `app` means "we don't know" — that is the probe's problem to report,
 * not a sensitivity verdict, so it returns null here too.
 */
export function classifyAppSensitivity(
  app: FrontmostApp | null | undefined
): SensitiveCategory | null {
  if (!app) {
    return null
  }

  const bundleId = app.bundleId?.trim().toLowerCase() ?? ""
  if (bundleId === QUIP_BUNDLE_ID) {
    return null
  }

  const byBundle = SENSITIVE_BUNDLE_IDS[bundleId]
  if (byBundle) {
    return byBundle
  }

  const name = app.name?.trim().toLowerCase() ?? ""
  if (!name) {
    return null
  }

  for (const { pattern, category } of SENSITIVE_NAME_PATTERNS) {
    if (pattern.test(name)) {
      return category
    }
  }

  return null
}
