import { describe, expect, it } from "vitest"
import {
  classifyAppRisk,
  classifyStepRisk,
  describeLoopStop,
  evaluateLoopContinuation,
  findDangerTerms,
  isRepeatOfPreviousStep,
  type LoopState,
  type RepeatComparableStep,
  type RiskAssessableStep
} from "./autopilotPolicy"

const safeClick: RiskAssessableStep = {
  action: "click",
  risk: "safe",
  instruction: "Open the Files panel.",
  label: "Files"
}

describe("findDangerTerms", () => {
  it("matches on word boundaries, not substrings", () => {
    expect(findDangerTerms("Send")).toEqual(["send"])
    expect(findDangerTerms("sender name")).toEqual([])
    expect(findDangerTerms("Appended")).toEqual([])
  })

  it("matches multi-word terms and searches every haystack", () => {
    expect(findDangerTerms("Reply all")).toContain("reply all")
    expect(findDangerTerms(undefined, "Click Delete to continue")).toContain(
      "delete"
    )
  })

  it("returns nothing for empty input", () => {
    expect(findDangerTerms(undefined, undefined)).toEqual([])
    expect(findDangerTerms("   ")).toEqual([])
  })
})

describe("classifyStepRisk", () => {
  it("lets a plain click run unattended on Gemini", () => {
    const verdict = classifyStepRisk(safeClick, { provider: "gemini" })
    expect(verdict.requiresConfirmation).toBe(false)
    expect(verdict.reasons).toEqual([])
  })

  it("honours the model's own confirm flag", () => {
    const verdict = classifyStepRisk(
      { ...safeClick, risk: "confirm" },
      { provider: "gemini" }
    )
    expect(verdict.requiresConfirmation).toBe(true)
    expect(verdict.reasons[0]).toMatch(/model flagged/i)
  })

  it("always confirms type, drag, and right-click", () => {
    for (const action of ["type", "drag", "right-click"] as const) {
      const verdict = classifyStepRisk(
        { ...safeClick, action },
        { provider: "gemini" }
      )
      expect(verdict.requiresConfirmation).toBe(true)
      expect(verdict.reasons.join(" ")).toContain(action)
    }
  })

  it("does not confirm click, scroll, wait, double-click on Gemini", () => {
    for (const action of ["click", "scroll", "wait", "double-click"] as const) {
      expect(
        classifyStepRisk({ ...safeClick, action }, { provider: "gemini" })
          .requiresConfirmation
      ).toBe(false)
    }
  })

  it("escalates a step whose label hits the danger lexicon", () => {
    const verdict = classifyStepRisk(
      { ...safeClick, label: "Delete forever" },
      { provider: "gemini" }
    )
    expect(verdict.requiresConfirmation).toBe(true)
    expect(verdict.reasons.join(" ")).toMatch(/delete/i)
  })

  it("escalates on dangerous text about to be typed", () => {
    const verdict = classifyStepRisk(
      {
        action: "type",
        risk: "safe",
        instruction: "Fill the box.",
        text: "please delete my account"
      },
      { provider: "gemini" }
    )
    expect(verdict.reasons.join(" ")).toMatch(/delete/i)
  })

  it("cannot be talked down by the model marking a dangerous step safe", () => {
    const verdict = classifyStepRisk(
      { action: "click", risk: "safe", instruction: "Click Send.", label: "Send" },
      { provider: "gemini" }
    )
    expect(verdict.requiresConfirmation).toBe(true)
  })

  it("applies a stricter bar on Ollama", () => {
    const doubleClick = { ...safeClick, action: "double-click" as const }
    expect(
      classifyStepRisk(doubleClick, { provider: "gemini" }).requiresConfirmation
    ).toBe(false)
    expect(
      classifyStepRisk(doubleClick, { provider: "ollama" }).requiresConfirmation
    ).toBe(true)
  })

  it("still lets click, scroll, and wait run unattended on Ollama", () => {
    for (const action of ["click", "scroll", "wait"] as const) {
      expect(
        classifyStepRisk({ ...safeClick, action }, { provider: "ollama" })
          .requiresConfirmation
      ).toBe(false)
    }
  })

  it("collects every reason that applies", () => {
    const verdict = classifyStepRisk(
      {
        action: "type",
        risk: "confirm",
        instruction: "Type the message.",
        label: "Send field",
        text: "hi"
      },
      { provider: "ollama" }
    )
    expect(verdict.reasons).toHaveLength(4)
  })

  const slack = { bundleId: "com.tinyspeck.slackmacgap", name: "Slack" }
  const terminal = { bundleId: "com.apple.Terminal", name: "Terminal" }

  it("confirms every step in a terminal, down to a plain click", () => {
    const verdict = classifyStepRisk(safeClick, {
      provider: "gemini",
      targetApp: terminal,
      appProbeSupported: true
    })
    expect(verdict.requiresConfirmation).toBe(true)
    expect(verdict.reasons[0]).toMatch(/terminal/i)
  })

  it("lets navigation run unattended in a messaging app", () => {
    for (const action of ["click", "scroll", "wait"] as const) {
      expect(
        classifyStepRisk(
          { ...safeClick, action },
          { provider: "gemini", targetApp: slack, appProbeSupported: true }
        ).requiresConfirmation
      ).toBe(false)
    }
  })

  it("confirms anything that could send in a messaging app", () => {
    for (const action of ["key", "double-click"] as const) {
      const verdict = classifyStepRisk(
        { ...safeClick, action },
        { provider: "gemini", targetApp: slack, appProbeSupported: true }
      )
      expect(verdict.requiresConfirmation).toBe(true)
      expect(verdict.reasons[0]).toMatch(/slack/i)
      expect(verdict.reasons[0]).toMatch(/send/i)
    }
  })

  it("still runs unattended in an ordinary app", () => {
    const verdict = classifyStepRisk(safeClick, {
      provider: "gemini",
      targetApp: { bundleId: "com.apple.Notes", name: "Notes" },
      appProbeSupported: true
    })
    expect(verdict.requiresConfirmation).toBe(false)
  })

  it("holds committing actions when the app can't be identified", () => {
    const verdict = classifyStepRisk(
      { ...safeClick, action: "key" },
      { provider: "gemini", targetApp: null, appProbeSupported: true }
    )
    expect(verdict.requiresConfirmation).toBe(true)
    expect(verdict.reasons[0]).toMatch(/couldn't tell which app/i)
  })

  it("still navigates when the app can't be identified", () => {
    expect(
      classifyStepRisk(safeClick, {
        provider: "gemini",
        targetApp: null,
        appProbeSupported: true
      }).requiresConfirmation
    ).toBe(false)
  })

  it("skips the app rule entirely where no probe exists", () => {
    const verdict = classifyStepRisk(safeClick, {
      provider: "gemini",
      targetApp: null,
      appProbeSupported: false
    })
    expect(verdict.requiresConfirmation).toBe(false)
  })

  it("adds the app reason alongside the action reasons", () => {
    const verdict = classifyStepRisk(
      { ...safeClick, action: "type", text: "hi" },
      { provider: "gemini", targetApp: terminal, appProbeSupported: true }
    )
    expect(verdict.reasons).toHaveLength(2)
    expect(verdict.reasons[0]).toMatch(/terminal/i)
    expect(verdict.reasons[1]).toMatch(/type/i)
  })
})

describe("classifyAppRisk", () => {
  it("reports only app-derived reasons", () => {
    expect(
      classifyAppRisk(
        { action: "click" },
        {
          provider: "gemini",
          targetApp: {
            bundleId: "com.apple.systempreferences",
            name: "System Settings"
          },
          appProbeSupported: true
        }
      )
    ).toHaveLength(1)

    // A "type" step confirms for action reasons, but not app ones, in Notes.
    expect(
      classifyAppRisk(
        { action: "type" },
        {
          provider: "ollama",
          targetApp: { bundleId: "com.apple.Notes", name: "Notes" },
          appProbeSupported: true
        }
      )
    ).toEqual([])
  })
})

describe("isRepeatOfPreviousStep", () => {
  const base: RepeatComparableStep = {
    action: "click",
    target: { x: 100, y: 200, width: 40, height: 20 }
  }

  it("is false with no previous step", () => {
    expect(isRepeatOfPreviousStep(base, null)).toBe(false)
  })

  it("is true for the same action at the same spot", () => {
    expect(isRepeatOfPreviousStep(base, { ...base })).toBe(true)
  })

  it("tolerates sub-pixel jitter but not a real move", () => {
    expect(
      isRepeatOfPreviousStep(base, {
        ...base,
        target: { ...base.target, x: 104 }
      })
    ).toBe(true)
    expect(
      isRepeatOfPreviousStep(base, {
        ...base,
        target: { ...base.target, x: 140 }
      })
    ).toBe(false)
  })

  it("is false when the action or payload differs", () => {
    expect(isRepeatOfPreviousStep(base, { ...base, action: "double-click" })).toBe(
      false
    )
    expect(
      isRepeatOfPreviousStep(
        { ...base, action: "type", text: "a" },
        { ...base, action: "type", text: "b" }
      )
    ).toBe(false)
    expect(
      isRepeatOfPreviousStep(
        { ...base, action: "scroll", scroll: { direction: "down", amount: 3 } },
        { ...base, action: "scroll", scroll: { direction: "up", amount: 3 } }
      )
    ).toBe(false)
  })
})

describe("evaluateLoopContinuation", () => {
  const running: LoopState = {
    stepIndex: 1,
    maxSteps: 25,
    resultState: "step",
    repeatCount: 0,
    maxRepeats: 2,
    consecutiveErrors: 0,
    maxConsecutiveErrors: 2
  }

  it("continues a healthy run", () => {
    expect(evaluateLoopContinuation(running)).toBe("continue")
  })

  it("stops on terminal model states first", () => {
    expect(
      evaluateLoopContinuation({ ...running, resultState: "complete" })
    ).toBe("stop-complete")
    expect(
      evaluateLoopContinuation({ ...running, resultState: "blocked" })
    ).toBe("stop-blocked")
  })

  it("stops on repeated errors, stalls, and the step budget", () => {
    expect(
      evaluateLoopContinuation({ ...running, consecutiveErrors: 2 })
    ).toBe("stop-errors")
    expect(evaluateLoopContinuation({ ...running, repeatCount: 2 })).toBe(
      "stop-stalled"
    )
    expect(evaluateLoopContinuation({ ...running, stepIndex: 25 })).toBe(
      "stop-budget"
    )
  })

  it("prefers completion over a budget stop on the final step", () => {
    expect(
      evaluateLoopContinuation({
        ...running,
        stepIndex: 25,
        resultState: "complete"
      })
    ).toBe("stop-complete")
  })

  it("describes every stop reason", () => {
    for (const decision of [
      "stop-complete",
      "stop-blocked",
      "stop-budget",
      "stop-stalled",
      "stop-errors"
    ] as const) {
      expect(describeLoopStop(decision)).toMatch(/\w/)
    }
  })
})
