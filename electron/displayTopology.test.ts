import { describe, expect, it } from "vitest"
import {
  formatDisplayTopology,
  matchCaptureSource,
  type CaptureSourceDescriptor,
  type DisplayDescriptor
} from "./displayTopology"

const laptop: DisplayDescriptor = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  scaleFactor: 2
}
const external: DisplayDescriptor = {
  id: 2,
  bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1
}

function source(
  overrides: Partial<CaptureSourceDescriptor> & { id: string }
): CaptureSourceDescriptor {
  return {
    name: `Screen ${overrides.id}`,
    display_id: "",
    width: 100,
    height: 100,
    ...overrides
  }
}

describe("formatDisplayTopology", () => {
  it("lists every display with bounds, scale, and the primary marker", () => {
    const summary = formatDisplayTopology([laptop, external], laptop.id)

    expect(summary).toContain("2 display(s)")
    expect(summary).toContain("#1 1512x982 @0,0 x2 (primary)")
    expect(summary).toContain("#2 1920x1080 @1512,0 x1")
    expect(summary).not.toContain("#2 1920x1080 @1512,0 x1 (primary)")
  })
})

describe("matchCaptureSource", () => {
  it("prefers an exact display_id match", () => {
    const wrong = source({ id: "a", display_id: "2", width: 1920, height: 1080 })
    const right = source({ id: "b", display_id: "1", width: 3024, height: 1964 })

    const match = matchCaptureSource([wrong, right], laptop, [laptop, external])

    expect(match.source).toBe(right)
    expect(match.display).toBe(laptop)
    expect(match.matchedBy).toBe("display-id")
    expect(match.warnings).toEqual([])
  })

  it("matches by aspect ratio when display_id is empty (macOS)", () => {
    const externalSource = source({ id: "a", width: 1512, height: 850 })
    const laptopSource = source({ id: "b", width: 3024, height: 1964 })

    const match = matchCaptureSource(
      [externalSource, laptopSource],
      laptop,
      [laptop, external]
    )

    expect(match.source).toBe(laptopSource)
    expect(match.display).toBe(laptop)
    expect(match.matchedBy).toBe("aspect")
  })

  it("does not pick a source that another display already claims", () => {
    // Both screens are 16:9 here, so aspect cannot discriminate — but the first
    // source names the other display, which rules it out.
    const sixteenByNine: DisplayDescriptor = {
      id: 3,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1
    }
    const claimed = source({
      id: "a",
      display_id: "2",
      width: 1920,
      height: 1080
    })
    const ours = source({ id: "b", width: 1920, height: 1080 })

    const match = matchCaptureSource([claimed, ours], sixteenByNine, [
      sixteenByNine,
      external
    ])

    expect(match.source).toBe(ours)
    expect(match.display).toBe(sixteenByNine)
  })

  it("falls back to display order when several sources share an aspect ratio", () => {
    const twin: DisplayDescriptor = {
      id: 3,
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1
    }
    const first = source({ id: "a", width: 1920, height: 1080 })
    const second = source({ id: "b", width: 1920, height: 1080 })

    const match = matchCaptureSource([first, second], twin, [external, twin])

    expect(match.source).toBe(second)
    expect(match.matchedBy).toBe("aspect")
    expect(match.warnings.join(" ")).toContain("display order")
  })

  it("re-tags the capture with the display the fallback pixels belong to", () => {
    // Nothing matches the laptop's 1512x982 aspect, so the capture is really of
    // the external display — tagging it as the laptop would map DIPs onto the
    // wrong monitor.
    const only = source({ id: "a", width: 1920, height: 1080 })

    const match = matchCaptureSource([only], laptop, [laptop, external])

    expect(match.source).toBe(only)
    expect(match.display).toBe(external)
    expect(match.matchedBy).toBe("fallback")
    expect(match.warnings.join(" ")).toContain("display 2")
  })

  it("keeps the active display when no display explains the fallback pixels", () => {
    const odd = source({ id: "a", width: 800, height: 1400 })

    const match = matchCaptureSource([odd], laptop, [laptop, external])

    expect(match.display).toBe(laptop)
    expect(match.matchedBy).toBe("fallback")
    expect(match.warnings.length).toBeGreaterThan(0)
  })

  it("ignores sources with unusable dimensions", () => {
    const empty = source({ id: "a", width: 0, height: 0 })
    const real = source({ id: "b", width: 3024, height: 1964 })

    const match = matchCaptureSource([empty, real], laptop, [laptop])

    expect(match.source).toBe(real)
    expect(match.matchedBy).toBe("aspect")
  })

  it("throws when there are no sources at all", () => {
    expect(() => matchCaptureSource([], laptop, [laptop])).toThrow(
      /no screen capture sources/i
    )
  })
})
