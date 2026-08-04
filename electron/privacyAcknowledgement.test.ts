import { describe, expect, it, vi } from "vitest"
import {
  PRIVACY_ACKNOWLEDGEMENT_TEXT,
  PRIVACY_ACKNOWLEDGEMENT_VERSION,
  REMOTE_CONTROL_CONSENT_TEXT,
  REMOTE_CONTROL_CONSENT_VERSION,
  REMOTE_INPUT_CONSENT_TEXT,
  REMOTE_INPUT_CONSENT_VERSION,
  SYSTEM_AUDIO_CONSENT_TEXT,
  SYSTEM_AUDIO_CONSENT_VERSION
} from "./privacyContract"
import {
  isAcknowledgementCurrent,
  parsePrivacyAcknowledgementRecord,
  PrivacyAcknowledgementStore
} from "./privacyAcknowledgement"

describe("privacy acknowledgement copy", () => {
  it("uses the exact required disclosure text", () => {
    expect(PRIVACY_ACKNOWLEDGEMENT_TEXT).toBe(
      "Quip uses capture protection and is normally hidden from Zoom/Meet/Teams-style sharing, but exclusion is best-effort and the user must verify the share preview."
    )
    expect(PRIVACY_ACKNOWLEDGEMENT_TEXT).not.toMatch(/always|guarantee|100%|completely invisible|universal/i)
  })
})

describe("remote control consent copy", () => {
  // Remote operation invalidates the assumption the autopilot consent is
  // written on ("stay at the machine"), so this text has a job to do: it must
  // say nobody is watching, that the keyboard kill switch is out of reach,
  // that Stop moves to the phone, and that a paired phone is a key.
  it("says nobody is watching the screen", () => {
    expect(REMOTE_CONTROL_CONSENT_TEXT).toMatch(/nobody watching|not in front of it/i)
  })

  it("says the desktop kill switch is unreachable and names the replacement", () => {
    expect(REMOTE_CONTROL_CONSENT_TEXT).toMatch(/out of reach/i)
    expect(REMOTE_CONTROL_CONSENT_TEXT).toMatch(/Stop lives on the phone/i)
  })

  it("says a paired phone is a key to the machine", () => {
    expect(REMOTE_CONTROL_CONSENT_TEXT).toMatch(/key to this machine/i)
    expect(REMOTE_CONTROL_CONSENT_TEXT).toMatch(/revoke/i)
  })

  it("admits the traffic is unencrypted and makes no safety claim", () => {
    expect(REMOTE_CONTROL_CONSENT_TEXT).toMatch(/not encrypted/i)
    expect(REMOTE_CONTROL_CONSENT_TEXT).toMatch(/networks you trust/i)
    // No reassurance the transport doesn't earn — same rule the capture
    // disclosure follows about "always"/"guarantee".
    expect(REMOTE_CONTROL_CONSENT_TEXT).not.toMatch(
      /\bsecure(ly)?\b|\bsafe\b|\bprivate\b|\bguarantee/i
    )
  })

  // Consent is stored by version; reusing a version after a copy change would
  // silently keep an acknowledgement of text the user never read.
  it("is versioned separately from the autopilot consent", () => {
    expect(typeof REMOTE_CONTROL_CONSENT_VERSION).toBe("number")
  })
})

describe("system audio consent copy", () => {
  // The first consent whose subject is someone other than the person accepting
  // it. It must say whose voice is captured, where it goes, that the law often
  // requires their agreement, whose job getting it is, and how to stop.
  it("says the other people are recorded, not only the user", () => {
    expect(SYSTEM_AUDIO_CONSENT_TEXT).toMatch(/other people on your call/i)
    expect(SYSTEM_AUDIO_CONSENT_TEXT).toMatch(/not only you/i)
  })

  it("says their voice leaves the machine and names where it goes", () => {
    expect(SYSTEM_AUDIO_CONSENT_TEXT).toMatch(/leave this machine/i)
    expect(SYSTEM_AUDIO_CONSENT_TEXT).toMatch(/AI provider/i)
  })

  it("says recording often requires everyone's agreement", () => {
    expect(SYSTEM_AUDIO_CONSENT_TEXT).toMatch(
      /every person in a conversation to agree/i
    )
  })

  it("puts getting that agreement on the user, not on Quip", () => {
    expect(SYSTEM_AUDIO_CONSENT_TEXT).toMatch(/Quip cannot ask them for you/i)
    expect(SYSTEM_AUDIO_CONSENT_TEXT).toMatch(/yours to do/i)
  })

  it("says how to turn it off and makes no claim the capture is lawful", () => {
    expect(SYSTEM_AUDIO_CONSENT_TEXT).toMatch(/Turn off System audio/i)
    // Same rule the other disclosures follow: no reassurance it hasn't earned.
    expect(SYSTEM_AUDIO_CONSENT_TEXT).not.toMatch(
      /\blegal\b|\bcompliant\b|\ballowed\b|\bpermitted\b|\bguarantee/i
    )
  })

  it("is versioned separately from the consents it grows out of", () => {
    expect(typeof SYSTEM_AUDIO_CONSENT_VERSION).toBe("number")
  })
})

describe("remote input consent copy", () => {
  // Direct input removes the ceiling every other consent is written under: no
  // model decides what happens, so nothing pauses to ask. This text is the only
  // place the user is told that, and it must not read as a milder restatement
  // of the remote-control consent.
  it("says the phone acts as the user's own hands", () => {
    expect(REMOTE_INPUT_CONSENT_TEXT).toMatch(/click, type, drag, and scroll/i)
    expect(REMOTE_INPUT_CONSENT_TEXT).toMatch(/your own hands/i)
  })

  it("says autopilot's confirmations do not apply", () => {
    expect(REMOTE_INPUT_CONSENT_TEXT).toMatch(/confirmation prompts do not apply/i)
    expect(REMOTE_INPUT_CONSENT_TEXT).toMatch(/nothing pauses to ask/i)
  })

  it("names the reach: everything on screen and every signed-in account", () => {
    expect(REMOTE_INPUT_CONSENT_TEXT).toMatch(/read anything on screen/i)
    expect(REMOTE_INPUT_CONSENT_TEXT).toMatch(/signed in to/i)
  })

  it("names all three ways to cut it off", () => {
    expect(REMOTE_INPUT_CONSENT_TEXT).toMatch(/Allow phone input/i)
    expect(REMOTE_INPUT_CONSENT_TEXT).toMatch(/revoke/i)
    expect(REMOTE_INPUT_CONSENT_TEXT).toMatch(/Cmd\/Ctrl\+Shift\+Backspace/i)
  })

  it("admits the traffic is unencrypted and makes no safety claim", () => {
    expect(REMOTE_INPUT_CONSENT_TEXT).toMatch(/not encrypted/i)
    expect(REMOTE_INPUT_CONSENT_TEXT).not.toMatch(
      /\bsecure(ly)?\b|\bsafe\b|\bprivate\b|\bguarantee/i
    )
  })

  // Stored by version like the others: a reword without a bump would leave an
  // acknowledgement covering text the user never read.
  it("is versioned separately from the remote control consent", () => {
    expect(typeof REMOTE_INPUT_CONSENT_VERSION).toBe("number")
  })
})

describe("parsePrivacyAcknowledgementRecord", () => {
  it("parses a valid record", () => {
    expect(
      parsePrivacyAcknowledgementRecord(
        JSON.stringify({ version: 1, acknowledgedAt: "2026-01-01T00:00:00.000Z" })
      )
    ).toEqual({ version: 1, acknowledgedAt: "2026-01-01T00:00:00.000Z" })
  })

  it("rejects malformed JSON", () => {
    expect(parsePrivacyAcknowledgementRecord("not json")).toBeNull()
  })

  it("rejects records missing required fields", () => {
    expect(parsePrivacyAcknowledgementRecord(JSON.stringify({}))).toBeNull()
    expect(
      parsePrivacyAcknowledgementRecord(JSON.stringify({ version: 1 }))
    ).toBeNull()
    expect(
      parsePrivacyAcknowledgementRecord(
        JSON.stringify({ version: "1", acknowledgedAt: "x" })
      )
    ).toBeNull()
  })
})

describe("isAcknowledgementCurrent", () => {
  it("is false for null records", () => {
    expect(isAcknowledgementCurrent(null)).toBe(false)
  })

  it("is true only when the version matches the current disclosure version", () => {
    expect(
      isAcknowledgementCurrent({
        version: PRIVACY_ACKNOWLEDGEMENT_VERSION,
        acknowledgedAt: "2026-01-01T00:00:00.000Z"
      })
    ).toBe(true)
    expect(
      isAcknowledgementCurrent({
        version: PRIVACY_ACKNOWLEDGEMENT_VERSION - 1,
        acknowledgedAt: "2026-01-01T00:00:00.000Z"
      })
    ).toBe(false)
  })
})

describe("PrivacyAcknowledgementStore", () => {
  function makeStore(initialFile?: string) {
    const files = new Map<string, string>()
    if (initialFile !== undefined) {
      files.set("/tmp/ack.json", initialFile)
    }
    const readFile = vi.fn(async (path: string) => {
      if (!files.has(path)) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }
      return files.get(path)!
    })
    const writeFile = vi.fn(async (path: string, contents: string) => {
      files.set(path, contents)
    })
    const now = vi.fn(() => new Date("2026-07-23T12:00:00.000Z"))
    const store = new PrivacyAcknowledgementStore("/tmp/ack.json", {
      readFile,
      writeFile,
      now
    })
    return { store, files, readFile, writeFile, now }
  }

  it("is not acknowledged when no file exists yet", async () => {
    const { store } = makeStore()
    expect(await store.isAcknowledged()).toBe(false)
  })

  it("is not acknowledged when the persisted version is stale", async () => {
    const { store } = makeStore(
      JSON.stringify({ version: 0, acknowledgedAt: "2020-01-01T00:00:00.000Z" })
    )
    expect(await store.isAcknowledged()).toBe(false)
  })

  it("is not acknowledged when the file contents are corrupt", async () => {
    const { store } = makeStore("{not valid json")
    expect(await store.isAcknowledged()).toBe(false)
  })

  it("persists a versioned, timestamped acknowledgement and reports it as acknowledged", async () => {
    const { store, writeFile } = makeStore()

    const record = await store.acknowledge()

    expect(record).toEqual({
      version: PRIVACY_ACKNOWLEDGEMENT_VERSION,
      acknowledgedAt: "2026-07-23T12:00:00.000Z"
    })
    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/ack.json",
      JSON.stringify(record)
    )
    expect(await store.isAcknowledged()).toBe(true)
  })
})
