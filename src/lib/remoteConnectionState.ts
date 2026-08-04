// Folding a live remote-state push back into the Settings → Remote snapshot.
//
// The panel loads its state in one round trip (`remoteGetState`) and then sits
// there. Meanwhile main can revoke phone input on its own — the kill switch,
// Cmd/Ctrl+Shift+Backspace, drops it without anyone touching the panel — and
// announces that on the `remote-connections-changed` channel.
//
// Pulled out of RemotePanel for the same reason as pairingCountdown: the failure
// mode is not cosmetic. A panel that keeps rendering "your phone can tap and
// type here" over a laptop that is refusing every tap sends the user looking for
// a bug in the phone, and its button then reads "Turn off" — so the obvious
// remedy is a no-op and recovery takes two clicks.

import type { RemoteConnectionState, RemoteState } from "../types/electron"

/**
 * Merge a pushed connection event into the panel's snapshot.
 *
 * Returns a new object; React state must not be mutated in place or `setState`
 * compares a snapshot against itself and skips the re-render this exists for.
 * Null in, null out — an event that arrives before the first load has nothing to
 * merge into, and two fields are not a snapshot.
 */
export function applyRemoteConnectionEvent(
  state: RemoteState | null,
  event: RemoteConnectionState
): RemoteState | null {
  if (!state) {
    return null
  }

  return {
    ...state,
    server: { ...state.server, connectedDevices: event.count },
    inputConsent: {
      ...state.inputConsent,
      // `event.inputEnabled` is main's `consented && allowed`. Where the panel
      // renders this field at all it has already established `consented`, so the
      // two agree — and `consented` itself is deliberately left alone: it is
      // owned by the acknowledgement store, and letting a kill switch retract it
      // would make the panel demand a notice the user really did read.
      allowed: event.inputEnabled
    }
  }
}
