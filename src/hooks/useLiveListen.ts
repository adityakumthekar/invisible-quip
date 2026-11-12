import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { closeSystemAudio, openSystemAudio } from "../lib/systemAudio"
import {
  CAPTURE_PROCESSOR,
  connectCaptureGraph,
  loadCaptureWorklet
} from "../lib/captureWorklet"
import {
  RingBuffer,
  SAMPLE_RATE,
  bytesToBase64,
  encodeWav,
  floatToInt16
} from "../lib/pcm"
import {
  DEFAULT_VAD_CONFIG,
  FRAME_SAMPLES,
  createVad,
  isDigitalSilence,
  rms,
  type Vad
} from "../lib/vad"
import { normalizeTranscript, shouldAnswer } from "../lib/questionGate"
import {
  BUFFER_STALE_MS,
  COOLDOWN_MS,
  DEAD_AFTER_MS,
  SETTLE_MS,
  initialLiveListenState,
  isDeviceDead,
  liveListenReducer,
  livePhase,
  pendingText,
  type LivePhase,
  type LiveListenState
} from "../lib/liveListenSession"

// Everything imperative about Live Listen: the audio graph, the timers, and the
// transcription requests in flight. It lives here rather than in Queue.tsx
// because that file is already a thousand lines of app state, and because the
// parts of this feature worth testing are the pure modules above — this is the
// glue that cannot be.

/**
 * How far back the utterance slice reaches before the frame the VAD called
 * onset on. The detector needs onsetFrames above threshold before it will
 * commit, so without this the first syllable of every question is missing.
 * Sized comfortably past that delay — silence at the front costs nothing.
 */
const PREROLL_FRAMES = DEFAULT_VAD_CONFIG.onsetFrames + 2

/** Ring capacity: one force-cut utterance plus pre-roll and slack. */
const RING_SAMPLES =
  Math.ceil((DEFAULT_VAD_CONFIG.maxUtteranceMs / 1000) * SAMPLE_RATE) +
  FRAME_SAMPLES * (PREROLL_FRAMES + 16)

export interface UseLiveListenOptions {
  /** Read at arm time, not at mount — consent can be granted while sitting here. */
  hasConsent: () => boolean
  /** The accumulated question, ready to answer. */
  onQuestion: (text: string) => void | Promise<void>
  /** App-chrome messages: device not routed, capture failed. */
  onNotice: (text: string) => void
}

export interface LiveListen {
  state: LiveListenState
  phase: LivePhase
  /** The loopback stream while armed, for the level meter. */
  stream: MediaStream | null
  arm: () => Promise<void>
  disarm: () => void
  toggle: () => void
  /** Alt+M while armed: answer whatever is buffered, gate and cooldown ignored. */
  answerNow: () => void
}

export function useLiveListen(options: UseLiveListenOptions): LiveListen {
  const [state, dispatch] = useReducer(
    liveListenReducer,
    initialLiveListenState
  )
  const [stream, setStream] = useState<MediaStream | null>(null)

  // The IPC callbacks and the timers both fire long after the render that
  // created them, so everything they read comes from a ref.
  const stateRef = useRef(state)
  stateRef.current = state
  const optionsRef = useRef(options)
  optionsRef.current = options

  const ctxRef = useRef<AudioContext | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ringRef = useRef<RingBuffer | null>(null)
  const vadRef = useRef<Vad | null>(null)

  const settleTimer = useRef<number | null>(null)
  const staleTimer = useRef<number | null>(null)
  const deadTimer = useRef<number | null>(null)
  const lastFiredAt = useRef(0)

  const clearTimer = (ref: React.MutableRefObject<number | null>) => {
    if (ref.current !== null) {
      window.clearTimeout(ref.current)
      ref.current = null
    }
  }

  const teardown = useCallback(() => {
    clearTimer(settleTimer)
    clearTimer(staleTimer)
    clearTimer(deadTimer)
    nodeRef.current?.port.close()
    nodeRef.current?.disconnect()
    nodeRef.current = null
    void ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
    if (streamRef.current) closeSystemAudio(streamRef.current)
    streamRef.current = null
    ringRef.current = null
    vadRef.current = null
    setStream(null)
  }, [])

  const fire = useCallback((text: string) => {
    lastFiredAt.current = Date.now()
    clearTimer(staleTimer)
    dispatch({ type: "fired" })
    void Promise.resolve(optionsRef.current.onQuestion(text)).finally(() => {
      dispatch({ type: "answer-done" })
    })
  }, [])

  const scheduleSettle = useCallback(
    (delay: number = SETTLE_MS) => {
      clearTimer(settleTimer)
      settleTimer.current = window.setTimeout(() => {
        settleTimer.current = null
        const current = stateRef.current
        if (!current.armed) return

        // Words still on their way belong to this question. Firing now would
        // answer the first half of it.
        if (current.transcribing > 0) {
          scheduleSettle()
          return
        }

        const text = pendingText(current)
        // A failed gate keeps the buffer rather than clearing it: "Okay."
        // followed a beat later by the real question is one question. The
        // stale timer is what eventually drops an orphan.
        if (!shouldAnswer(text)) return

        const since = Date.now() - lastFiredAt.current
        if (since < COOLDOWN_MS) {
          scheduleSettle(COOLDOWN_MS - since)
          return
        }
        fire(text)
      }, delay)
    },
    [fire]
  )

  const scheduleStale = useCallback(() => {
    clearTimer(staleTimer)
    staleTimer.current = window.setTimeout(() => {
      staleTimer.current = null
      dispatch({ type: "clear-pending" })
    }, BUFFER_STALE_MS)
  }, [])

  /** Cut the utterance out of the ring and send it for a transcript. */
  const transcribe = useCallback(
    async (startFrame: number, endFrame: number, epoch: number) => {
      const ring = ringRef.current
      if (!ring) return
      const from = (startFrame - PREROLL_FRAMES) * FRAME_SAMPLES
      const to = endFrame * FRAME_SAMPLES
      const samples = ring.read(from, to)
      if (samples.length === 0) {
        dispatch({ type: "transcript-failed", epoch })
        return
      }

      try {
        const wav = encodeWav(samples)
        const result = await window.electronAPI.transcribeAudio(
          bytesToBase64(wav),
          "audio/wav"
        )
        dispatch({
          type: "transcript",
          epoch,
          text: normalizeTranscript(result.text)
        })
      } catch {
        // Silent by design. A dropped transcript costs one question; a toast
        // per failure mid-interview costs the user their attention.
        dispatch({ type: "transcript-failed", epoch })
      }
      // Rescheduled on failure too. speech-start clears the settle timer, so a
      // transcription that fails after the interviewer started their next
      // sentence would otherwise strand everything already buffered until the
      // staleness timer threw it away.
      scheduleSettle()
      scheduleStale()
    },
    [scheduleSettle, scheduleStale]
  )

  const onFrame = useCallback(
    (frame: Float32Array) => {
      const ring = ringRef.current
      const vad = vadRef.current
      if (!ring || !vad) return

      const samples = floatToInt16(frame)
      ring.push(samples)
      if (!isDigitalSilence(samples)) dispatch({ type: "signal" })

      const event = vad.push(rms(samples))
      if (event.type === "speech-start") {
        dispatch({ type: "speech-start" })
        // They started again — hold off on answering the half we have.
        clearTimer(settleTimer)
        return
      }
      if (event.type !== "utterance") return

      // Too short to be a question. Dropped here, before it costs a request.
      if (event.tooShort) {
        dispatch({ type: "speech-end", transcribing: false })
        return
      }
      dispatch({ type: "speech-end", transcribing: true })
      void transcribe(
        event.startFrame,
        event.endFrame,
        stateRef.current.epoch
      )
    },
    [transcribe]
  )

  const arm = useCallback(async () => {
    if (stateRef.current.armed) return

    const opened = await openSystemAudio(optionsRef.current.hasConsent())
    if (opened.ok === false) {
      dispatch({
        type: "failed",
        message:
          opened.reason === "not-configured"
            ? "No loopback device found. Install BlackHole and pick it in Settings → Audio."
            : opened.reason === "no-consent"
              ? "System audio capture hasn't been acknowledged yet — see Settings → Audio."
              : opened.reason === "off"
                ? "System audio is switched off in Settings → Audio."
                : (opened.detail ?? "Could not open the loopback device.")
      })
      return
    }

    try {
      // 16 kHz on the context itself, so Chromium resamples the 48 kHz device
      // through a real resampler and nothing here has to decimate by hand.
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
      await loadCaptureWorklet(ctx)
      const source = ctx.createMediaStreamSource(opened.stream)
      const node = new AudioWorkletNode(ctx, CAPTURE_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { frameSamples: FRAME_SAMPLES }
      })
      node.port.onmessage = (e: MessageEvent<Float32Array>) => onFrame(e.data)
      connectCaptureGraph(ctx, source, node)

      ctxRef.current = ctx
      nodeRef.current = node
      streamRef.current = opened.stream
      ringRef.current = new RingBuffer(RING_SAMPLES)
      vadRef.current = createVad()
      lastFiredAt.current = 0
      setStream(opened.stream)
      dispatch({ type: "arm" })

      // Exactly-zero samples for the whole grace period means the virtual
      // device was never routed — a real source always has a noise floor. Said
      // once, three seconds in, rather than after a wasted question.
      clearTimer(deadTimer)
      deadTimer.current = window.setTimeout(() => {
        deadTimer.current = null
        if (isDeviceDead(stateRef.current, DEAD_AFTER_MS)) {
          optionsRef.current.onNotice(
            "Live is listening but hearing digital silence. Set your macOS Output to the Multi-Output device."
          )
        }
      }, DEAD_AFTER_MS)
    } catch (error) {
      closeSystemAudio(opened.stream)
      teardown()
      dispatch({
        type: "failed",
        message:
          error instanceof Error ? error.message : "Could not start listening."
      })
    }
  }, [onFrame, teardown])

  const disarm = useCallback(() => {
    teardown()
    dispatch({ type: "disarm" })
  }, [teardown])

  const toggle = useCallback(() => {
    if (stateRef.current.armed) disarm()
    else void arm()
  }, [arm, disarm])

  const answerNow = useCallback(() => {
    const current = stateRef.current
    if (!current.armed) return
    const text = pendingText(current)
    if (!text) return
    clearTimer(settleTimer)
    fire(text)
  }, [fire])

  // Tearing the graph down on unmount matters more than usual: the stream is
  // what holds the macOS microphone indicator lit.
  useEffect(() => teardown, [teardown])

  return {
    state,
    phase: livePhase(state),
    stream,
    arm,
    disarm,
    toggle,
    answerNow
  }
}
