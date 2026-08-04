// Endpointing for Live Listen: when the interviewer started talking and — the
// part that actually matters — when they stopped.
//
// What makes this different from textbook VAD is that it runs on a *virtual*
// device. An unrouted BlackHole delivers samples of exactly zero, so its noise
// floor is 0 and a purely relative threshold fires on the first stray sample; a
// real microphone in a real room never does this. That is what `absFloor` is
// for, and it is load-bearing rather than defensive.
//
// Everything here is a pure function of a sequence of RMS levels, so the
// thresholds can be tested against synthetic sequences without a machine that
// has BlackHole on it.

/** One VAD frame. 1024 samples at 16 kHz — the batch the worklet posts. */
export const FRAME_SAMPLES = 1024
export const FRAME_MS = (FRAME_SAMPLES / 16000) * 1000 // 64

export interface VadConfig {
  /** Consecutive frames above threshold before speech is declared. */
  onsetFrames: number
  /** Consecutive frames below threshold before the utterance is closed. */
  hangoverFrames: number
  /** Voiced milliseconds an utterance needs before it is worth transcribing. */
  minVoicedMs: number
  /** Hard cut, so one long monologue can't grow without bound. */
  maxUtteranceMs: number
  /** Floor under the adaptive threshold. */
  absFloor: number
  /** Threshold is this multiple of the tracked noise floor. */
  thresholdRatio: number
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  // 192 ms. A keyboard click or a notification blip is one frame and cannot
  // reach three consecutive; the ring buffer's pre-roll covers the delay this
  // costs, so nothing is lost off the front of the question.
  onsetFrames: 3,
  // ~900 ms. Long enough to ride a mid-sentence pause, short enough that it
  // isn't the dominant term in time-to-first-token.
  hangoverFrames: 14,
  // Counts *voiced* frames rather than wall time, so a door slam that happens
  // to span the window is still rejected.
  minVoicedMs: 700,
  // 30 s is ~960 audio tokens and under a megabyte of WAV — both affordable.
  maxUtteranceMs: 30000,
  // ~-42 dBFS.
  absFloor: 0.008,
  thresholdRatio: 3
}

export type VadEvent =
  | { type: "none" }
  | { type: "speech-start" }
  | {
      type: "utterance"
      /**
       * Absolute frame indices, half-open. Multiply by FRAME_SAMPLES to get
       * ring-buffer positions; the ring advances by exactly one frame per push.
       */
      startFrame: number
      endFrame: number
      voicedMs: number
      /** Under minVoicedMs — drop it without paying for a transcript. */
      tooShort: boolean
    }

export interface Vad {
  push(level: number): VadEvent
  /** Live threshold, for the meter and for asserting on adaptation in tests. */
  threshold(): number
  /** Whether an utterance is currently open. */
  isSpeaking(): boolean
  reset(): void
}

/** Root-mean-square of a frame, normalised to 0..1. */
export function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 0x8000
    sum += v * v
  }
  return Math.sqrt(sum / samples.length)
}

/** True when every sample is exactly zero — a virtual device that isn't routed. */
export function isDigitalSilence(samples: Int16Array): boolean {
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] !== 0) return false
  }
  return true
}

export function createVad(config: VadConfig = DEFAULT_VAD_CONFIG): Vad {
  const maxFrames = Math.ceil(config.maxUtteranceMs / FRAME_MS)

  let noiseFloor = 0
  let frame = 0
  let speaking = false
  let onsetRun = 0
  let silentRun = 0
  let startFrame = 0
  let voicedFrames = 0

  const threshold = () =>
    Math.max(noiseFloor * config.thresholdRatio, config.absFloor)

  const close = (endFrame: number): VadEvent => {
    const voicedMs = voicedFrames * FRAME_MS
    const event: VadEvent = {
      type: "utterance",
      startFrame,
      endFrame,
      voicedMs,
      tooShort: voicedMs < config.minVoicedMs
    }
    speaking = false
    onsetRun = 0
    silentRun = 0
    voicedFrames = 0
    return event
  }

  return {
    threshold,
    isSpeaking: () => speaking,

    reset() {
      noiseFloor = 0
      speaking = false
      onsetRun = 0
      silentRun = 0
      voicedFrames = 0
      // `frame` deliberately survives: its indices are the ring buffer's, and
      // restarting them would make an in-flight slice read the wrong samples.
    },

    push(level: number): VadEvent {
      const index = frame
      frame += 1
      const loud = level > threshold()

      // Adapt only between utterances. Tracking the floor through speech would
      // let a long answer drag the threshold up over its own tail and truncate
      // itself mid-sentence.
      if (!speaking) {
        noiseFloor =
          level < noiseFloor
            ? noiseFloor * 0.9 + level * 0.1 // fast down: the room got quieter
            : noiseFloor * 0.995 + level * 0.005 // slow up: speech must not raise it
      }

      if (!speaking) {
        if (!loud) {
          onsetRun = 0
          return { type: "none" }
        }
        onsetRun += 1
        if (onsetRun < config.onsetFrames) return { type: "none" }

        speaking = true
        // Backdated to the first loud frame: the run that proved this was
        // speech is speech, not preamble.
        startFrame = index - (config.onsetFrames - 1)
        voicedFrames = config.onsetFrames
        silentRun = 0
        return { type: "speech-start" }
      }

      if (loud) {
        silentRun = 0
        voicedFrames += 1
      } else {
        silentRun += 1
        if (silentRun >= config.hangoverFrames) {
          // The trailing silence is what proved the turn ended; it is not part
          // of the question, so it doesn't go to the transcriber.
          return close(index - config.hangoverFrames + 1)
        }
      }

      if (index - startFrame + 1 >= maxFrames) return close(index + 1)
      return { type: "none" }
    }
  }
}
