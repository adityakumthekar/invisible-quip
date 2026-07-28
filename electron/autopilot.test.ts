import { describe, expect, it, vi } from "vitest"
import { AutopilotCoordinator, type AutopilotUpdate } from "./autopilot"
import type { FrontmostApp } from "./frontmostApp"
import type { TeachingResult, TeachingStepResult } from "./teaching"

const displayBounds = { x: 0, y: 0, width: 1440, height: 900 }

function step(overrides: Partial<TeachingStepResult> = {}): TeachingStepResult {
  return {
    state: "step",
    instruction: "Open the Files panel.",
    action: "click",
    risk: "safe",
    target: { x: 100, y: 100, width: 20, height: 20 },
    displayId: 1,
    displayBounds,
    ...overrides
  }
}

const complete: TeachingResult = {
  state: "complete",
  instruction: "All done.",
  displayId: 1,
  displayBounds
}

const blocked: TeachingResult = {
  state: "blocked",
  instruction: "Nothing actionable is visible.",
  displayId: 1,
  displayBounds
}

/** Queue entries: a result to return, or an Error for next() to throw. */
type Scripted = TeachingResult | Error

const notesApp: FrontmostApp = { bundleId: "com.apple.notes", name: "Notes" }
const slackApp: FrontmostApp = {
  bundleId: "com.tinyspeck.slackmacgap",
  name: "Slack"
}
const terminalApp: FrontmostApp = {
  bundleId: "com.apple.Terminal",
  name: "Terminal"
}

interface HarnessOptions {
  /** Frontmost app per probe call; the last entry sticks once exhausted. */
  apps?: (FrontmostApp | null)[]
  appProbeSupported?: boolean
}

function makeHarness(script: Scripted[], options: HarnessOptions = {}) {
  const queue = [...script]
  const updates: AutopilotUpdate[] = []
  const notes: string[] = []

  const take = (): TeachingResult => {
    const entry = queue.shift()
    if (entry === undefined) {
      return complete
    }
    if (entry instanceof Error) {
      throw entry
    }
    return entry
  }

  const session = {
    start: vi.fn(async () => take()),
    next: vi.fn(async () => take()),
    actuatePending: vi.fn(async () => {}),
    noteHistory: vi.fn((entry: string) => {
      notes.push(entry)
    }),
    stop: vi.fn()
  }

  const showTarget = vi.fn()
  const clearTarget = vi.fn()
  const sleeps: number[] = []

  const appQueue = [...(options.apps ?? [notesApp])]
  let currentApp: FrontmostApp | null = appQueue[0] ?? null
  const getFrontmostApp = vi.fn(async () => {
    if (appQueue.length > 0) {
      currentApp = appQueue.shift() ?? null
    }
    return currentApp
  })

  const coordinator = new AutopilotCoordinator({
    session,
    getProvider: () => "gemini",
    showTarget,
    clearTarget,
    emit: (update) => updates.push({ ...update }),
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    getFrontmostApp,
    appProbeSupported: options.appProbeSupported ?? true
  })

  const phases = () => updates.map((update) => update.phase)
  const last = () => updates[updates.length - 1]

  return {
    coordinator,
    session,
    updates,
    notes,
    showTarget,
    clearTarget,
    sleeps,
    getFrontmostApp,
    phases,
    last
  }
}

describe("AutopilotCoordinator", () => {
  it("runs safe steps unattended until the model reports complete", async () => {
    const harness = makeHarness([step(), step(), complete])

    await harness.coordinator.start("do the thing", "gemini")

    expect(harness.session.actuatePending).toHaveBeenCalledTimes(2)
    expect(harness.last().phase).toBe("complete")
    expect(harness.last().stopReason).toMatch(/finished/i)
    expect(harness.coordinator.isRunning()).toBe(false)
  })

  it("clears the highlight before every actuation", async () => {
    const harness = makeHarness([step(), complete])
    const order: string[] = []
    harness.clearTarget.mockImplementation(() => order.push("clear"))
    harness.session.actuatePending.mockImplementation(async () => {
      order.push("actuate")
    })

    await harness.coordinator.start("goal", "gemini")

    expect(order.indexOf("clear")).toBeLessThan(order.indexOf("actuate"))
  })

  it("settles between acting and the next capture", async () => {
    const harness = makeHarness([step(), complete])

    await harness.coordinator.start("goal", "gemini", { settleMs: 550 })

    expect(harness.sleeps).toContain(550)
  })

  it("reports blocked without actuating", async () => {
    const harness = makeHarness([blocked])

    await harness.coordinator.start("goal", "gemini")

    expect(harness.session.actuatePending).not.toHaveBeenCalled()
    expect(harness.last().phase).toBe("blocked")
  })

  it("pauses on a risky step and proceeds once confirmed", async () => {
    const harness = makeHarness([
      step({ action: "type", text: "hello", instruction: "Type a greeting." }),
      complete
    ])

    const run = harness.coordinator.start("goal", "gemini")
    await vi.waitFor(() =>
      expect(harness.coordinator.isAwaitingConfirmation()).toBe(true)
    )

    expect(harness.session.actuatePending).not.toHaveBeenCalled()
    const pause = harness.updates.find(
      (update) => update.phase === "awaiting-confirmation"
    )
    expect(pause?.reasons?.join(" ")).toMatch(/type/i)

    harness.coordinator.confirm()
    await run

    expect(harness.session.actuatePending).toHaveBeenCalledTimes(1)
    expect(harness.last().phase).toBe("complete")
  })

  it("skips a declined step, tells the model, and does not actuate it", async () => {
    const harness = makeHarness([
      step({ action: "type", text: "hello", instruction: "Type a greeting." }),
      complete
    ])

    const run = harness.coordinator.start("goal", "gemini")
    await vi.waitFor(() =>
      expect(harness.coordinator.isAwaitingConfirmation()).toBe(true)
    )

    harness.coordinator.reject()
    await run

    expect(harness.session.actuatePending).not.toHaveBeenCalled()
    expect(harness.notes[0]).toMatch(/declined/i)
    expect(harness.last().phase).toBe("complete")
  })

  it("stops immediately when aborted while awaiting confirmation", async () => {
    const harness = makeHarness([
      step({ action: "type", text: "hi" }),
      step(),
      complete
    ])

    const run = harness.coordinator.start("goal", "gemini")
    await vi.waitFor(() =>
      expect(harness.coordinator.isAwaitingConfirmation()).toBe(true)
    )

    harness.coordinator.stop()
    await run

    expect(harness.session.actuatePending).not.toHaveBeenCalled()
    expect(harness.session.stop).toHaveBeenCalled()
    expect(harness.phases()).toContain("stopped")
    expect(harness.coordinator.isRunning()).toBe(false)
  })

  it("stops at the step budget", async () => {
    // Targets must move, or the stall detector stops the run first.
    const harness = makeHarness(
      Array.from({ length: 20 }, (_, index) =>
        step({ target: { x: index * 50, y: 100, width: 20, height: 20 } })
      )
    )

    await harness.coordinator.start("goal", "gemini", { maxSteps: 3 })

    expect(harness.session.actuatePending).toHaveBeenCalledTimes(3)
    expect(harness.last().phase).toBe("stopped")
    expect(harness.last().stopReason).toMatch(/step limit/i)
  })

  it("stops when the same action repeats with no effect", async () => {
    const identical = () =>
      step({ target: { x: 100, y: 100, width: 20, height: 20 } })
    const harness = makeHarness([
      identical(),
      identical(),
      identical(),
      identical()
    ])

    await harness.coordinator.start("goal", "gemini", { maxRepeats: 2 })

    expect(harness.last().phase).toBe("stopped")
    expect(harness.last().stopReason).toMatch(/stopped responding/i)
    expect(harness.session.actuatePending).toHaveBeenCalledTimes(2)
  })

  it("does not count a moved target as a repeat", async () => {
    const harness = makeHarness([
      step({ target: { x: 100, y: 100, width: 10, height: 10 } }),
      step({ target: { x: 400, y: 300, width: 10, height: 10 } }),
      step({ target: { x: 700, y: 500, width: 10, height: 10 } }),
      complete
    ])

    await harness.coordinator.start("goal", "gemini", { maxRepeats: 2 })

    expect(harness.last().phase).toBe("complete")
    expect(harness.session.actuatePending).toHaveBeenCalledTimes(3)
  })

  it("retries a failed generate before giving up", async () => {
    const harness = makeHarness([
      step(),
      new Error("503 model overloaded"),
      complete
    ])

    await harness.coordinator.start("goal", "gemini", {
      maxConsecutiveErrors: 3
    })

    expect(harness.last().phase).toBe("complete")
  })

  it("stops after consecutive generate failures", async () => {
    const harness = makeHarness([
      step(),
      new Error("503 model overloaded"),
      new Error("503 model overloaded")
    ])

    await harness.coordinator.start("goal", "gemini", {
      maxConsecutiveErrors: 2
    })

    expect(harness.last().phase).toBe("error")
    expect(harness.last().error).toMatch(/overloaded/i)
    expect(harness.last().stopReason).toMatch(/repeated errors/i)
  })

  it("surfaces an actuation failure and halts the run", async () => {
    const harness = makeHarness([step(), step(), complete])
    harness.session.actuatePending.mockRejectedValueOnce(
      new Error("Input control blocked by macOS.")
    )

    await harness.coordinator.start("goal", "gemini")

    expect(harness.last().phase).toBe("error")
    expect(harness.last().error).toMatch(/blocked by macos/i)
    expect(harness.session.actuatePending).toHaveBeenCalledTimes(1)
  })

  it("treats wait as a pause, not an action", async () => {
    const harness = makeHarness([
      step({ action: "wait", instruction: "Let the page load." }),
      complete
    ])

    await harness.coordinator.start("goal", "gemini", { waitMs: 1500 })

    expect(harness.session.actuatePending).not.toHaveBeenCalled()
    expect(harness.sleeps).toContain(1500)
    expect(harness.last().stepIndex).toBe(0)
  })

  it("applies the stricter local-provider bar", async () => {
    const harness = makeHarness([step({ action: "double-click" }), complete])

    const run = harness.coordinator.start("goal", "ollama")
    await vi.waitFor(() =>
      expect(harness.coordinator.isAwaitingConfirmation()).toBe(true)
    )

    const pause = harness.updates.find(
      (update) => update.phase === "awaiting-confirmation"
    )
    expect(pause?.reasons?.join(" ")).toMatch(/local models/i)

    harness.coordinator.confirm()
    await run
  })

  it("stops for confirmation on every step while a terminal is in front", async () => {
    const harness = makeHarness([step(), complete], { apps: [terminalApp] })

    const run = harness.coordinator.start("goal", "gemini")
    await vi.waitFor(() =>
      expect(harness.coordinator.isAwaitingConfirmation()).toBe(true)
    )

    expect(harness.session.actuatePending).not.toHaveBeenCalled()
    const pause = harness.updates.find(
      (update) => update.phase === "awaiting-confirmation"
    )
    expect(pause?.reasons?.join(" ")).toMatch(/terminal/i)

    harness.coordinator.confirm()
    await run

    expect(harness.session.actuatePending).toHaveBeenCalledTimes(1)
  })

  it("navigates a messaging app unattended", async () => {
    const harness = makeHarness([step(), step({ action: "scroll" }), complete], {
      apps: [slackApp]
    })

    await harness.coordinator.start("find the thread", "gemini")

    expect(harness.phases()).not.toContain("awaiting-confirmation")
    expect(harness.session.actuatePending).toHaveBeenCalledTimes(2)
  })

  it("stops before a keypress that could send in a messaging app", async () => {
    const harness = makeHarness(
      [step({ action: "key", key: "enter", instruction: "Press Return." }), complete],
      { apps: [slackApp] }
    )

    const run = harness.coordinator.start("goal", "gemini")
    await vi.waitFor(() =>
      expect(harness.coordinator.isAwaitingConfirmation()).toBe(true)
    )

    expect(harness.session.actuatePending).not.toHaveBeenCalled()
    const pause = harness.updates.find(
      (update) => update.phase === "awaiting-confirmation"
    )
    expect(pause?.reasons?.join(" ")).toMatch(/slack/i)

    harness.coordinator.confirm()
    await run

    expect(harness.session.actuatePending).toHaveBeenCalledTimes(1)
  })

  it("asks again when focus moves to a sensitive app during the confirmation", async () => {
    // Probes: classify (Notes, safe → but "type" pauses anyway), re-check after
    // confirm (Slack → ask again), re-check after the second confirm (Slack).
    const harness = makeHarness(
      [step({ action: "type", text: "hello", instruction: "Type a greeting." }), complete],
      { apps: [notesApp, slackApp, slackApp] }
    )

    const run = harness.coordinator.start("goal", "gemini")
    await vi.waitFor(() =>
      expect(harness.coordinator.isAwaitingConfirmation()).toBe(true)
    )

    harness.coordinator.confirm()
    await vi.waitFor(() =>
      expect(harness.coordinator.isAwaitingConfirmation()).toBe(true)
    )

    expect(harness.session.actuatePending).not.toHaveBeenCalled()
    const pauses = harness.updates.filter(
      (update) => update.phase === "awaiting-confirmation"
    )
    expect(pauses).toHaveLength(2)
    expect(pauses[1]?.reasons?.join(" ")).toMatch(/focus moved to slack/i)

    harness.coordinator.confirm()
    await run

    expect(harness.session.actuatePending).toHaveBeenCalledTimes(1)
  })

  it("runs unattended when the frontmost app is unremarkable", async () => {
    const harness = makeHarness([step(), complete], { apps: [notesApp] })

    await harness.coordinator.start("goal", "gemini")

    expect(harness.session.actuatePending).toHaveBeenCalledTimes(1)
    expect(harness.phases()).not.toContain("awaiting-confirmation")
  })

  it("asks before committing when the probe can't name the frontmost app", async () => {
    const harness = makeHarness(
      [step({ action: "key", key: "enter", instruction: "Press Return." }), complete],
      { apps: [null] }
    )

    const run = harness.coordinator.start("goal", "gemini")
    await vi.waitFor(() =>
      expect(harness.coordinator.isAwaitingConfirmation()).toBe(true)
    )

    const pause = harness.updates.find(
      (update) => update.phase === "awaiting-confirmation"
    )
    expect(pause?.reasons?.join(" ")).toMatch(/couldn't tell which app/i)

    harness.coordinator.confirm()
    await run
  })

  it("does not ask about the app on platforms with no probe", async () => {
    const harness = makeHarness([step(), complete], {
      apps: [null],
      appProbeSupported: false
    })

    await harness.coordinator.start("goal", "gemini")

    expect(harness.phases()).not.toContain("awaiting-confirmation")
    expect(harness.session.actuatePending).toHaveBeenCalledTimes(1)
  })

  it("reports a failure to start", async () => {
    const harness = makeHarness([])
    harness.session.start.mockRejectedValueOnce(new Error("Screen access is off"))

    await harness.coordinator.start("goal", "gemini")

    expect(harness.last().phase).toBe("error")
    expect(harness.last().error).toMatch(/screen access/i)
  })

  it("rejects an empty goal", async () => {
    const harness = makeHarness([])

    await expect(harness.coordinator.start("   ", "gemini")).rejects.toThrow(
      /goal is required/i
    )
  })

  it("counts actuated steps in its updates", async () => {
    const harness = makeHarness([step(), step(), complete])

    await harness.coordinator.start("goal", "gemini", { maxSteps: 9 })

    expect(harness.last().stepIndex).toBe(2)
    expect(harness.last().maxSteps).toBe(9)
  })
})
