import { describe, expect, it } from "vitest"
import {
  QUIP_BUNDLE_ID,
  classifyAppSensitivity,
  describeSensitiveCategory,
  gateForCategory
} from "./sensitiveApps"

describe("classifyAppSensitivity", () => {
  it("catches system and credential apps by bundle id", () => {
    expect(
      classifyAppSensitivity({
        bundleId: "com.apple.systempreferences",
        name: "System Settings"
      })
    ).toBe("system")
    expect(
      classifyAppSensitivity({
        bundleId: "com.apple.keychainaccess",
        name: "Keychain Access"
      })
    ).toBe("system")
  })

  it("catches terminals and editors with embedded shells", () => {
    for (const bundleId of [
      "com.apple.Terminal",
      "com.googlecode.iterm2",
      "com.microsoft.VSCode",
      "com.todesktop.230313mzl4w4u92"
    ]) {
      expect(classifyAppSensitivity({ bundleId, name: "whatever" })).toBe(
        "terminal"
      )
    }
  })

  it("catches messaging apps", () => {
    for (const bundleId of [
      "net.whatsapp.WhatsApp",
      "com.tinyspeck.slackmacgap",
      "com.apple.MobileSMS",
      "com.hnc.Discord"
    ]) {
      expect(classifyAppSensitivity({ bundleId, name: "whatever" })).toBe(
        "messaging"
      )
    }
  })

  it("falls back to the name when the bundle id is unknown", () => {
    expect(
      classifyAppSensitivity({ bundleId: "com.tinyspeck.slack-beta", name: "Slack (beta)" })
    ).toBe("messaging")
    expect(
      classifyAppSensitivity({ bundleId: "com.example.newshell", name: "Fancy Terminal" })
    ).toBe("terminal")
    expect(
      classifyAppSensitivity({ bundleId: "", name: "1Password 8" })
    ).toBe("system")
  })

  it("leaves ordinary apps alone", () => {
    for (const app of [
      { bundleId: "com.apple.Notes", name: "Notes" },
      { bundleId: "com.apple.Safari", name: "Safari" },
      { bundleId: "com.google.Chrome", name: "Google Chrome" },
      { bundleId: "com.figma.Desktop", name: "Figma" }
    ]) {
      expect(classifyAppSensitivity(app)).toBeNull()
    }
  })

  it("does not flag word fragments", () => {
    // "Gmail" must not trip the /\bmail\b/ rule.
    expect(
      classifyAppSensitivity({ bundleId: "com.example.gmail", name: "Gmail Desktop" })
    ).toBeNull()
  })

  it("never flags Quip itself, which is frontmost while its panel has focus", () => {
    expect(
      classifyAppSensitivity({ bundleId: QUIP_BUNDLE_ID, name: "Quip" })
    ).toBeNull()
  })

  it("treats an unknown app as unclassified rather than sensitive", () => {
    expect(classifyAppSensitivity(null)).toBeNull()
    expect(classifyAppSensitivity(undefined)).toBeNull()
  })

  it("gates terminals and settings on every step, messaging only on transmit", () => {
    expect(gateForCategory("system")).toBe("always")
    expect(gateForCategory("terminal")).toBe("always")
    expect(gateForCategory("messaging")).toBe("transmit")
  })

  it("describes every category", () => {
    expect(describeSensitiveCategory("system")).toMatch(/system/i)
    expect(describeSensitiveCategory("terminal")).toMatch(/terminal/i)
    expect(describeSensitiveCategory("messaging")).toMatch(/messaging/i)
  })
})
