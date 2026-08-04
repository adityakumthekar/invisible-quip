import type { CapacitorConfig } from "@capacitor/cli"

/**
 * The Android shell around the remote client.
 *
 * This exists so the phone app is a real installed app rather than a browser
 * tab: its own icon, its own task-switcher entry, real fullscreen, and — the
 * reason it was worth doing — no dependence on Chrome treating a LAN address as
 * a secure context, which it will not. A PWA install would have needed HTTPS,
 * which on a LAN means a self-signed certificate and a manual CA install on the
 * phone. An APK simply is installable.
 */
const config: CapacitorConfig = {
  appId: "com.electron.quip.remote",
  appName: "Quip Remote",
  // Built by `npm run build:remote`, from vite.config.remote.ts. The same
  // output is also served over HTTP by the laptop for the browser fallback,
  // which is why that build uses a relative base.
  webDir: "dist-remote",
  android: {
    // The laptop speaks plain HTTP on the LAN. Without this the webview blocks
    // every request to it as cleartext.
    allowMixedContent: true
  },
  server: {
    /**
     * The app's own origin. Capacitor defaults to `https://localhost`, which
     * would make every request to `http://192.168.x.x:41777` mixed content and
     * therefore blocked. Serving the bundle over `http://localhost` keeps the
     * app and the laptop on the same scheme.
     *
     * This weakens nothing that was otherwise available: the traffic is plain
     * HTTP on a local network either way, which is exactly what the remote
     * consent text tells the user.
     */
    androidScheme: "http"
  },
  plugins: {
    /**
     * Route `window.fetch` through native code.
     *
     * Two things fall out of this. Requests are not subject to CORS, so the
     * server can keep sending no CORS headers at all — the property that stops
     * a malicious page reading a response. And they carry no `Origin` header,
     * which `isSameOrigin` already accepts as the signature of a non-browser
     * client. The command path therefore needed no server change.
     *
     * It does not apply to `EventSource` or `<img>`, which the browser opens
     * itself — hence the stream tickets. See electron/remoteTickets.ts.
     */
    CapacitorHttp: {
      enabled: true
    }
  }
}

export default config
