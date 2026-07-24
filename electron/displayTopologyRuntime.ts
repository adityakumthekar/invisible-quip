import { screen } from "electron"
import type { Display } from "electron"
import {
  formatDisplayTopology,
  type DisplayDescriptor
} from "./displayTopology"

export function toDisplayDescriptor(display: Display): DisplayDescriptor {
  return {
    id: display.id,
    bounds: { ...display.bounds },
    scaleFactor: display.scaleFactor
  }
}

/**
 * Log the current monitor layout. Called at boot and whenever displays change,
 * so a mis-targeted teaching capture can be traced back to the topology that
 * produced it.
 */
export function refreshDisplayTopology(reason: string): DisplayDescriptor[] {
  const displays = screen.getAllDisplays().map(toDisplayDescriptor)
  console.log(
    `[displays] ${reason} — ${formatDisplayTopology(
      displays,
      screen.getPrimaryDisplay().id
    )}`
  )
  return displays
}

/** Refresh once at boot, then on every display hot-plug / metrics change. */
export function watchDisplayTopology(): void {
  refreshDisplayTopology("boot")
  screen.on("display-added", () => refreshDisplayTopology("display-added"))
  screen.on("display-removed", () => refreshDisplayTopology("display-removed"))
  screen.on("display-metrics-changed", () =>
    refreshDisplayTopology("display-metrics-changed")
  )
}
