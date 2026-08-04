import { beforeEach, describe, expect, it } from "vitest"
import {
  constantTimeEquals,
  normalizeDeviceName,
  PAIRING_CODE_TTL_MS,
  parseRemoteDevices,
  RemotePairingService,
  toDeviceSummary,
  type RemotePairingDependencies
} from "./remotePairing"

const FILE = "/tmp/remote-devices.json"

/**
 * In-memory harness: a settable clock and a counter-based "random" source, so
 * expiry and single-use are exercised deterministically.
 */
function harness(initial?: string) {
  const files = new Map<string, string>()
  if (initial !== undefined) {
    files.set(FILE, initial)
  }

  const state = { now: 1_000_000, code: 0, token: 0, id: 0 }

  const dependencies: RemotePairingDependencies = {
    now: () => state.now,
    randomCode: () => String(100000 + state.code++),
    randomToken: () => `token-${state.token++}`,
    randomId: () => `device-${state.id++}`,
    readFile: async (path) => {
      const contents = files.get(path)
      if (contents === undefined) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }
      return contents
    },
    writeFile: async (path, contents) => {
      files.set(path, contents)
    }
  }

  return {
    state,
    files,
    service: new RemotePairingService(FILE, dependencies)
  }
}

describe("constantTimeEquals", () => {
  it("matches identical strings and rejects differences", () => {
    expect(constantTimeEquals("abc123", "abc123")).toBe(true)
    expect(constantTimeEquals("abc123", "abc124")).toBe(false)
    expect(constantTimeEquals("abc123", "Abc123")).toBe(false)
  })

  it("rejects on differing length without indexing past the end", () => {
    expect(constantTimeEquals("abc", "abcd")).toBe(false)
    expect(constantTimeEquals("", "")).toBe(true)
  })
})

describe("normalizeDeviceName", () => {
  it("falls back for non-strings and blanks", () => {
    expect(normalizeDeviceName(undefined)).toBe("Phone")
    expect(normalizeDeviceName(42)).toBe("Phone")
    expect(normalizeDeviceName("   ")).toBe("Phone")
  })

  it("strips control characters that would corrupt the device list", () => {
    expect(normalizeDeviceName("Pixel\u0000\u001b[31m 9")).toBe("Pixel[31m 9")
  })

  it("caps the length", () => {
    expect(normalizeDeviceName("x".repeat(200))).toHaveLength(64)
  })
})

describe("parseRemoteDevices", () => {
  it("returns empty for malformed input", () => {
    expect(parseRemoteDevices("not json")).toEqual([])
    expect(parseRemoteDevices(JSON.stringify({ id: "a" }))).toEqual([])
  })

  it("drops entries missing required fields but keeps valid ones", () => {
    const raw = JSON.stringify([
      { id: "a", name: "A", token: "t", pairedAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", name: "B" }
    ])
    expect(parseRemoteDevices(raw)).toEqual([
      {
        id: "a",
        name: "A",
        token: "t",
        pairedAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: null
      }
    ])
  })
})

describe("toDeviceSummary", () => {
  it("never exposes the token", () => {
    const summary = toDeviceSummary({
      id: "a",
      name: "A",
      token: "secret",
      pairedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: null
    })
    expect(summary).not.toHaveProperty("token")
    expect(JSON.stringify(summary)).not.toContain("secret")
  })
})

describe("pairing codes", () => {
  let h: ReturnType<typeof harness>

  beforeEach(() => {
    h = harness()
  })

  it("has no active code until one is issued", () => {
    expect(h.service.getActiveCode()).toBeNull()
  })

  it("expires a code after its TTL", () => {
    const issued = h.service.issueCode()
    h.state.now += PAIRING_CODE_TTL_MS - 1
    expect(h.service.getActiveCode()).toEqual(issued)

    h.state.now += 1
    expect(h.service.getActiveCode()).toBeNull()
  })

  it("replaces the previous code when a new one is issued", async () => {
    const first = h.service.issueCode()
    const second = h.service.issueCode()
    expect(second.code).not.toBe(first.code)
    expect(await h.service.redeem(first.code, "Phone")).toBeNull()
    expect(await h.service.redeem(second.code, "Phone")).not.toBeNull()
  })

  it("refuses an expired code", async () => {
    const { code } = h.service.issueCode()
    h.state.now += PAIRING_CODE_TTL_MS
    expect(await h.service.redeem(code, "Phone")).toBeNull()
  })
})

describe("redeem", () => {
  let h: ReturnType<typeof harness>

  beforeEach(() => {
    h = harness()
  })

  it("issues a device with a token and persists it", async () => {
    const { code } = h.service.issueCode()
    const device = await h.service.redeem(code, "Pixel 9")

    expect(device).toMatchObject({ name: "Pixel 9", token: "token-0" })
    expect(JSON.parse(h.files.get(FILE)!)).toHaveLength(1)
  })

  it("consumes the code — a second redemption fails", async () => {
    const { code } = h.service.issueCode()
    expect(await h.service.redeem(code, "Phone")).not.toBeNull()
    expect(await h.service.redeem(code, "Phone")).toBeNull()
    expect(await h.service.listDevices()).toHaveLength(1)
  })

  it("rejects a wrong code and leaves the real one usable", async () => {
    const { code } = h.service.issueCode()
    expect(await h.service.redeem("000000", "Attacker")).toBeNull()
    expect(await h.service.redeem(code, "Phone")).not.toBeNull()
  })

  it("rejects non-string codes", async () => {
    h.service.issueCode()
    for (const code of [null, undefined, 123456, {}]) {
      expect(await h.service.redeem(code, "Phone")).toBeNull()
    }
  })

  it("issues a distinct token per device", async () => {
    const first = await h.service.redeem(h.service.issueCode().code, "A")
    const second = await h.service.redeem(h.service.issueCode().code, "B")
    expect(first!.token).not.toBe(second!.token)
  })
})

describe("verifyToken", () => {
  let h: ReturnType<typeof harness>

  beforeEach(() => {
    h = harness()
  })

  it("resolves a paired device by token", async () => {
    const device = await h.service.redeem(h.service.issueCode().code, "Phone")
    expect(await h.service.verifyToken(device!.token)).toMatchObject({
      id: device!.id
    })
  })

  it("rejects unknown, empty, and non-string tokens", async () => {
    await h.service.redeem(h.service.issueCode().code, "Phone")
    for (const token of ["nope", "", null, undefined, 5, {}]) {
      expect(await h.service.verifyToken(token)).toBeNull()
    }
  })

  it("rejects every token once nothing is paired", async () => {
    expect(await h.service.verifyToken("token-0")).toBeNull()
  })
})

describe("revocation", () => {
  let h: ReturnType<typeof harness>

  beforeEach(() => {
    h = harness()
  })

  it("invalidates the revoked device's token only", async () => {
    const first = await h.service.redeem(h.service.issueCode().code, "A")
    const second = await h.service.redeem(h.service.issueCode().code, "B")

    expect(await h.service.revoke(first!.id)).toBe(true)
    expect(await h.service.verifyToken(first!.token)).toBeNull()
    expect(await h.service.verifyToken(second!.token)).not.toBeNull()
  })

  it("reports false for an unknown device id", async () => {
    expect(await h.service.revoke("device-nope")).toBe(false)
  })

  it("revokeAll clears every device", async () => {
    const device = await h.service.redeem(h.service.issueCode().code, "A")
    await h.service.revokeAll()
    expect(await h.service.listDevices()).toEqual([])
    expect(await h.service.verifyToken(device!.token)).toBeNull()
  })

  // Revocation has to survive a restart, or "cut off my lost phone" is a lie.
  it("persists revocation to disk", async () => {
    const device = await h.service.redeem(h.service.issueCode().code, "A")
    await h.service.revoke(device!.id)

    const reloaded = harness(h.files.get(FILE))
    expect(await reloaded.service.verifyToken(device!.token)).toBeNull()
  })
})

describe("persistence across restarts", () => {
  it("keeps a paired device usable", async () => {
    const first = harness()
    const device = await first.service.redeem(
      first.service.issueCode().code,
      "Phone"
    )

    const second = harness(first.files.get(FILE))
    expect(await second.service.verifyToken(device!.token)).toMatchObject({
      name: "Phone"
    })
  })

  it("treats a missing file as nothing paired", async () => {
    const h = harness()
    expect(await h.service.listDevices()).toEqual([])
  })
})

describe("touch", () => {
  it("records a last-seen timestamp", async () => {
    const h = harness()
    const device = await h.service.redeem(h.service.issueCode().code, "Phone")
    expect(device!.lastSeenAt).toBeNull()

    h.state.now += 5000
    await h.service.touch(device!.id)

    const [summary] = await h.service.listDevices()
    expect(summary.lastSeenAt).toBe(new Date(h.state.now).toISOString())
  })

  it("ignores an unknown device id", async () => {
    const h = harness()
    await expect(h.service.touch("device-nope")).resolves.toBeUndefined()
  })
})
