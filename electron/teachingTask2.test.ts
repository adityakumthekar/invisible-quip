import { describe, expect, it, vi } from "vitest"
import * as llmModule from "./LLMHelper"
import { LLMHelper } from "./LLMHelper"
import * as teachingModule from "./teaching"

const display = {
  displayId: 7,
  bounds: { x: 1440, y: -100, width: 1280, height: 800 },
  scaleFactor: 2,
  screenshotWidth: 2560,
  screenshotHeight: 1600
}

describe("teaching prompt and model response", () => {
  it("asks for exactly one concise instruction and the strict teaching schema", () => {
    const buildTeachingPrompt = (llmModule as any).buildTeachingPrompt

    const prompt = buildTeachingPrompt("Share my screen", [
      "[step] Open the Share menu."
    ])

    expect(prompt).toContain("Share my screen")
    expect(prompt).toContain("[step] Open the Share menu.")
    expect(prompt).toMatch(/exactly one concise instruction/i)
    expect(prompt).toContain('"state": "step" | "complete" | "blocked"')
    expect(prompt).toMatch(/target.*only.*step/is)
    expect(prompt).toMatch(/return only.*json/is)
  })

  it("uses deterministic Gemini generation with the screenshot and validates JSON", async () => {
    const helper = new LLMHelper("test-api-key")
    const generateContent = vi.fn().mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            state: "step",
            instruction: "Click Share.",
            target: { x: 200, y: 100, width: 80, height: 40 }
          })
      }
    })
    ;(helper as any).model = { generateContent }
    ;(helper as any).fileToGenerativePart = vi.fn().mockResolvedValue({
      inlineData: { data: "png", mimeType: "image/png" }
    })

    const result = await (helper as any).generateTeachingStep(
      "Share my screen",
      ["[step] Open Zoom."],
      "/tmp/screen.png"
    )

    expect(result.state).toBe("step")
    expect(result.target).toEqual({ x: 200, y: 100, width: 80, height: 40 })
    const request = generateContent.mock.calls[0][0]
    expect(request.generationConfig).toMatchObject({
      temperature: 0,
      candidateCount: 1
    })
    expect(request.contents[0].parts[1]).toEqual({
      inlineData: { data: "png", mimeType: "image/png" }
    })
  })

  it("rejects Ollama teaching with a user-safe message", async () => {
    const helper = new LLMHelper("test-api-key")
    ;(helper as any).useOllama = true

    await expect(
      (helper as any).generateTeachingStep("Do a task", [], "/missing.png")
    ).rejects.toThrow(/teaching.*gemini/i)
  })

  it("rejects malformed or contract-invalid Gemini output", async () => {
    const parseTeachingModelText = (llmModule as any).parseTeachingModelText

    expect(() => parseTeachingModelText("not json")).toThrow(/json/i)
    expect(() =>
      parseTeachingModelText(
        JSON.stringify({ state: "step", instruction: "Click it." })
      )
    ).toThrow(/target/i)
  })
})

describe("teaching capture metadata", () => {
  it("combines Electron display data with actual PNG dimensions", () => {
    const createTeachingDisplayCaptureInfo = (teachingModule as any)
      .createTeachingDisplayCaptureInfo

    expect(
      createTeachingDisplayCaptureInfo(
        {
          id: 7,
          bounds: { x: 1440, y: -100, width: 1280, height: 800 },
          scaleFactor: 2
        },
        { width: 2560, height: 1600 }
      )
    ).toEqual(display)
  })

  it("rejects PNG metadata without usable dimensions", () => {
    const createTeachingDisplayCaptureInfo = (teachingModule as any)
      .createTeachingDisplayCaptureInfo

    expect(() =>
      createTeachingDisplayCaptureInfo(
        {
          id: 7,
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          scaleFactor: 1
        },
        { width: undefined, height: 100 }
      )
    ).toThrow(/dimensions/i)
  })
})

describe("TeachingSessionCoordinator", () => {
  const staleSessionMessage =
    "Teaching session changed before this step completed. Please try again."
  const operationInProgressMessage =
    "A teaching step is already in progress. Please wait."

  function makeCoordinator(
    generate = vi.fn().mockResolvedValue({
      state: "step",
      instruction: "Click Share.",
      target: { x: 200, y: 100, width: 80, height: 40 }
    }),
    remove = vi.fn().mockResolvedValue(undefined)
  ) {
    let captureNumber = 0
    const capture = vi.fn(async () => ({
      path: `/tmp/teaching-${++captureNumber}.png`,
      display
    }))
    const Coordinator = (teachingModule as any).TeachingSessionCoordinator
    return {
      coordinator: new Coordinator({ capture, generate, remove }),
      capture,
      generate,
      remove
    }
  }

  it("starts a session, maps target pixels to display DIP, and cleans up", async () => {
    const { coordinator, generate, remove } = makeCoordinator()

    const result = await coordinator.start("  Share my screen  ")

    expect(generate).toHaveBeenCalledWith(
      "Share my screen",
      [],
      "/tmp/teaching-1.png"
    )
    expect(result).toEqual({
      state: "step",
      instruction: "Click Share.",
      target: { x: 1540, y: -50, width: 40, height: 20 },
      displayId: 7,
      displayBounds: display.bounds
    })
    expect(remove).toHaveBeenCalledWith("/tmp/teaching-1.png")
  })

  it("rejects next without an active session before capturing", async () => {
    const { coordinator, capture } = makeCoordinator()

    await expect(coordinator.next()).rejects.toThrow(/no active teaching session/i)
    expect(capture).not.toHaveBeenCalled()
  })

  it("captures each next step and caps prior step summaries", async () => {
    const { coordinator, capture, generate } = makeCoordinator()
    await coordinator.start("Share my screen")

    for (let index = 0; index < 10; index += 1) {
      await coordinator.next()
    }

    expect(capture).toHaveBeenCalledTimes(11)
    const finalHistory = generate.mock.calls.at(-1)?.[1]
    expect(finalHistory).toHaveLength(8)
    expect(finalHistory.every((item: string) => item === "[step] Click Share."))
      .toBe(true)
  })

  it("stop clears the session", async () => {
    const { coordinator } = makeCoordinator()
    await coordinator.start("Share my screen")

    coordinator.stop()

    await expect(coordinator.next()).rejects.toThrow(/no active teaching session/i)
  })

  it("rejects an in-flight next step invalidated by stop", async () => {
    let resolveNext:
      | ((step: {
          state: "step"
          instruction: string
          target: { x: number; y: number }
        }) => void)
      | undefined
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        state: "step",
        instruction: "Click Share.",
        target: { x: 200, y: 100 }
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNext = resolve
          })
      )
    const { coordinator } = makeCoordinator(generate)
    await coordinator.start("Share my screen")

    const pendingNext = coordinator.next()
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
    coordinator.stop()
    resolveNext?.({
      state: "step",
      instruction: "Choose a window.",
      target: { x: 300, y: 200 }
    })

    await expect(pendingNext).rejects.toThrow(staleSessionMessage)
    await expect(coordinator.next()).rejects.toThrow(/no active teaching session/i)
  })

  it("rejects an in-flight start invalidated by stop", async () => {
    let resolveStart:
      | ((step: {
          state: "step"
          instruction: string
          target: { x: number; y: number }
        }) => void)
      | undefined
    const generate = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        })
    )
    const { coordinator } = makeCoordinator(generate)

    const pendingStart = coordinator.start("Share my screen")
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    coordinator.stop()
    resolveStart?.({
      state: "step",
      instruction: "Click Share.",
      target: { x: 200, y: 100 }
    })

    await expect(pendingStart).rejects.toThrow(staleSessionMessage)
    await expect(coordinator.next()).rejects.toThrow(/no active teaching session/i)
  })

  it("rejects an in-flight next step replaced by a new start", async () => {
    let resolveOldNext:
      | ((step: {
          state: "step"
          instruction: string
          target: { x: number; y: number }
        }) => void)
      | undefined
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        state: "step",
        instruction: "Click Share.",
        target: { x: 200, y: 100 }
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldNext = resolve
          })
      )
      .mockResolvedValueOnce({
        state: "step",
        instruction: "Open Settings.",
        target: { x: 400, y: 300 }
      })
      .mockResolvedValueOnce({
        state: "complete",
        instruction: "Settings are open."
      })
    const { coordinator } = makeCoordinator(generate)
    await coordinator.start("Share my screen")

    const pendingOldNext = coordinator.next()
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
    await expect(coordinator.start("Open settings")).resolves.toMatchObject({
      instruction: "Open Settings."
    })
    resolveOldNext?.({
      state: "step",
      instruction: "Choose a window.",
      target: { x: 300, y: 200 }
    })

    await expect(pendingOldNext).rejects.toThrow(staleSessionMessage)
    await coordinator.next()
    expect(generate.mock.calls.at(-1)?.[0]).toBe("Open settings")
  })

  it("rejects an in-flight start replaced by another start", async () => {
    let resolveOldStart:
      | ((step: {
          state: "step"
          instruction: string
          target: { x: number; y: number }
        }) => void)
      | undefined
    const generate = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldStart = resolve
          })
      )
      .mockResolvedValueOnce({
        state: "step",
        instruction: "Open Settings.",
        target: { x: 400, y: 300 }
      })
      .mockResolvedValueOnce({
        state: "complete",
        instruction: "Settings are open."
      })
    const { coordinator } = makeCoordinator(generate)

    const pendingOldStart = coordinator.start("Share my screen")
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    await coordinator.start("Open settings")
    resolveOldStart?.({
      state: "step",
      instruction: "Click Share.",
      target: { x: 200, y: 100 }
    })

    await expect(pendingOldStart).rejects.toThrow(staleSessionMessage)
    await coordinator.next()
    expect(generate.mock.calls.at(-1)?.[0]).toBe("Open settings")
  })

  it("deterministically rejects a concurrent next before capturing", async () => {
    let resolveNext:
      | ((step: {
          state: "step"
          instruction: string
          target: { x: number; y: number }
        }) => void)
      | undefined
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        state: "step",
        instruction: "Click Share.",
        target: { x: 200, y: 100 }
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNext = resolve
          })
      )
    const { coordinator, capture } = makeCoordinator(generate)
    await coordinator.start("Share my screen")

    const pendingNext = coordinator.next()
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2))

    await expect(coordinator.next()).rejects.toThrow(operationInProgressMessage)
    expect(capture).toHaveBeenCalledTimes(2)

    resolveNext?.({
      state: "step",
      instruction: "Choose a window.",
      target: { x: 300, y: 200 }
    })
    await expect(pendingNext).resolves.toMatchObject({
      instruction: "Choose a window."
    })
  })

  it("clears the previous session when a replacement start fails", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        state: "step",
        instruction: "Click Share.",
        target: { x: 200, y: 100 }
      })
      .mockRejectedValueOnce(new Error("Gemini failed"))
    const { coordinator } = makeCoordinator(generate)
    await coordinator.start("Share my screen")

    await expect(coordinator.start("Open settings")).rejects.toThrow(
      "Gemini failed"
    )

    await expect(coordinator.next()).rejects.toThrow(/no active teaching session/i)
  })

  it("cleans up the temporary screenshot when generation fails", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("Gemini failed"))
    const { coordinator, remove } = makeCoordinator(generate)

    await expect(coordinator.start("Share my screen")).rejects.toThrow(
      "Gemini failed"
    )
    expect(remove).toHaveBeenCalledWith("/tmp/teaching-1.png")
  })

  it("logs cleanup failure while preserving a successful result", async () => {
    const remove = vi.fn().mockRejectedValue(new Error("unlink failed"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { coordinator } = makeCoordinator(undefined, remove)

    await expect(coordinator.start("Share my screen")).resolves.toMatchObject({
      instruction: "Click Share."
    })
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to delete temporary teaching screenshot:",
      expect.any(Error)
    )

    consoleError.mockRestore()
  })

  it("logs cleanup failure while preserving the generation error", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("Gemini failed"))
    const remove = vi.fn().mockRejectedValue(new Error("unlink failed"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { coordinator } = makeCoordinator(generate, remove)

    await expect(coordinator.start("Share my screen")).rejects.toThrow(
      "Gemini failed"
    )
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to delete temporary teaching screenshot:",
      expect.any(Error)
    )

    consoleError.mockRestore()
  })
})
