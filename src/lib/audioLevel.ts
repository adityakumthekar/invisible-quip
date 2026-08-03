// Peak level of a live stream, sampled continuously.
//
// The point is one specific distinction: an unrouted virtual device delivers
// digital silence — samples of exactly zero — while a real microphone in a real
// room always has a noise floor. So `peak === 0` over a whole clip means the
// capture is misconfigured, not that nobody was talking, and the warning that
// fact earns can be specific instead of crying wolf on every quiet moment.

export interface LevelMonitor {
  /** Loudest sample seen so far, 0..1. */
  peak(): number
  stop(): void
}

export function createLevelMonitor(stream: MediaStream): LevelMonitor {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext
  const ctx = new AudioCtx()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)

  const data = new Uint8Array(analyser.frequencyBinCount)
  let peak = 0
  let frame = 0

  const sample = () => {
    analyser.getByteTimeDomainData(data)
    for (const v of data) {
      // 128 is silence in this encoding; distance from it is amplitude.
      const level = Math.abs(v - 128) / 128
      if (level > peak) peak = level
    }
    frame = requestAnimationFrame(sample)
  }
  frame = requestAnimationFrame(sample)

  return {
    peak: () => peak,
    stop: () => {
      cancelAnimationFrame(frame)
      source.disconnect()
      void ctx.close()
    }
  }
}
