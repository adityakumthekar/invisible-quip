import type { PrivacyPreflightResult } from "./privacyContract"

/**
 * In-memory, per-process record of the most recent privacy preflight
 * result. Intentionally not persisted: the self-capture check must be
 * re-run at least once per app process/session before Teach Me can start,
 * even if the one-time acknowledgement is already on disk.
 */
export class PrivacyPreflightSessionState {
  private lastResult: PrivacyPreflightResult | null = null

  public recordResult(result: PrivacyPreflightResult): void {
    this.lastResult = result
  }

  public hasPassed(): boolean {
    return this.lastResult?.status === "pass"
  }

  public getLastResult(): PrivacyPreflightResult | null {
    return this.lastResult
  }
}
