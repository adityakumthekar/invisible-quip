/**
 * Renderer-side driver for the streaming chat IPC channels.
 *
 * Main sends `chat-stream-chunk` / `-done` / `-error` events tagged with a
 * request id rather than resolving one big `invoke`, so the UI can paint words
 * as they arrive. This module owns the subscribe/filter/unsubscribe dance and
 * coalesces deltas, so a fast stream doesn't force a React render per token.
 */

export type ChatStreamApi = {
  onChatStreamChunk: (
    callback: (data: { requestId: string; delta: string }) => void
  ) => () => void
  onChatStreamDone: (
    callback: (data: { requestId: string; text: string }) => void
  ) => () => void
  onChatStreamError: (
    callback: (data: { requestId: string; message: string }) => void
  ) => () => void
  invoke: (channel: string, ...args: any[]) => Promise<any>
}

export type StreamScheduler = (flush: () => void) => void

let requestCounter = 0

export function createRequestId(): string {
  requestCounter += 1
  return `chat-${Date.now()}-${requestCounter}`
}

const defaultScheduler: StreamScheduler = (flush) => {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(flush)
  } else {
    setTimeout(flush, 0)
  }
}

export type StreamChatOptions = {
  /** Called with the full text so far, coalesced to at most one call per frame. */
  onText: (text: string) => void
  signal?: AbortSignal
  scheduler?: StreamScheduler
}

/**
 * Run one streaming chat request and resolve with the complete text.
 *
 * `channel` receives `(requestId, ...args)`. The returned promise settles on
 * the done/error event, not on the invoke, so the caller sees the same
 * completion the UI does.
 */
export async function streamChat(
  api: ChatStreamApi,
  channel: string,
  args: any[],
  { onText, signal, scheduler = defaultScheduler }: StreamChatOptions
): Promise<string> {
  const requestId = createRequestId()
  let text = ""
  let flushQueued = false
  let settled = false

  const flush = () => {
    flushQueued = false
    if (!settled) onText(text)
  }
  const queueFlush = () => {
    if (flushQueued) return
    flushQueued = true
    scheduler(flush)
  }

  return new Promise<string>((resolve, reject) => {
    const unsubscribes: Array<() => void> = []
    const cleanup = () => {
      settled = true
      unsubscribes.forEach((off) => off())
      signal?.removeEventListener("abort", onAbort)
    }
    function onAbort() {
      cleanup()
      void api.invoke("cancel-chat-stream", requestId).catch(() => {})
      reject(new DOMException("Chat stream aborted", "AbortError"))
    }

    unsubscribes.push(
      api.onChatStreamChunk((data) => {
        if (data.requestId !== requestId) return
        text += data.delta
        queueFlush()
      }),
      api.onChatStreamDone((data) => {
        if (data.requestId !== requestId) return
        // Trust main's accumulated text — it saw every chunk, including any we
        // may have dropped in a coalesced frame.
        text = data.text
        cleanup()
        onText(text)
        resolve(text)
      }),
      api.onChatStreamError((data) => {
        if (data.requestId !== requestId) return
        cleanup()
        reject(new Error(data.message))
      })
    )

    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener("abort", onAbort)

    api.invoke(channel, requestId, ...args).catch((error: unknown) => {
      if (settled) return
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}
