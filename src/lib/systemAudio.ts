// The other half of a two-speaker clip: the interviewer's voice, taken from
// this machine's audio output rather than the microphone.
//
// macOS has no first-party way to do this from Electron 33 — `Streams.audio`
// loopback in setDisplayMediaRequestHandler is Windows-only at this version, and
// on macOS it would ride the display-capture TCC grant (fragile under an ad-hoc
// signature) and light the screen-capture indicator for the whole call. So the
// route is a virtual output device the user installs once: BlackHole, feeding a
// Multi-Output Device so they still hear the call.
//
// EVERYTHING device-shaped lives behind openSystemAudio(). Swapping to loopback
// later is a rewrite of that one function body plus a handler in main.ts — no
// call site changes.

const ENABLED_KEY = "quipSystemAudioEnabled"
const DEVICE_KEY = "quipSystemAudioDeviceId"

/**
 * Virtual devices this can capture from. Matching on the label is unlovely, but
 * a loopback device is not otherwise distinguishable from a microphone through
 * the Web Audio API — there is no "is virtual" bit.
 */
const LOOPBACK_LABEL = /blackhole|loopback|soundflower|vb-?cable|multi-output|aggregate/i

export type SystemAudioResult =
  | { ok: true; stream: MediaStream; deviceLabel: string }
  | {
      ok: false
      reason: "off" | "no-consent" | "not-configured" | "error"
      detail?: string
    }

export function isSystemAudioEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "true"
}

export function setSystemAudioEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, String(enabled))
}

export function getSavedDeviceId(): string | null {
  return localStorage.getItem(DEVICE_KEY)
}

export function setSavedDeviceId(deviceId: string | null): void {
  if (deviceId) localStorage.setItem(DEVICE_KEY, deviceId)
  else localStorage.removeItem(DEVICE_KEY)
}

/**
 * The user's chosen device if it is still present, else the first thing that
 * looks like a loopback. Pure so the matching can be tested without a machine
 * that has BlackHole on it.
 */
export function pickLoopbackDevice(
  devices: MediaDeviceInfo[],
  savedDeviceId: string | null
): MediaDeviceInfo | null {
  const inputs = devices.filter((d) => d.kind === "audioinput")
  if (savedDeviceId) {
    const saved = inputs.find((d) => d.deviceId === savedDeviceId)
    if (saved) return saved
  }
  return inputs.find((d) => LOOPBACK_LABEL.test(d.label)) ?? null
}

/** Every audio input, for the settings picker. Labels need a live grant first. */
export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === "audioinput")
}

/**
 * Open the interviewer-side stream. Callers get a result union rather than an
 * exception: failing to capture system audio must degrade to a mic-only clip,
 * never block the recording the user just started.
 *
 * Note the constraint set — a virtual device must not be processed. Echo
 * cancellation and noise suppression are tuned for a room and mangle speech
 * arriving as a clean digital signal. The mic stream keeps its defaults, which
 * is what limits bleed when the user is on speakers instead of headphones.
 */
export async function openSystemAudio(
  hasConsent: boolean
): Promise<SystemAudioResult> {
  if (!isSystemAudioEnabled()) return { ok: false, reason: "off" }
  if (!hasConsent) return { ok: false, reason: "no-consent" }

  try {
    const device = pickLoopbackDevice(
      await navigator.mediaDevices.enumerateDevices(),
      getSavedDeviceId()
    )
    if (!device) return { ok: false, reason: "not-configured" }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: device.deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      }
    })
    return { ok: true, stream, deviceLabel: device.label }
  } catch (error) {
    return {
      ok: false,
      reason: "error",
      detail: error instanceof Error ? error.message : String(error)
    }
  }
}

export function closeSystemAudio(stream: MediaStream): void {
  stream.getTracks().forEach((t) => t.stop())
}
