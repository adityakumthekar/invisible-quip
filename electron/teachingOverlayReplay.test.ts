import { describe, expect, it, vi } from "vitest"
import { TeachingOverlayReplayCoordinator } from "./teachingOverlayReplay"

const target = {
  instruction: "Click Share.",
  label: "Share",
  target: { x: 100, y: 50, width: 40, height: 20 }
}

describe("TeachingOverlayReplayCoordinator", () => {
  it("replays the first target after the active renderer reports ready", () => {
    const sendTarget = vi.fn()
    const sendClear = vi.fn()
    const replay = new TeachingOverlayReplayCoordinator(sendTarget, sendClear)
    const renderer = {}

    replay.setTarget(target)
    replay.activate(renderer)

    expect(sendTarget).not.toHaveBeenCalled()
    expect(replay.ready(renderer)).toBe(true)
    expect(sendTarget).toHaveBeenCalledOnce()
    expect(sendTarget).toHaveBeenCalledWith(renderer, target)
    expect(sendClear).not.toHaveBeenCalled()
  })

  it("replays only to the active renderer and updates it after readiness", () => {
    const sendTarget = vi.fn()
    const replay = new TeachingOverlayReplayCoordinator(sendTarget, vi.fn())
    const oldRenderer = {}
    const activeRenderer = {}
    replay.setTarget(target)
    replay.activate(activeRenderer)

    expect(replay.ready(oldRenderer)).toBe(false)
    expect(sendTarget).not.toHaveBeenCalled()
    expect(replay.ready(activeRenderer)).toBe(true)

    const nextTarget = {
      ...target,
      instruction: "Choose a window.",
      target: { x: 200, y: 80, width: 50, height: 30 }
    }
    replay.setTarget(nextTarget)
    expect(sendTarget).toHaveBeenLastCalledWith(activeRenderer, nextTarget)
  })

  it("replays clear deterministically and forgets targets after stop", () => {
    const sendTarget = vi.fn()
    const sendClear = vi.fn()
    const replay = new TeachingOverlayReplayCoordinator(sendTarget, sendClear)
    const renderer = {}
    replay.setTarget(target)
    replay.activate(renderer)

    replay.clear()
    replay.ready(renderer)
    expect(sendClear).toHaveBeenCalledWith(renderer)
    expect(sendTarget).not.toHaveBeenCalled()

    replay.deactivate(renderer)
    const reopenedRenderer = {}
    replay.activate(reopenedRenderer)
    replay.ready(reopenedRenderer)
    expect(sendClear).toHaveBeenLastCalledWith(reopenedRenderer)
    expect(sendTarget).not.toHaveBeenCalled()
  })
})
