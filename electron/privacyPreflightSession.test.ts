import { describe, expect, it } from "vitest"
import { PrivacyPreflightSessionState } from "./privacyPreflightSession"
import type { PrivacyPreflightResult } from "./privacyContract"

const passResult: PrivacyPreflightResult = {
  status: "pass",
  reason: "not visible",
  debugMode: false
}

const failResult: PrivacyPreflightResult = {
  status: "fail",
  reason: "visible",
  remediation: "retry",
  debugMode: false
}

describe("PrivacyPreflightSessionState", () => {
  it("has not passed before any preflight has run this process", () => {
    const session = new PrivacyPreflightSessionState()
    expect(session.hasPassed()).toBe(false)
    expect(session.getLastResult()).toBeNull()
  })

  it("passes once a passing result is recorded", () => {
    const session = new PrivacyPreflightSessionState()
    session.recordResult(passResult)
    expect(session.hasPassed()).toBe(true)
    expect(session.getLastResult()).toEqual(passResult)
  })

  it("reflects the most recent result, not just the first", () => {
    const session = new PrivacyPreflightSessionState()
    session.recordResult(passResult)
    session.recordResult(failResult)
    expect(session.hasPassed()).toBe(false)
    expect(session.getLastResult()).toEqual(failResult)

    session.recordResult(passResult)
    expect(session.hasPassed()).toBe(true)
  })
})
