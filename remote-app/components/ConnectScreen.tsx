import React, { useState } from "react"
import { DEFAULT_REMOTE_PORT, setBaseUrl } from "../lib/config"

interface ConnectScreenProps {
  onConnected: () => void
}

/**
 * Asks where the laptop is.
 *
 * Only the installed app sees this — the browser build was served by the
 * laptop and already knows. It exists because baking an address into the APK
 * makes the APK disposable the first time the router hands out a different
 * lease; the address shown in Settings → Remote is the one to type here.
 */
const ConnectScreen: React.FC<ConnectScreenProps> = ({ onConnected }) => {
  const [address, setAddress] = useState("")
  const [error, setError] = useState<string | null>(null)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!setBaseUrl(address)) {
      setError("That doesn't look like an address. Try 192.168.1.5")
      return
    }
    onConnected()
  }

  return (
    <form className="panel" onSubmit={submit}>
      <div className="card">
        <h2>Find the laptop</h2>
        <p className="muted">
          Open <strong>Settings → Remote</strong> on the laptop and type the
          address it shows. Both devices must be on the same Wi-Fi.
        </p>

        <label htmlFor="laptop-address">Laptop address</label>
        <input
          id="laptop-address"
          value={address}
          onChange={(event) => {
            setAddress(event.target.value)
            setError(null)
          }}
          placeholder={`192.168.1.5:${DEFAULT_REMOTE_PORT}`}
          inputMode="url"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <p className="muted small">
          The port is {DEFAULT_REMOTE_PORT} unless you changed it.
        </p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" style={{ width: "100%", marginTop: 12 }}>
          Continue
        </button>
      </div>
    </form>
  )
}

export default ConnectScreen
