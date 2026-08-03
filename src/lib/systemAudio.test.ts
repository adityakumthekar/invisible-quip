import { describe, expect, it } from "vitest"
import { pickLoopbackDevice } from "./systemAudio"

// enumerateDevices returns MediaDeviceInfo, but only these four fields matter.
const device = (
  deviceId: string,
  label: string,
  kind: MediaDeviceKind = "audioinput"
) => ({ deviceId, label, kind, groupId: "g" }) as MediaDeviceInfo

describe("pickLoopbackDevice", () => {
  const blackhole = device("bh", "BlackHole 2ch")
  const builtIn = device("mic", "MacBook Pro Microphone")

  it("finds a loopback device by label", () => {
    expect(pickLoopbackDevice([builtIn, blackhole], null)).toBe(blackhole)
  })

  it("prefers the saved device when it is still plugged in", () => {
    const other = device("vb", "VB-Cable")
    expect(pickLoopbackDevice([blackhole, other], "vb")).toBe(other)
  })

  it("falls back to label matching when the saved device is gone", () => {
    expect(pickLoopbackDevice([builtIn, blackhole], "unplugged")).toBe(blackhole)
  })

  it("never returns an output device — capture reads from an input", () => {
    const output = device("out", "BlackHole 2ch", "audiooutput")
    expect(pickLoopbackDevice([output, builtIn], null)).toBeNull()
  })

  it("ignores a saved id that names an output device", () => {
    const output = device("out", "BlackHole 2ch", "audiooutput")
    expect(pickLoopbackDevice([output, builtIn], "out")).toBeNull()
  })

  it("returns null when nothing looks like a loopback", () => {
    expect(pickLoopbackDevice([builtIn], null)).toBeNull()
    expect(pickLoopbackDevice([], null)).toBeNull()
  })

  it.each([
    "BlackHole 16ch",
    "Soundflower (2ch)",
    "VB-Cable",
    "VBCable Output",
    "Loopback Audio",
    "Multi-Output Device",
    "Aggregate Device"
  ])("recognises %s", (label) => {
    expect(pickLoopbackDevice([builtIn, device("x", label)], null)?.label).toBe(
      label
    )
  })

  it("does not mistake a normal headset for a loopback", () => {
    const headset = device("h", "AirPods Pro")
    expect(pickLoopbackDevice([headset, builtIn], null)).toBeNull()
  })
})
