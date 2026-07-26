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
