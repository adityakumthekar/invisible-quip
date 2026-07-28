/**
 * In-flight streaming chat requests, keyed by the renderer-generated request
 * id. Kept in its own module so Cmd+R (which goes through ProcessingHelper's
 * cancel path, not the IPC handlers) can actually stop work that is running —
 * the AbortControllers ProcessingHelper used to create were never wired to
 * anything.
 */
export const activeChatStreams = new Map<string, AbortController>()

export function abortAllChatStreams(): void {
  activeChatStreams.forEach((controller) => controller.abort())
  activeChatStreams.clear()
}
