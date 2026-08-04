import { defineConfig } from "vite"
import path from "node:path"

/**
 * Build for the phone app, separate from the overlay bundle.
 *
 * Two builds rather than two entry points in one: the overlay is styled for a
 * translucent, always-on-top Electron window and expects `window.electronAPI`,
 * none of which exists on a phone. They share only the pure modules under
 * src/lib, which both import directly.
 *
 * The output is used twice — served over HTTP by the laptop for the browser
 * fallback, and bundled into the Capacitor APK — so `base` must be relative:
 * the same files are loaded from a LAN address in one case and from
 * http://localhost inside the app in the other.
 */
export default defineConfig({
  root: path.resolve(__dirname, "remote-app"),
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "dist-remote"),
    emptyOutDir: true,
    // The phone is on Wi-Fi and this is a handful of screens; a smaller
    // download beats readable stack traces here.
    sourcemap: false
  },
  server: {
    // Dev only: lets a phone hit the Vite server directly while iterating.
    host: true
  }
})
