import { describe, expect, it, vi } from "vitest"
import { streamChat, type ChatStreamApi } from "./chatStream"

/**
 * A fake of the preload bridge that lets a test drive the stream events by
 * hand, and records the requestId main would have been handed.
 */
function makeApi() {
  const listeners = {
    chunk: [] as Array<(d: { requestId: string; delta: string }) => void>,
    done: [] as Array<(d: { requestId: string; text: string }) => void>,
    error: [] as Array<(d: { requestId: string; message: string }) => void>
  }
  let requestId = ""
  const invoke = vi.fn(async (_channel: string, id: string) => {
    requestId = id
    return undefined
  })

  const api: ChatStreamApi = {
    onChatStreamChunk: (cb) => {
      listeners.chunk.push(cb)
      return () => {
        listeners.chunk = listeners.chunk.filter((l) => l !== cb)
      }
    },
    onChatStreamDone: (cb) => {
      listeners.done.push(cb)
      return () => {
        listeners.done = listeners.done.filter((l) => l !== cb)
      }
    },
    onChatStreamError: (cb) => {
      listeners.error.push(cb)
      return () => {
        listeners.error = listeners.error.filter((l) => l !== cb)
      }
    },
    invoke
  }

  return {
    api,
    invoke,
    listeners,
    id: () => requestId,
    emitChunk: (delta: string, id = requestId) =>
      listeners.chunk.forEach((l) => l({ requestId: id, delta })),
    emitDone: (text: string, id = requestId) =>
      listeners.done.forEach((l) => l({ requestId: id, text })),
    emitError: (message: string, id = requestId) =>
      listeners.error.forEach((l) => l({ requestId: id, message }))
  }
}

// Flush synchronously so tests don't depend on animation frames.
const immediate = (flush: () => void) => flush()

describe("streamChat", () => {
  it("reports growing text as chunks arrive and resolves with the full answer", async () => {
    const harness = makeApi()
    const seen: string[] = []

    const promise = streamChat(harness.api, "gemini-chat-stream", ["hi"], {
      onText: (text) => seen.push(text),
      scheduler: immediate
    })
    await Promise.resolve()

    harness.emitChunk("Hel")
    harness.emitChunk("lo ")
    harness.emitChunk("there")
    harness.emitDone("Hello there")

    await expect(promise).resolves.toBe("Hello there")
    expect(seen).toEqual(["Hel", "Hello ", "Hello there", "Hello there"])
  })

  it("passes the requestId ahead of the caller's args", async () => {
    const harness = makeApi()
    const promise = streamChat(harness.api, "chat-with-screen-stream", ["look"], {
      onText: () => {},
      scheduler: immediate
    })
    await Promise.resolve()

    expect(harness.invoke).toHaveBeenCalledWith(
      "chat-with-screen-stream",
      harness.id(),
      "look"
    )
    harness.emitDone("done")
    await promise
  })

  it("ignores events belonging to a different request", async () => {
    const harness = makeApi()
    const seen: string[] = []
    const promise = streamChat(harness.api, "gemini-chat-stream", ["hi"], {
      onText: (text) => seen.push(text),
      scheduler: immediate
    })
    await Promise.resolve()

    harness.emitChunk("stale", "some-other-request")
    harness.emitChunk("mine")
    harness.emitDone("mine")

    await promise
    expect(seen).toEqual(["mine", "mine"])
  })

  it("coalesces chunks that land within one frame", async () => {
    const harness = makeApi()
    const seen: string[] = []
    let queued: (() => void) | null = null

    const promise = streamChat(harness.api, "gemini-chat-stream", ["hi"], {
      onText: (text) => seen.push(text),
      scheduler: (flush) => {
        queued = flush
      }
    })
    await Promise.resolve()

    harness.emitChunk("a")
    harness.emitChunk("b")
    harness.emitChunk("c")
    expect(seen).toEqual([])

    queued!()
    expect(seen).toEqual(["abc"])

    harness.emitDone("abc")
    await promise
  })

  it("rejects with the message from a stream error", async () => {
    const harness = makeApi()
    const promise = streamChat(harness.api, "gemini-chat-stream", ["hi"], {
      onText: () => {},
      scheduler: immediate
    })
    await Promise.resolve()

    harness.emitError("model exploded")
    await expect(promise).rejects.toThrow("model exploded")
  })

  it("cancels in main and stops painting when aborted", async () => {
    const harness = makeApi()
    const controller = new AbortController()
    const seen: string[] = []

    const promise = streamChat(harness.api, "gemini-chat-stream", ["hi"], {
      onText: (text) => seen.push(text),
      signal: controller.signal,
      scheduler: immediate
    })
    await Promise.resolve()
    const id = harness.id()

    harness.emitChunk("partial")
    controller.abort()

    await expect(promise).rejects.toThrow(/aborted/i)
    expect(harness.invoke).toHaveBeenCalledWith("cancel-chat-stream", id)

    // Late chunks from an already-aborted request must not reach the UI.
    harness.emitChunk("late", id)
    expect(seen).toEqual(["partial"])
  })

  it("rejects when the invoke itself fails", async () => {
    const harness = makeApi()
    harness.invoke.mockRejectedValueOnce(new Error("no provider configured"))

    await expect(
      streamChat(harness.api, "gemini-chat-stream", ["hi"], {
        onText: () => {},
        scheduler: immediate
      })
    ).rejects.toThrow("no provider configured")
  })
})
