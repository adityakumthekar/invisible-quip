import { describe, expect, it } from "vitest"
import {
  classifyAppRisk,
  classifyStepRisk,
  describeLoopStop,
  evaluateLoopContinuation,
  findDangerTerms,
  findSecretIndicators,
  isDestructiveKeyCombo,
  isRepeatOfPreviousStep,
  parseAutonomyLevel,
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

describe("parseAutonomyLevel", () => {
  it("accepts the three levels and rejects everything else", () => {
    for (const level of ["guarded", "balanced", "handsoff"] as const) {
      expect(parseAutonomyLevel(level)).toBe(level)
    }
    for (const value of ["", "off", "GUARDED", null, undefined, 2, {}]) {
      expect(parseAutonomyLevel(value)).toBeNull()
    }
  })
})

describe("isDestructiveKeyCombo", () => {
  it("is true only for a modified delete", () => {
    for (const key of ["cmd+delete", "shift+delete", "cmd+shift+backspace"]) {
      expect(isDestructiveKeyCombo(key)).toBe(true)
    }
  })

  it("leaves the keys automation actually needs alone", () => {
    for (const key of [
      "enter",
      "return",
      "tab",
      "escape",
      "cmd+a",
      "cmd+v",
      "down",
      // A bare delete edits text; it takes a modifier to reach a filesystem.
      "delete",
      "backspace"
    ]) {
      expect(isDestructiveKeyCombo(key)).toBe(false)
    }
    expect(isDestructiveKeyCombo(undefined)).toBe(false)
  })
})

describe("findSecretIndicators", () => {
  const typing = (text: string, instruction = "Fill the field."): RiskAssessableStep => ({
    action: "type",
    risk: "safe",
    instruction,
    text
  })

  it("spots tokens, keys, and card numbers", () => {
    expect(findSecretIndicators(typing("sk-abcdefghijklmnop0123"))).toContain(
      "an API key"
    )
    expect(
      findSecretIndicators(typing("ghp_abcdefghijklmnop0123456789"))
    ).toContain("a GitHub token")
    expect(findSecretIndicators(typing("AKIAIOSFODNN7EXAMPLE"))).toContain(
      "an AWS access key"
    )
    // Luhn-valid test number.
    expect(findSecretIndicators(typing("4242 4242 4242 4242"))).toContain(
      "a card number"
    )
  })

  it("ignores digit runs that fail Luhn", () => {
    expect(findSecretIndicators(typing("4242 4242 4242 4243"))).toEqual([])
    expect(findSecretIndicators(typing("call me on 12345678901234"))).toEqual([])
  })

  it("falls back to the field description", () => {
    expect(
      findSecretIndicators(typing("hunter2", "Type the password."))
    ).toEqual(["a credential field"])
  })

  it("only applies to typing, and never echoes the value", () => {
    expect(
      findSecretIndicators({
        action: "click",
        risk: "safe",
        instruction: "Click the password box."
      })
    ).toEqual([])

    const verdict = classifyStepRisk(typing("sk-abcdefghijklmnop0123"), {
      provider: "qwen",
      autonomy: "handsoff"
    })
    expect(verdict.requiresConfirmation).toBe(true)
    expect(verdict.reasons.join(" ")).not.toContain("sk-abcdefghijklmnop0123")
  })
})

describe("autonomy levels", () => {
  const typeStep: RiskAssessableStep = {
    action: "type",
    risk: "safe",
    instruction: "Enter the search term.",
    label: "Search",
    text: "weather"
  }
  const terminal = { bundleId: "com.apple.Terminal", name: "Terminal" }

  it("defaults to guarded when no level is given", () => {
    expect(
      classifyStepRisk(typeStep, { provider: "qwen" }).requiresConfirmation
    ).toBe(true)
    expect(
      classifyStepRisk(typeStep, { provider: "qwen", autonomy: "guarded" })
        .requiresConfirmation
    ).toBe(true)
  })

  it("lets ordinary typing and clicking run at balanced", () => {
    for (const action of ["type", "click", "double-click", "drag", "right-click"] as const) {
      expect(
        classifyStepRisk(
          { ...typeStep, action },
          { provider: "qwen", autonomy: "balanced" }
        ).requiresConfirmation
      ).toBe(false)
    }
  })

  it("still stops for irreversible content at balanced", () => {
    const verdict = classifyStepRisk(
      { ...typeStep, text: "please delete everything" },
      { provider: "qwen", autonomy: "balanced" }
    )
    expect(verdict.requiresConfirmation).toBe(true)
    expect(verdict.reasons.join(" ")).toMatch(/delete/i)
  })

  it("stops for a destructive key combo at every level", () => {
    for (const autonomy of ["guarded", "balanced", "handsoff"] as const) {
      const verdict = classifyStepRisk(
        {
          action: "key",
          risk: "safe",
          instruction: "Press the shortcut.",
          key: "cmd+delete"
        },
        { provider: "qwen", autonomy }
      )
      expect(verdict.requiresConfirmation).toBe(true)
      expect(verdict.reasons.join(" ")).toMatch(/cmd\+delete/)
    }
  })

  it("lets a plain Enter through at balanced", () => {
    expect(
      classifyStepRisk(
        {
          action: "key",
          risk: "safe",
          instruction: "Press Enter to run the search.",
          key: "enter"
        },
        { provider: "qwen", autonomy: "balanced" }
      ).requiresConfirmation
    ).toBe(false)
  })

  it("keeps the app gates at balanced and drops them at handsoff", () => {
    const context = { targetApp: terminal, appProbeSupported: true }
    expect(
      classifyStepRisk(safeClick, {
        ...context,
        provider: "qwen",
        autonomy: "balanced"
      }).requiresConfirmation
    ).toBe(true)
    expect(
      classifyStepRisk(safeClick, {
        ...context,
        provider: "qwen",
        autonomy: "handsoff"
      }).requiresConfirmation
    ).toBe(false)
  })

  it("never lets the model's own flag be overridden by a loose level", () => {
    expect(
      classifyStepRisk(
        { ...typeStep, risk: "confirm" },
        { provider: "qwen", autonomy: "handsoff" }
      ).requiresConfirmation
    ).toBe(true)
  })

  it("no longer treats remote Qwen as a low-grounding local model", () => {
    const doubleClick = { ...safeClick, action: "double-click" as const }
    expect(
      classifyStepRisk(doubleClick, { provider: "qwen", autonomy: "guarded" })
        .requiresConfirmation
    ).toBe(false)
    expect(
      classifyStepRisk(doubleClick, { provider: "ollama", autonomy: "guarded" })
        .requiresConfirmation
    ).toBe(true)
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
