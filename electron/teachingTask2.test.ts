import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "fs"
import * as llmModule from "./LLMHelper"
import { LLMHelper } from "./LLMHelper"
import * as teachingModule from "./teaching"

// Several cases spy on module-level singletons (fs, LLMHelper internals);
// restore between tests so they can't leak across the file.
afterEach(() => {
  vi.restoreAllMocks()
})

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

    const prompt = buildTeachingPrompt(
      "Share my screen",
      ["[step] Open the Share menu."],
      { width: 2560, height: 1600 }
    )

    expect(prompt).toContain("Share my screen")
    expect(prompt).toContain("[step] Open the Share menu.")
    expect(prompt).toContain("2560×1600")
    expect(prompt).toMatch(/0–1000|0-1000/)
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
      "/tmp/screen.png",
      { width: 2560, height: 1600 }
    )

    expect(result.state).toBe("step")
    expect(result.target).toEqual({ x: 200, y: 100, width: 80, height: 40 })
    const request = generateContent.mock.calls[0][0]
    expect(request.generationConfig).toMatchObject({
      temperature: 0,
      candidateCount: 1
    })
    // gemini-3.5-flash is a thinking model: maxOutputTokens is a TOTAL budget
    // that includes invisible reasoning tokens. It must be large enough that
    // the model can think AND still emit the full JSON without truncation
    // (finishReason MAX_TOKENS). 350 was far too low.
    expect(request.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(1024)
    expect(request.contents[0].parts[0].text).toContain("2560×1600")
    expect(request.contents[0].parts[1]).toEqual({
      inlineData: { data: "png", mimeType: "image/png" }
    })
  })

  it("points at a vision model when the local model cannot see", async () => {
    const helper = new LLMHelper("test-api-key")
    ;(helper as any).useOllama = true
    ;(helper as any).ollamaModel = "llama3.2"
    vi.spyOn(helper as any, "getOllamaModelCapabilities").mockResolvedValue({
      vision: false
    })

    await expect(
      (helper as any).generateTeachingStep("Do a task", [], "/missing.png", {
        width: 100,
        height: 100
      })
    ).rejects.toThrow(/vision model/i)
  })

  it("sends the screenshot to a vision-capable local model and normalizes pixels", async () => {
    const helper = new LLMHelper("test-api-key")
    ;(helper as any).useOllama = true
    ;(helper as any).ollamaModel = "qwen2.5vl:7b"
    vi.spyOn(helper as any, "getOllamaModelCapabilities").mockResolvedValue({
      vision: true
    })
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(
      Buffer.from("png") as any
    )
    const callOllama = vi
      .spyOn(helper as any, "callOllama")
      .mockResolvedValue(
        JSON.stringify({
          state: "step",
          instruction: "Click Share.",
          action: "click",
          // Absolute pixels in a 1000x500 image — half width, half height.
          target: { x: 500, y: 250, width: 100, height: 50 }
        })
      )

    const result = await (helper as any).generateTeachingStep(
      "Do a task",
      [],
      "/shot.png",
      { width: 1000, height: 500 }
    )

    const [prompt, options] = callOllama.mock.calls[0]
    expect(prompt).toContain("absolute pixels")
    expect(options).toMatchObject({ images: ["cG5n"], json: true })
    // Pixels folded back into the canonical 0–1000 space.
    expect(result.target).toEqual({ x: 500, y: 500, width: 100, height: 100 })
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

  it("parses Gemini output wrapped in a markdown code fence", () => {
    const parseTeachingModelText = (llmModule as any).parseTeachingModelText

    const payload = JSON.stringify({
      state: "step",
      instruction: "Click Share.",
      target: { x: 10, y: 20, width: 30, height: 40 }
    })

    for (const fenced of [
      "```json\n" + payload + "\n```",
      "```\n" + payload + "\n```"
    ]) {
      const result = parseTeachingModelText(fenced)
      expect(result.state).toBe("step")
      expect(result.instruction).toBe("Click Share.")
      expect(result.target).toEqual({ x: 10, y: 20, width: 30, height: 40 })
    }
  })
})

describe("teaching action schema (click + type)", () => {
  const parseTeachingResponse = (raw: unknown) =>
    (teachingModule as any).parseTeachingResponse(raw)

  it("defaults a step's action to click when the model omits it", () => {
    const step = parseTeachingResponse({
      state: "step",
      instruction: "Click Share.",
      target: { x: 10, y: 20 }
    })
    expect(step.action).toBe("click")
    expect(step.text).toBeUndefined()
  })

  it("accepts a type action with text", () => {
    const step = parseTeachingResponse({
      state: "step",
      instruction: "Type the search query.",
      action: "type",
      text: "discover weekly",
      target: { x: 10, y: 20 }
    })
    expect(step.action).toBe("type")
    expect(step.text).toBe("discover weekly")
  })

  it("rejects a type action without text", () => {
    expect(() =>
      parseTeachingResponse({
        state: "step",
        instruction: "Type something.",
        action: "type",
        target: { x: 10, y: 20 }
      })
    ).toThrow(/text/i)
  })

  it("rejects text on a click action", () => {
    expect(() =>
      parseTeachingResponse({
        state: "step",
        instruction: "Click it.",
        action: "click",
        text: "nope",
        target: { x: 10, y: 20 }
      })
    ).toThrow(/text/i)
  })

  it("rejects an unknown action value", () => {
    expect(() =>
      parseTeachingResponse({
        state: "step",
        instruction: "Scroll down.",
        action: "scroll",
        target: { x: 10, y: 20 }
      })
    ).toThrow(/action/i)
  })

  it("rejects action or text on a terminal state", () => {
    expect(() =>
      parseTeachingResponse({
        state: "complete",
        instruction: "All done.",
        action: "click"
      })
    ).toThrow(/action/i)
  })
})

describe("dipRectCenter", () => {
  it("returns the center point of a DIP rect", () => {
    const dipRectCenter = (teachingModule as any).dipRectCenter
    expect(dipRectCenter({ x: 10, y: 20, width: 40, height: 60 })).toEqual({
      x: 30,
      y: 50
    })
  })
})

describe("normalizedTeachingTargetToPixels", () => {
  it("scales Gemini 0–1000 coords into screenshot pixels", () => {
    const normalizedTeachingTargetToPixels = (teachingModule as any)
      .normalizedTeachingTargetToPixels

    expect(
      normalizedTeachingTargetToPixels(
        { x: 250, y: 500, width: 100, height: 50 },
        2000,
        1000
      )
    ).toEqual({ x: 500, y: 500, width: 200, height: 50 })
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
      action: "click",
      target: { x: 200, y: 100, width: 80, height: 40 }
    }),
    remove = vi.fn().mockResolvedValue(undefined),
    actuate?: ReturnType<typeof vi.fn>
  ) {
    let captureNumber = 0
    const capture = vi.fn(async () => ({
      path: `/tmp/teaching-${++captureNumber}.png`,
      display
    }))
    const Coordinator = (teachingModule as any).TeachingSessionCoordinator
    return {
      coordinator: new Coordinator({ capture, generate, remove, actuate }),
      capture,
      generate,
      remove,
      actuate
    }
  }

  it("starts a session, maps normalized targets to display DIP, and cleans up", async () => {
    const { coordinator, generate, remove } = makeCoordinator()

    const result = await coordinator.start("  Share my screen  ")

    expect(generate).toHaveBeenCalledWith(
      "Share my screen",
      [],
      "/tmp/teaching-1.png",
      { width: 2560, height: 1600 }
    )
    // Mock target {200,100,80,40} is 0–1000 space on a 2560×1600 PNG /
    // 1280×800 DIP display at (1440, -100).
    expect(result).toEqual({
      state: "step",
      instruction: "Click Share.",
      action: "click",
      target: { x: 1696, y: -20, width: 102.4, height: 32 },
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

  it("actuates a pending click at the target center, then advances", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        state: "step",
        instruction: "Click Share.",
        action: "click",
        target: { x: 200, y: 100, width: 80, height: 40 }
      })
      .mockResolvedValueOnce({ state: "complete", instruction: "Shared." })
    const actuate = vi.fn().mockResolvedValue(undefined)
    const { coordinator } = makeCoordinator(generate, undefined, actuate)

    await coordinator.start("Share my screen")
    const result = await coordinator.execute()

    expect(actuate).toHaveBeenCalledWith({
      action: "click",
      point: { x: 1747.2, y: -4 }
    })
    expect(result).toMatchObject({ state: "complete", instruction: "Shared." })
  })

  it("actuates a pending type action with click-to-focus then text", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        state: "step",
        instruction: "Type the query.",
        action: "type",
        text: "discover weekly",
        target: { x: 200, y: 100, width: 80, height: 40 }
      })
      .mockResolvedValueOnce({ state: "complete", instruction: "Typed." })
    const actuate = vi.fn().mockResolvedValue(undefined)
    const { coordinator } = makeCoordinator(generate, undefined, actuate)

    await coordinator.start("Search")
    await coordinator.execute()

    expect(actuate).toHaveBeenCalledWith({
      action: "type",
      point: { x: 1747.2, y: -4 },
      text: "discover weekly"
    })
  })

  it("rejects execute without an active session", async () => {
    const { coordinator, actuate } = makeCoordinator(
      undefined,
      undefined,
      vi.fn()
    )
    await expect(coordinator.execute()).rejects.toThrow(
      /no active teaching session/i
    )
    expect(actuate).not.toHaveBeenCalled()
  })

  it("rejects execute when the pending step is terminal", async () => {
    const generate = vi
      .fn()
      .mockResolvedValue({ state: "complete", instruction: "Done." })
    const actuate = vi.fn()
    const { coordinator } = makeCoordinator(generate, undefined, actuate)
    await coordinator.start("Anything")

    await expect(coordinator.execute()).rejects.toThrow(/no teaching action/i)
    expect(actuate).not.toHaveBeenCalled()
  })

  it("rejects execute when input automation is unavailable", async () => {
    const { coordinator } = makeCoordinator()
    await coordinator.start("Share my screen")
    await expect(coordinator.execute()).rejects.toThrow(/input automation/i)
  })
})
