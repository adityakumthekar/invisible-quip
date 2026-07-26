// Pure display-topology helpers. Deliberately free of `electron` imports so the
// matching logic stays unit-testable; the runtime wiring lives in
// displayTopologyRuntime.ts.

export interface DisplayDescriptor {
  id: number
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
}

/** The subset of a desktopCapturer source we can reason about. */
export interface CaptureSourceDescriptor {
  id: string
  name: string
  display_id: string
  /** Actual thumbnail pixel size, not the size we asked for. */
  width: number
  height: number
}

export type CaptureSourceMatchKind = "display-id" | "aspect" | "fallback"

export interface CaptureSourceMatch<S extends CaptureSourceDescriptor> {
  source: S
  /** The display the chosen pixels actually belong to. */
  display: DisplayDescriptor
  matchedBy: CaptureSourceMatchKind
  warnings: string[]
}

/** Aspect ratios this close are considered the same screen shape. */
const ASPECT_TOLERANCE = 0.02

export function formatDisplayTopology(
  displays: DisplayDescriptor[],
  primaryId?: number
): string {
  const entries = displays.map((display) => {
    const { x, y, width, height } = display.bounds
    const primary = display.id === primaryId ? " (primary)" : ""
    return `#${display.id} ${width}x${height} @${x},${y} x${display.scaleFactor}${primary}`
  })
  return `${displays.length} display(s): ${entries.join(" | ")}`
}

function aspectOf(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return Number.NaN
  }
  return width / height
}

function aspectClose(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs(a - b) / Math.max(a, b) <= ASPECT_TOLERANCE
}

function displayAspect(display: DisplayDescriptor): number {
  return aspectOf(display.bounds.width, display.bounds.height)
}

/**
 * Pick the capture source that belongs to `activeDisplay`, and report which
 * display the chosen pixels actually came from.
 *
 * macOS routinely reports an empty `display_id`, so we fall back to screen
 * shape: `desktopCapturer` fits each thumbnail inside the requested box while
 * preserving aspect, which makes the returned aspect ratio a reliable stand-in
 * for `bounds * scaleFactor`. Only when that fails do we take the first source
 * — and then we re-tag the capture with whichever display explains those
 * pixels, so teaching never maps Display A pixels through Display B bounds.
 */
export function matchCaptureSource<S extends CaptureSourceDescriptor>(
  sources: S[],
  activeDisplay: DisplayDescriptor,
  allDisplays: DisplayDescriptor[]
): CaptureSourceMatch<S> {
  if (sources.length === 0) {
    throw new Error("No screen capture sources are available")
  }

  const byId = sources.find(
    (source) => source.display_id === String(activeDisplay.id)
  )
  if (byId) {
    return {
      source: byId,
      display: activeDisplay,
      matchedBy: "display-id",
      warnings: []
    }
  }

  // Sources that name a *different* display are definitively not ours.
  const claimedByOthers = new Set(
    allDisplays
      .filter((display) => display.id !== activeDisplay.id)
      .map((display) => String(display.id))
  )
  const unclaimed = sources.filter(
    (source) => !source.display_id || !claimedByOthers.has(source.display_id)
  )
  const pool = unclaimed.length > 0 ? unclaimed : sources

  const targetAspect = displayAspect(activeDisplay)
  const sameShape = pool.filter((source) =>
    aspectClose(aspectOf(source.width, source.height), targetAspect)
  )

  if (sameShape.length > 0) {
    // Source order tracks display order on macOS — the only tiebreak left when
    // two monitors share a shape.
    const orderIndex = allDisplays.findIndex(
      (display) => display.id === activeDisplay.id
    )
    const ordered = orderIndex >= 0 ? sources[orderIndex] : undefined
    const source =
      ordered && sameShape.includes(ordered) ? ordered : sameShape[0]
    const warnings =
      sameShape.length > 1
        ? [
            `${sameShape.length} sources share display ${activeDisplay.id}'s aspect ratio; matched by display order`
          ]
        : []
    return { source, display: activeDisplay, matchedBy: "aspect", warnings }
  }

  const source = pool[0]
  const warnings = [
    `no capture source matched display ${activeDisplay.id}; falling back to "${source.name}"`
  ]
  const explains = allDisplays.find((display) =>
    aspectClose(displayAspect(display), aspectOf(source.width, source.height))
  )
  if (explains && explains.id !== activeDisplay.id) {
    warnings.push(
      `capture pixels match display ${explains.id}; tagging the capture with it instead of ${activeDisplay.id}`
    )
    return { source, display: explains, matchedBy: "fallback", warnings }
  }

  return { source, display: activeDisplay, matchedBy: "fallback", warnings }
}
