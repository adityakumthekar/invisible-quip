// Shared, Electron-agnostic types and constants for the Teach Me privacy
// gate (one-time acknowledgement + per-process self-capture preflight).
// Consumed by both the main process and the renderer (via src/lib re-exports).

export const PRIVACY_ACKNOWLEDGEMENT_VERSION = 1

/**
 * Exact, required copy for the one-time Teach Me acknowledgement. Do not
 * reword: it must not claim universal invisibility, and must direct the
 * user to verify their own share preview.
 */
export const PRIVACY_ACKNOWLEDGEMENT_TEXT =
  "Quip uses capture protection and is normally hidden from Zoom/Meet/Teams-style sharing, but exclusion is best-effort and the user must verify the share preview."

export const AUTOPILOT_CONSENT_VERSION = 1

/**
 * Separate, one-time consent for unattended control. Screenshotting the screen
 * and driving the mouse and keyboard on it are materially different asks, so
 * acknowledging the first does not imply the second.
 */
export const AUTOPILOT_CONSENT_TEXT =
  "In autopilot, Quip clicks, types, and scrolls on your real screen by itself. It pauses for your approval before actions that are hard to undo, but its view of the screen can be wrong. Stay at the machine and press Cmd/Ctrl+Shift+Backspace to stop it at any time."

export const REMOTE_CONTROL_CONSENT_VERSION = 1

/**
 * A third consent, because remote control breaks the assumption the autopilot
 * consent above is built on. That text says "stay at the machine" — the whole
 * point of this feature is that you are not at it, so the keyboard kill switch
 * it names is out of reach. Accepting autopilot must not silently accept that.
 *
 * The copy has to say four things plainly: nobody is watching the screen, the
 * desktop kill switch does not apply, Stop moves to the phone, and a paired
 * phone is a key to this machine.
 */
export const REMOTE_CONTROL_CONSENT_TEXT =
  "Remote control lets a paired phone run autopilot on this machine while you are not in front of it. Quip will click and type on your real screen with nobody watching, and the Cmd/Ctrl+Shift+Backspace kill switch on this keyboard will be out of reach — Stop lives on the phone instead. A paired phone is a key to this machine: pair only your own device, and revoke it if you lose it. Traffic stays on your local network but is not encrypted, so enable this only on networks you trust."

export const REMOTE_INPUT_CONSENT_VERSION = 1

/**
 * A fourth consent, for the phone driving the mouse and keyboard directly.
 *
 * The three above all describe Quip acting through a model that has its own
 * judgement about what it is doing: autopilot classifies each step's risk and
 * stops to ask before anything hard to undo. Direct input has none of that. The
 * phone is the hand, so the ceiling on what a stolen token can do stops being
 * "whatever autopilot would agree to" and becomes "anything you could do sitting
 * here". Accepting remote autopilot must not silently accept that.
 *
 * The copy has to say four things plainly: the phone acts as your own hands,
 * autopilot's confirmations do not apply, it reaches everything you are signed
 * in to, and how to take it back.
 */
export const REMOTE_INPUT_CONSENT_TEXT =
  "Screen control lets a paired phone click, type, drag, and scroll anywhere on this screen, exactly as if it were your own hands. Autopilot's risk checks and confirmation prompts do not apply — nothing pauses to ask. Whoever holds the phone can read anything on screen, open any app, and act inside every account you are signed in to on this machine. Turn off Allow phone input, revoke the device, or press Cmd/Ctrl+Shift+Backspace at this keyboard to cut it off at once. Traffic stays on your local network but is not encrypted, so enable this only on networks you trust."

export const SYSTEM_AUDIO_CONSENT_VERSION = 1

/**
 * A fifth consent, and the first whose subject is not the person accepting it.
 *
 * The four above are all risks the user takes on themselves: their screen may
 * turn up in a share, their machine may be driven while they are away, their
 * phone is a key to it. Capturing system audio records the other people on the
 * call — someone who is not here, cannot be asked, and in much of the world has
 * to agree before a conversation is recorded at all. The microphone capture
 * this grows out of is premised on "your own voice", which is exactly the part
 * that stops being true. The exposure is legal, not technical, so no amount of
 * capture protection covers it.
 *
 * The copy has to say five things plainly: it records them and not only you,
 * their voice leaves this machine, recording a conversation often needs
 * everyone's agreement, getting that agreement is the user's job and not
 * Quip's, and how to turn it off.
 */
export const SYSTEM_AUDIO_CONSENT_TEXT =
  "Capturing system audio records the other people on your call, not only you. Their words leave this machine and go to your AI provider alongside your own, under that provider's retention. Many places — several US states and most of Europe among them — require every person in a conversation to agree before it is recorded, and Quip cannot ask them for you: getting that agreement, or deciding not to record, is yours to do. Nothing about this is visible on their end. Turn off System audio in Settings to go back to capturing only your own microphone."

export interface PrivacyAcknowledgementRecord {
  version: number
  acknowledgedAt: string
}

export type PrivacyPreflightStatus = "pass" | "fail" | "error"

export interface PrivacyPreflightResult {
  status: PrivacyPreflightStatus
  reason: string
  remediation?: string
  debugMode: boolean
}

export interface PrivacyGateStatus {
  acknowledged: boolean
  acknowledgementText: string
  acknowledgementVersion: number
  preflightPassed: boolean
  lastPreflightResult: PrivacyPreflightResult | null
}

export type PrivacyGateBlockReason = "acknowledgement" | "preflight"

export interface PrivacyGateDecision {
  canStart: boolean
  blockingReason?: PrivacyGateBlockReason
}
