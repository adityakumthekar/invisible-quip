import { describe, expect, it } from "vitest"
import { evaluatePrivacyGate } from "./privacyGate"
import type { PrivacyGateStatus } from "./privacyContract"

function makeStatus(overrides: Partial<PrivacyGateStatus> = {}): PrivacyGateStatus {
  return {
    acknowledged: true,
    acknowledgementText: "text",
    acknowledgementVersion: 1,
    preflightPassed: true,
    lastPreflightResult: null,
    visibleMode: false,
    ...overrides
  }
}

describe("evaluatePrivacyGate", () => {
  it("blocks on acknowledgement first when neither has happened", () => {
    const decision = evaluatePrivacyGate(
      makeStatus({ acknowledged: false, preflightPassed: false })
    )
    expect(decision).toEqual({ canStart: false, blockingReason: "acknowledgement" })
  })

  it("blocks on preflight when acknowledged but not checked this session", () => {
    const decision = evaluatePrivacyGate(
      makeStatus({ acknowledged: true, preflightPassed: false })
    )
    expect(decision).toEqual({ canStart: false, blockingReason: "preflight" })
  })

  it("allows starting once acknowledged and preflight passed", () => {
    const decision = evaluatePrivacyGate(
      makeStatus({ acknowledged: true, preflightPassed: true })
    )
    expect(decision).toEqual({ canStart: true })
  })

  it("still blocks on preflight even if the last recorded result was a failure", () => {
    const decision = evaluatePrivacyGate(
      makeStatus({
        acknowledged: true,
        preflightPassed: false,
        lastPreflightResult: {
          status: "fail",
          reason: "leak detected",
          remediation: "retry",
          debugMode: false
        }
      })
    )
    expect(decision).toEqual({ canStart: false, blockingReason: "preflight" })
  })
})

describe("evaluatePrivacyGate in visible mode (INVISIBLE=false)", () => {
  it("allows starting without a preflight, because the check can never pass", () => {
    const decision = evaluatePrivacyGate(
      makeStatus({ visibleMode: true, preflightPassed: false, lastPreflightResult: null })
    )
    expect(decision).toEqual({ canStart: true, warning: "visible-mode" })
  })

  it("allows starting even after the debug-mode preflight failure was recorded", () => {
    const decision = evaluatePrivacyGate(
      makeStatus({
        visibleMode: true,
        preflightPassed: false,
        lastPreflightResult: {
          status: "fail",
          reason: "capturable for debugging",
          remediation: "set INVISIBLE=true",
          debugMode: true
        }
      })
    )
    expect(decision).toEqual({ canStart: true, warning: "visible-mode" })
  })

  it("still warns when a preflight somehow passed, since the warning tracks the env var", () => {
    const decision = evaluatePrivacyGate(
      makeStatus({ visibleMode: true, preflightPassed: true })
    )
    expect(decision).toEqual({ canStart: true, warning: "visible-mode" })
  })

  it("does not bypass the one-time acknowledgement", () => {
    const decision = evaluatePrivacyGate(
      makeStatus({ visibleMode: true, acknowledged: false, preflightPassed: false })
    )
    expect(decision).toEqual({ canStart: false, blockingReason: "acknowledgement" })
  })
})
