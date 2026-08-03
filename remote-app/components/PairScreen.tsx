import React, { useEffect, useState } from "react"
import { getDeviceName, pair, RemoteError } from "../lib/remoteClient"

interface PairScreenProps {
  onPaired: () => void
}

/**
 * Reads a code out of the URL fragment so the QR on the laptop can carry it.
 * The fragment, not the query string: fragments are never sent to a server and
 * don't end up in access logs, which matters for a short-lived secret.
 */
function codeFromLocation(): string {
  const fragment = window.location.hash.replace(/^#/, "")
  const match = /(?:^|&)code=(\d{4,8})(?:&|$)/.exec(fragment)
  return match ? match[1] : ""
}

const PairScreen: React.FC<PairScreenProps> = ({ onPaired }) => {
  const [code, setCode] = useState(codeFromLocation)
  const [name, setName] = useState(getDeviceName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Clear the code out of the address bar once it's in state — it is single-use
  // and short-lived, but leaving it in history is pointless exposure.
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await pair(code, name.trim() || "Phone")
      onPaired()
    } catch (caught) {
      setError(
        caught instanceof RemoteError
          ? caught.message
          : "Couldn't reach the laptop. Check you're on the same Wi-Fi."
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <form className="center card" onSubmit={submit}>
        <h2>Pair with your laptop</h2>
        <p className="notice" style={{ marginBottom: 14 }}>
          On the laptop, open Settings → Remote and generate a pairing code. It
          expires after two minutes and works once.
        </p>

        <label htmlFor="pair-code">Pairing code</label>
        <input
          id="pair-code"
          className="code-input"
          value={code}
          onChange={(event) =>
            setCode(event.target.value.replace(/\D/g, "").slice(0, 8))
          }
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          aria-label="Pairing code"
        />

        <label htmlFor="pair-name" style={{ marginTop: 14 }}>
          Name this device
        </label>
        <input
          id="pair-name"
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 64))}
          placeholder="Phone"
          aria-label="Device name"
        />

        {error && (
          <p className="error" style={{ marginTop: 14 }} role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="primary"
          style={{ width: "100%", marginTop: 16 }}
          disabled={busy || code.length < 4}
        >
          {busy ? "Pairing…" : "Pair"}
        </button>
      </form>
    </div>
  )
}

export default PairScreen
