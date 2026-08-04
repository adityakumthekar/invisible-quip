// remotePairing.ts
//
// Who is allowed to talk to the remote server. A short numeric code, shown on
// the laptop and typed (or scanned) on the phone, is exchanged exactly once for
// a long-lived device token; from then on the token authenticates every
// request. Codes expire so a screenshot of the Settings tab isn't a permanent
// key, and tokens are individually revocable so a lost phone can be cut off
// without re-pairing the others.
//
// Clock, randomness, and file I/O are injected — the same arrangement as
// PrivacyAcknowledgementStore — so expiry, single-use, and revocation are all
// testable without a real filesystem or a real two minutes.

export const PAIRING_CODE_TTL_MS = 2 * 60 * 1000
export const PAIRING_CODE_DIGITS = 6
export const MAX_DEVICE_NAME_LENGTH = 64

export interface RemoteDevice {
  id: string
  name: string
  token: string
  pairedAt: string
  lastSeenAt: string | null
}

/** What the Settings tab may show. Deliberately omits `token`. */
export type RemoteDeviceSummary = Omit<RemoteDevice, "token">

export interface PairingCode {
  code: string
  expiresAt: number
}

export interface RemotePairingDependencies {
  now: () => number
  /** Digits for the pairing code; injected so tests aren't random. */
  randomCode: () => string
  /** High-entropy device token. */
  randomToken: () => string
  randomId: () => string
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, contents: string) => Promise<void>
}

export function toDeviceSummary(device: RemoteDevice): RemoteDeviceSummary {
  const { token: _token, ...summary } = device
  return summary
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Compare in time independent of where the first difference falls, so a
 * attacker on the LAN can't recover a token byte-by-byte from response timing.
 * Length is compared up front — that leaks only the length, which is fixed.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

export function parseRemoteDevices(raw: string): RemoteDevice[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }

  if (!Array.isArray(data)) {
    return []
  }

  return data.flatMap((entry) => {
    if (
      !isPlainObject(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.token !== "string" ||
      typeof entry.pairedAt !== "string"
    ) {
      return []
    }
    return [
      {
        id: entry.id,
        name: entry.name,
        token: entry.token,
        pairedAt: entry.pairedAt,
        lastSeenAt:
          typeof entry.lastSeenAt === "string" ? entry.lastSeenAt : null
      }
    ]
  })
}

/** Trim to something safe to render in the Settings device list. */
export function normalizeDeviceName(raw: unknown): string {
  if (typeof raw !== "string") {
    return "Phone"
  }
  // Control characters would corrupt the Settings list; strip rather than
  // reject, since the name is cosmetic and never used for auth.
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, "").trim()
  if (cleaned.length === 0) {
    return "Phone"
  }
  return cleaned.slice(0, MAX_DEVICE_NAME_LENGTH)
}

export class RemotePairingService {
  private devices: RemoteDevice[] | null = null
  private pending: PairingCode | null = null

  constructor(
    private readonly filePath: string,
    private readonly dependencies: RemotePairingDependencies
  ) {}

  /**
   * Issue a fresh code, replacing any outstanding one. Replacing rather than
   * reusing means the code on screen is always the only code that works.
   */
  public issueCode(): PairingCode {
    this.pending = {
      code: this.dependencies.randomCode(),
      expiresAt: this.dependencies.now() + PAIRING_CODE_TTL_MS
    }
    return this.pending
  }

  /** The outstanding code, or null when there is none or it has expired. */
  public getActiveCode(): PairingCode | null {
    if (!this.pending) {
      return null
    }
    if (this.dependencies.now() >= this.pending.expiresAt) {
      this.pending = null
      return null
    }
    return this.pending
  }

  public clearCode(): void {
    this.pending = null
  }

  /**
   * Exchange a code for a device token. The code is consumed on success *and*
   * left intact on failure, so a wrong guess doesn't let an attacker invalidate
   * the legitimate pairing attempt in progress.
   */
  public async redeem(
    code: unknown,
    deviceName: unknown
  ): Promise<RemoteDevice | null> {
    const active = this.getActiveCode()
    if (!active || typeof code !== "string") {
      return null
    }
    if (!constantTimeEquals(code.trim(), active.code)) {
      return null
    }

    // Single use: burn it before the await, so two racing requests with the
    // same valid code can't both pair.
    this.pending = null

    const devices = await this.load()
    const device: RemoteDevice = {
      id: this.dependencies.randomId(),
      name: normalizeDeviceName(deviceName),
      token: this.dependencies.randomToken(),
      pairedAt: new Date(this.dependencies.now()).toISOString(),
      lastSeenAt: null
    }
    devices.push(device)
    await this.persist(devices)
    return device
  }

  /** The device this token belongs to, or null. Does not record a visit. */
  public async verifyToken(token: unknown): Promise<RemoteDevice | null> {
    if (typeof token !== "string" || token.length === 0) {
      return null
    }
    const devices = await this.load()
    // Check every device even after a match so the work doesn't depend on
    // which device the token belongs to.
    let matched: RemoteDevice | null = null
    for (const device of devices) {
      if (constantTimeEquals(device.token, token)) {
        matched = device
      }
    }
    return matched
  }

  public async touch(deviceId: string): Promise<void> {
    const devices = await this.load()
    const device = devices.find((entry) => entry.id === deviceId)
    if (!device) {
      return
    }
    device.lastSeenAt = new Date(this.dependencies.now()).toISOString()
    await this.persist(devices)
  }

  public async listDevices(): Promise<RemoteDeviceSummary[]> {
    return (await this.load()).map(toDeviceSummary)
  }

  public async revoke(deviceId: string): Promise<boolean> {
    const devices = await this.load()
    const remaining = devices.filter((device) => device.id !== deviceId)
    if (remaining.length === devices.length) {
      return false
    }
    await this.persist(remaining)
    return true
  }

  public async revokeAll(): Promise<void> {
    await this.persist([])
  }

  private async load(): Promise<RemoteDevice[]> {
    if (this.devices) {
      return this.devices
    }
    try {
      this.devices = parseRemoteDevices(
        await this.dependencies.readFile(this.filePath)
      )
    } catch {
      // No file yet, or unreadable — either way, nothing is paired.
      this.devices = []
    }
    return this.devices
  }

  private async persist(devices: RemoteDevice[]): Promise<void> {
    this.devices = devices
    await this.dependencies.writeFile(
      this.filePath,
      JSON.stringify(devices, null, 2)
    )
  }
}
