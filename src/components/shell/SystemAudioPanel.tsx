import React, { useEffect, useState } from "react"
import { AlertTriangle, Headphones } from "lucide-react"
import { cn } from "../../lib/utils"
import { createLevelMonitor } from "../../lib/audioLevel"
import {
  getSavedDeviceId,
  isSystemAudioEnabled,
  listAudioInputs,
  openSystemAudio,
  closeSystemAudio,
  pickLoopbackDevice,
  setSavedDeviceId,
  setSystemAudioEnabled
} from "../../lib/systemAudio"
import type { AutopilotConsent } from "../../types/electron"

/** How long the pre-flight listens before deciding the device is silent. */
const TEST_MS = 5000

type TestState =
  | { phase: "idle" }
  | { phase: "listening" }
  | { phase: "done"; heard: boolean }
  | { phase: "error"; message: string }

/**
 * Setup and pre-flight for capturing the other side of a call.
 *
 * The Test button is the point of this panel. An unrouted virtual device fails
 * silently — the clip records, the model answers, and nothing says the
 * interviewer was never in it. Verifying before the call is the only cheap
 * moment to catch that.
 */
const SystemAudioPanel: React.FC = () => {
  const [consent, setConsent] = useState<AutopilotConsent | null>(null)
  const [enabled, setEnabled] = useState(isSystemAudioEnabled)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | null>(getSavedDeviceId)
  const [test, setTest] = useState<TestState>({ phase: "idle" })

  const refresh = async () => {
    try {
      setConsent(await window.electronAPI.systemAudioGetConsent())
    } catch {
      setConsent(null)
    }
    try {
      setDevices(await listAudioInputs())
    } catch {
      setDevices([])
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const runTest = async () => {
    setTest({ phase: "listening" })
    const result = await openSystemAudio(consent?.consented ?? false)
    if (!result.ok) {
      setTest({
        phase: "error",
        message:
          result.reason === "not-configured"
            ? "No loopback device found. Install BlackHole and pick it above."
            : (result.detail ?? "Could not open the device.")
      })
      return
    }
    const monitor = createLevelMonitor(result.stream)
    window.setTimeout(() => {
      const heard = monitor.peak() > 0
      monitor.stop()
      closeSystemAudio(result.stream)
      setTest({ phase: "done", heard })
    }, TEST_MS)
  }

  if (!consent) {
    return (
      <p className="mt-4 text-[11px] glass-muted" role="status">
        Checking system audio status…
      </p>
    )
  }

  // The first consent in this app whose subject is not the person accepting it.
  if (!consent.consented) {
    return (
      <div className="mt-4 space-y-3">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 glass-icon"
            strokeWidth={1.75}
          />
          <p className="text-[11.5px] leading-relaxed glass-text">
            {consent.text}
          </p>
        </div>
        <button
          type="button"
          className="glass-action rounded-lg px-3 py-2 text-[11px]"
          onClick={async () => {
            await window.electronAPI.systemAudioAcknowledgeConsent()
            await refresh()
          }}
        >
          I understand — enable system audio
        </button>
      </div>
    )
  }

  const suggested = pickLoopbackDevice(devices, deviceId)

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] glass-heading">
            {enabled ? "System audio is on" : "System audio is off"}
          </p>
          <p className="text-[11px] glass-muted">
            {enabled
              ? "Recordings capture the call as well as your microphone."
              : "Recordings capture your microphone only."}
          </p>
        </div>
        <button
          type="button"
          aria-pressed={enabled}
          className={cn(
            "rounded-lg px-3 py-2 text-[11px]",
            enabled ? "glass-action" : "glass-muted hover:bg-glass-hover"
          )}
          onClick={() => {
            const next = !enabled
            setEnabled(next)
            setSystemAudioEnabled(next)
          }}
        >
          {enabled ? "Turn off" : "Turn on"}
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] uppercase tracking-wide glass-muted">
          Capture device
        </label>
        <select
          value={suggested?.deviceId ?? ""}
          onChange={(e) => {
            const next = e.target.value || null
            setDeviceId(next)
            setSavedDeviceId(next)
            setTest({ phase: "idle" })
          }}
          className="w-full rounded-lg bg-glass-soft border border-glass px-2 py-1.5 text-[11px] glass-text"
        >
          <option value="">Auto-detect</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Unnamed input"}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={runTest}
          disabled={test.phase === "listening"}
          className="glass-action rounded-lg px-3 py-2 text-[11px] disabled:opacity-50"
        >
          {test.phase === "listening" ? "Listening…" : "Test"}
        </button>
        {test.phase === "listening" && (
          <span className="text-[11px] glass-muted" role="status">
            Play some audio for {TEST_MS / 1000} seconds…
          </span>
        )}
        {test.phase === "done" && (
          <span
            className={cn(
              "text-[11px]",
              test.heard ? "glass-text" : "text-red-300"
            )}
            role="status"
          >
            {test.heard
              ? "Hearing audio."
              : "Silent — set your macOS Output to the Multi-Output device."}
          </span>
        )}
        {test.phase === "error" && (
          <span className="text-[11px] text-red-300" role="status">
            {test.message}
          </span>
        )}
      </div>

      <div className="flex items-start gap-2 border-t border-glass pt-3">
        <Headphones
          className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 glass-icon"
          strokeWidth={1.75}
        />
        <div className="space-y-1 text-[11px] glass-muted leading-relaxed">
          <p>
            Wear headphones. On speakers both voices land in both clips and Quip
            can no longer tell who said what.
          </p>
          <p>
            Setup: install BlackHole, create a Multi-Output Device in Audio MIDI
            Setup containing BlackHole and your headphones, then set macOS
            Output to it. A Multi-Output Device gives up the volume keys.
          </p>
        </div>
      </div>
    </div>
  )
}

export default SystemAudioPanel
