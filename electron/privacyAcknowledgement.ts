import {
  PRIVACY_ACKNOWLEDGEMENT_VERSION,
  type PrivacyAcknowledgementRecord
} from "./privacyContract"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parsePrivacyAcknowledgementRecord(
  raw: string
): PrivacyAcknowledgementRecord | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }

  if (
    !isPlainObject(data) ||
    typeof data.version !== "number" ||
    typeof data.acknowledgedAt !== "string"
  ) {
    return null
  }

  return { version: data.version, acknowledgedAt: data.acknowledgedAt }
}

export function isAcknowledgementCurrent(
  record: PrivacyAcknowledgementRecord | null
): boolean {
  return record !== null && record.version === PRIVACY_ACKNOWLEDGEMENT_VERSION
}

export interface PrivacyAcknowledgementStoreDependencies {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, contents: string) => Promise<void>
  now: () => Date
}

/**
 * Persists the one-time Teach Me disclosure acknowledgement locally, keyed
 * by version so a future copy change invalidates prior acknowledgements.
 * This alone does not satisfy the gate: a fresh per-process preflight is
 * also required (see privacyPreflightSession.ts).
 */
export class PrivacyAcknowledgementStore {
  constructor(
    private readonly filePath: string,
    private readonly dependencies: PrivacyAcknowledgementStoreDependencies
  ) {}

  public async isAcknowledged(): Promise<boolean> {
    try {
      const raw = await this.dependencies.readFile(this.filePath)
      return isAcknowledgementCurrent(parsePrivacyAcknowledgementRecord(raw))
    } catch {
      return false
    }
  }

  public async acknowledge(): Promise<PrivacyAcknowledgementRecord> {
    const record: PrivacyAcknowledgementRecord = {
      version: PRIVACY_ACKNOWLEDGEMENT_VERSION,
      acknowledgedAt: this.dependencies.now().toISOString()
    }
    await this.dependencies.writeFile(this.filePath, JSON.stringify(record))
    return record
  }
}
