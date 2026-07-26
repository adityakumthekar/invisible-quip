import { describe, expect, it } from "vitest"
import {
  type DisplayCaptureInfo,
  parseTeachingResponse,
  screenshotPixelToDip,
  screenshotTargetToDipRect,
  TeachingValidationError
} from "./teaching"

const primaryCapture: DisplayCaptureInfo = {
  bounds: { x: 0, y: 0, width: 1440, height: 900 },
  scaleFactor: 2,
  screenshotWidth: 2880,
  screenshotHeight: 1800
}

const secondaryCapture: DisplayCaptureInfo = {
  bounds: { x: 1920, y: 0, width: 1440, height: 900 },
  scaleFactor: 1,
  screenshotWidth: 1440,
  screenshotHeight: 900
}

describe("parseTeachingResponse", () => {
  it("accepts a valid step response with target and label", () => {
    const result = parseTeachingResponse({
      state: "step",
      instruction: "Click the Share button in the toolbar.",
      target: { x: 400, y: 200, width: 80, height: 32 },
      label: "Share"
    })

    expect(result).toEqual({
      state: "step",
      instruction: "Click the Share button in the toolbar.",
      action: "click",
      target: { x: 400, y: 200, width: 80, height: 32 },
      label: "Share"
    })
  })

  it("accepts complete without target or label", () => {
    const result = parseTeachingResponse({
      state: "complete",
      instruction: "You finished sharing your screen."
    })

    expect(result).toEqual({
      state: "complete",
      instruction: "You finished sharing your screen."
    })
  })

  it("accepts blocked with instruction only", () => {
    const result = parseTeachingResponse({
      state: "blocked",
      instruction: "I cannot see the Zoom controls on this screen."
    })

    expect(result.state).toBe("blocked")
    expect(result.instruction).toBe(
      "I cannot see the Zoom controls on this screen."
    )
  })

  it("trims instruction whitespace", () => {
    const result = parseTeachingResponse({
      state: "complete",
      instruction: "  Done.  "
    })

    expect(result.instruction).toBe("Done.")
  })

  it("rejects non-object input", () => {
    expect(() => parseTeachingResponse(null)).toThrow(TeachingValidationError)
    expect(() => parseTeachingResponse("step")).toThrow(TeachingValidationError)
    expect(() => parseTeachingResponse([])).toThrow(TeachingValidationError)
  })

  it("rejects missing or invalid state", () => {
    expect(() =>
      parseTeachingResponse({ instruction: "Do the thing" })
    ).toThrow(/state/i)
    expect(() =>
      parseTeachingResponse({ state: "waiting", instruction: "Do the thing" })
    ).toThrow(/state/i)
  })

  it("rejects missing, empty, or overly long instruction", () => {
    expect(() => parseTeachingResponse({ state: "complete" })).toThrow(
      /instruction/i
    )
    expect(() =>
      parseTeachingResponse({ state: "complete", instruction: "   " })
    ).toThrow(/instruction/i)
    expect(() =>
      parseTeachingResponse({
        state: "complete",
        instruction: "x".repeat(501)
      })
    ).toThrow(/instruction/i)
  })

  it("rejects step responses without a target", () => {
    expect(() =>
      parseTeachingResponse({
        state: "step",
        instruction: "Click Share."
      })
    ).toThrow(/target/i)
  })

  it("rejects malformed targets and empty labels", () => {
    expect(() =>
      parseTeachingResponse({
        state: "step",
        instruction: "Click Share.",
        target: { x: "400", y: 200 }
      })
    ).toThrow(/target/i)

    expect(() =>
      parseTeachingResponse({
        state: "step",
        instruction: "Click Share.",
        target: { x: 400, y: 200 },
        label: "   "
      })
    ).toThrow(/label/i)
  })

  it("rejects complete or blocked responses that include a target", () => {
    expect(() =>
      parseTeachingResponse({
        state: "complete",
        instruction: "All set.",
        target: { x: 10, y: 20 }
      })
    ).toThrow(/target/i)

    expect(() =>
      parseTeachingResponse({
        state: "blocked",
        instruction: "Need permission.",
        target: { x: 10, y: 20 }
      })
    ).toThrow(/target/i)
  })

  it("returns a discriminated step response that requires target", () => {
    const result = parseTeachingResponse({
      state: "step",
      instruction: "Click Share.",
      target: { x: 400, y: 200 }
    })

    expect(result.state).toBe("step")
    if (result.state === "step") {
      expect(result.target).toEqual({ x: 400, y: 200 })
    } else {
      throw new Error("expected step branch")
    }
  })

  it("returns discriminated complete and blocked responses without target", () => {
    const complete = parseTeachingResponse({
      state: "complete",
      instruction: "All set."
    })
    const blocked = parseTeachingResponse({
      state: "blocked",
      instruction: "Need permission."
    })

    expect(complete.state).toBe("complete")
    expect(blocked.state).toBe("blocked")
    if (complete.state === "complete") {
      expect("target" in complete).toBe(false)
    }
    if (blocked.state === "blocked") {
      expect("target" in blocked).toBe(false)
    }
  })

  it("rejects unknown response properties", () => {
    expect(() =>
      parseTeachingResponse({
        state: "complete",
        instruction: "Done.",
        extra: true
      })
    ).toThrow(/unknown/i)
  })

  it("rejects unknown target properties", () => {
    expect(() =>
      parseTeachingResponse({
        state: "step",
        instruction: "Click Share.",
        target: { x: 400, y: 200, confidence: 0.9 }
      })
    ).toThrow(/unknown/i)
  })

  it("rejects negative target dimensions", () => {
    expect(() =>
      parseTeachingResponse({
        state: "step",
        instruction: "Click Share.",
        target: { x: 400, y: 200, width: -10 }
      })
    ).toThrow(/width/i)

    expect(() =>
      parseTeachingResponse({
        state: "step",
        instruction: "Click Share.",
        target: { x: 400, y: 200, height: -5 }
      })
    ).toThrow(/height/i)
  })
})

describe("screenshotPixelToDip", () => {
  it("converts Retina screenshot pixels to primary-display DIP coordinates", () => {
    expect(screenshotPixelToDip({ x: 200, y: 100 }, primaryCapture)).toEqual({
      x: 100,
      y: 50
    })
  })

  it("uses actual PNG dimensions when they differ from the display scale factor", () => {
    const resizedCapture: DisplayCaptureInfo = {
      bounds: { x: 100, y: 200, width: 1200, height: 800 },
      scaleFactor: 2,
      screenshotWidth: 1800,
      screenshotHeight: 800
    }

    expect(screenshotPixelToDip({ x: 900, y: 400 }, resizedCapture)).toEqual({
      x: 700,
      y: 600
    })
  })

  it("adds non-primary display offsets", () => {
    expect(
      screenshotPixelToDip({ x: 100, y: 50 }, secondaryCapture)
    ).toEqual({
      x: 2020,
      y: 50
    })
  })

  it("clamps out-of-bounds screenshot pixels before conversion", () => {
    expect(
      screenshotPixelToDip({ x: -50, y: 9999 }, primaryCapture)
    ).toEqual({
      x: 0,
      y: 900
    })
  })

  it("clamps converted DIP coordinates to display bounds", () => {
    const capture: DisplayCaptureInfo = {
      bounds: { x: 100, y: 200, width: 50, height: 40 },
      scaleFactor: 1,
      screenshotWidth: 50,
      screenshotHeight: 40
    }

    expect(screenshotPixelToDip({ x: 999, y: 999 }, capture)).toEqual({
      x: 150,
      y: 240
    })
  })
})

describe("screenshotTargetToDipRect", () => {
  it("converts pixel rectangles to DIP space with scale and offsets", () => {
    expect(
      screenshotTargetToDipRect(
        { x: 200, y: 100, width: 80, height: 40 },
        primaryCapture
      )
    ).toEqual({
      x: 100,
      y: 50,
      width: 40,
      height: 20
    })
  })

  it("scales rectangle dimensions using the actual PNG dimensions", () => {
    const resizedCapture: DisplayCaptureInfo = {
      bounds: { x: 100, y: 200, width: 1200, height: 800 },
      scaleFactor: 2,
      screenshotWidth: 1800,
      screenshotHeight: 800
    }

    expect(
      screenshotTargetToDipRect(
        { x: 900, y: 400, width: 300, height: 100 },
        resizedCapture
      )
    ).toEqual({
      x: 700,
      y: 600,
      width: 200,
      height: 100
    })
  })

  it("defaults missing width and height to zero", () => {
    expect(
      screenshotTargetToDipRect({ x: 200, y: 100 }, primaryCapture)
    ).toEqual({
      x: 100,
      y: 50,
      width: 0,
      height: 0
    })
  })

  it("clamps rectangle width and height so extents stay within display bounds", () => {
    const capture: DisplayCaptureInfo = {
      bounds: { x: 100, y: 200, width: 50, height: 40 },
      scaleFactor: 1,
      screenshotWidth: 50,
      screenshotHeight: 40
    }

    expect(
      screenshotTargetToDipRect(
        { x: 40, y: 30, width: 30, height: 30 },
        capture
      )
    ).toEqual({
      x: 140,
      y: 230,
      width: 10,
      height: 10
    })
  })
})
