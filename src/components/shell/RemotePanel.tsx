import React, { useCallback, useEffect, useReducer, useState } from "react"
import QRCode from "qrcode"
import { AlertTriangle, Smartphone, Trash2 } from "lucide-react"
import type { RemoteState } from "../../types/electron"
import { isPairingCodeExpired, remainingSeconds } from "../../lib/pairingCountdown"
import { applyRemoteConnectionEvent } from "../../lib/remoteConnectionState"

/**
 * Settings → Remote. Owns three things the user must be able to see at a
 * glance, because this is the switch that makes the machine reachable from the
 * network: whether the server is on, which devices hold a key to it, and how
 * to revoke one.
 */

/**
 * Codes are short-lived; show the countdown so a stale one is obvious.
 *
 * The remaining time is derived from the clock during render rather than kept
 * in state. A stored copy only updates inside an effect, so it lags the render
 * in which `expiresAt` first arrives — and since the panel drops the pairing
 * code the moment it looks expired, that one-render lag made a code vanish
 * immediately after being generated. The interval only forces a re-render.
 */
function useCountdown(expiresAt: number | null): number {
  const [, tick] = useReducer((count: number) => count + 1, 0)

  useEffect(() => {
    if (!expiresAt) {
      return
    }
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  return remainingSeconds(expiresAt, Date.now())
}

const RemotePanel: React.FC = () => {
  const [state, setState] = useState<RemoteState | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  // Derived, not stored. A second copy of the connection count is what let the
  // panel drift out of step with the laptop in the first place.
  const connections = state?.server.connectedDevices ?? 0

  const pairingExpiry = state?.pairingCode?.expiresAt ?? null
  const secondsLeft = useCountdown(pairingExpiry)

  const refresh = useCallback(async () => {
    try {
      setState(await window.electronAPI.remoteGetState())
    } catch (caught: any) {
      setError(caught?.message ?? String(caught))
    }
  }, [])

  // The push carries the live input toggle as well as the device count, and both
  // have to land: main revokes phone input on its own — the kill switch does it
  // without touching this panel — and a snapshot that keeps claiming input is on
  // describes a laptop that is refusing every tap.
  useEffect(() => {
    void refresh()
    return window.electronAPI.onRemoteConnectionsChanged((event) =>
      setState((current) => applyRemoteConnectionEvent(current, event))
    )
  }, [refresh])

  // Once the code lapses, drop it from the UI rather than showing something
  // that will be refused. Compared against the clock, not against secondsLeft
  // reaching zero — see isPairingCodeExpired for why those are not the same.
  const expired = isPairingCodeExpired(pairingExpiry, Date.now())
  useEffect(() => {
    if (expired) {
      setQr(null)
      setState((current) => (current ? { ...current, pairingCode: null } : current))
    }
  }, [expired])

  const guard = async (action: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await action()
    } catch (caught: any) {
      setError(caught?.message ?? String(caught))
    } finally {
      setBusy(false)
    }
  }

  const toggleServer = () =>
    guard(async () => {
      if (state?.server.running) {
        await window.electronAPI.remoteStopServer()
        setQr(null)
      } else {
        const result = await window.electronAPI.remoteStartServer()
        if (!result.success) {
          throw new Error(result.error ?? "Couldn't start the remote server.")
        }
      }
      await refresh()
    })

  const generateCode = () =>
    guard(async () => {
      const { code, url } = await window.electronAPI.remoteIssuePairingCode()
      // The code rides in the URL fragment, which browsers never send to a
      // server — so scanning it doesn't write the secret into any access log.
      setQr(
        url
          ? await QRCode.toDataURL(`${url}/#code=${code}`, {
              margin: 1,
              width: 320
            })
          : null
      )
      await refresh()
    })

  const revoke = (deviceId: string) =>
    guard(async () => {
      await window.electronAPI.remoteRevokeDevice(deviceId)
      await refresh()
    })

  if (!state) {
    return (
      <p className="mt-4 text-[11px] glass-muted" role="status">
        Checking remote status…
      </p>
    )
  }

  // One-time consent, separate from the autopilot notice: that one tells the
  // user to stay at the machine, which is the opposite of what this enables.
  if (!state.consent.consented) {
    return (
      <div className="mt-4 space-y-3">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 glass-icon"
            strokeWidth={1.75}
          />
          <p className="text-[11.5px] leading-relaxed glass-text">
            {state.consent.text}
          </p>
        </div>
        <button
          type="button"
          className="glass-action rounded-lg px-3 py-2 text-[11px]"
          onClick={() =>
            guard(async () => {
              await window.electronAPI.remoteAcknowledgeConsent()
              await refresh()
            })
          }
        >
          I understand — enable remote control
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] glass-heading">
            {state.server.running ? "Remote access is on" : "Remote access is off"}
          </p>
          <p className="text-[11px] glass-muted">
            {state.server.running
              ? connections > 0
                ? `${connections} device${connections === 1 ? "" : "s"} connected`
                : "Waiting for a phone to connect"
              : "Your laptop is not reachable from the network."}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={toggleServer}
          className="glass-action rounded-lg px-3 py-2 text-[11px] disabled:opacity-40"
        >
          {state.server.running ? "Turn off" : "Turn on"}
        </button>
      </div>

      {state.server.running && (
        <div className="space-y-3">
          {/* Two states, two instructions. Referring to "the code below" before
              one has been generated reads as a bug in the panel. */}
          <p className="text-[11px] glass-muted">
            {state.pairingCode ? (
              <>
                Scan the code below, or open{" "}
                <span className="glass-text">{state.server.url ?? "—"}</span> on
                your phone and enter the digits.
              </>
            ) : (
              <>
                Generate a pairing code to connect a phone. It will appear here
                as a QR code and as digits you can type at{" "}
                <span className="glass-text">{state.server.url ?? "—"}</span>.
              </>
            )}
          </p>

          <button
            type="button"
            disabled={busy}
            onClick={generateCode}
            className="glass-action rounded-lg px-3 py-2 text-[11px] disabled:opacity-40"
          >
            {state.pairingCode ? "New pairing code" : "Generate pairing code"}
          </button>

          {state.pairingCode && (
            <div className="rounded-lg bg-glass-soft px-3 py-3 space-y-2">
              <p className="text-[22px] tracking-[0.3em] tabular-nums glass-heading">
                {state.pairingCode.code}
              </p>
              <p className="text-[11px] glass-muted">
                Expires in {secondsLeft}s · works once
              </p>
              {qr && (
                <img
                  src={qr}
                  alt="Pairing QR code"
                  className="w-40 h-40 rounded bg-white p-1"
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Screen control is a second, larger grant than remote autopilot, so it
          gets its own notice and its own switch rather than riding along on the
          one above. See REMOTE_INPUT_CONSENT_TEXT. */}
      <div className="space-y-2 rounded-lg bg-glass-soft px-3 py-3">
        <p className="text-[11px] uppercase tracking-wide glass-muted">
          Screen control
        </p>

        {!state.inputConsent.consented ? (
          <>
            <p className="text-[11px] glass-muted leading-relaxed">
              {state.inputConsent.text}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                guard(async () => {
                  await window.electronAPI.remoteAcknowledgeInputConsent()
                  await refresh()
                })
              }
              className="glass-action rounded-lg px-3 py-2 text-[11px] disabled:opacity-40"
            >
              I understand — let my phone control this screen
            </button>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12.5px] glass-heading">
                {state.inputConsent.allowed
                  ? "Your phone can tap and type here"
                  : "Phone input is off"}
              </p>
              <p className="text-[11px] glass-muted">
                {state.inputConsent.allowed
                  ? "Press Cmd/Ctrl+Shift+Backspace to cut it off instantly."
                  : "Watching still works. Turn this on to take control again."}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                guard(async () => {
                  await window.electronAPI.remoteSetInputAllowed(
                    !state.inputConsent.allowed
                  )
                  await refresh()
                })
              }
              className="glass-action rounded-lg px-3 py-2 text-[11px] disabled:opacity-40"
            >
              {state.inputConsent.allowed ? "Turn off" : "Turn on"}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide glass-muted">
          Paired devices
        </p>
        {state.devices.length === 0 ? (
          <p className="text-[11px] glass-muted">No devices paired.</p>
        ) : (
          <ul className="space-y-1.5">
            {state.devices.map((device) => (
              <li
                key={device.id}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Smartphone
                    className="w-3.5 h-3.5 flex-shrink-0 glass-icon"
                    strokeWidth={1.75}
                  />
                  <span className="min-w-0">
                    <span className="block text-[12px] glass-text truncate">
                      {device.name}
                    </span>
                    <span className="block text-[10.5px] glass-muted">
                      {device.lastSeenAt
                        ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}`
                        : "Never connected"}
                    </span>
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => revoke(device.id)}
                  aria-label={`Revoke ${device.name}`}
                  className="glass-control flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] glass-text disabled:opacity-40"
                >
                  <Trash2 className="w-3 h-3" strokeWidth={1.75} />
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Stated plainly rather than buried: the traffic is not encrypted, and
          the mitigation is entirely the user's choice of network. */}
      <p className="text-[10.5px] leading-relaxed glass-muted">
        Traffic stays on your local network but is not encrypted. Use this on
        networks you trust, and revoke a device you no longer have.
      </p>

      {error && (
        <p className="text-[11.5px] glass-text" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export default RemotePanel
