/**
 * Run with the first option; on failure, move to the next. Used for answer
 * models and speech-to-text alike, so a throttled or unavailable backend costs
 * one extra round trip mid-interview instead of a failed question.
 *
 * `canFallBack` vetoes a retry — a stream that has already shown text must not
 * start over on another model. The last option's error is the one thrown.
 */
export async function withFallback<T>(
  options: readonly string[],
  run: (option: string) => Promise<T>,
  opts: { label: string; canFallBack?: (error: unknown) => boolean }
): Promise<T> {
  if (options.length === 0) {
    throw new Error(`No model configured for ${opts.label}`)
  }
  for (let i = 0; ; i++) {
    try {
      return await run(options[i])
    } catch (error) {
      const next = options[i + 1]
      if (next === undefined || (opts.canFallBack && !opts.canFallBack(error))) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[models] ${opts.label}: ${options[i]} failed (${message}); trying ${next}`)
    }
  }
}
