import React, { useEffect, useRef, useState } from "react"
import { Mic, MicOff } from "lucide-react"
import { cn } from "../../lib/utils"

interface MicWaveformProps {
  stream: MediaStream
  seconds: number
  /** The interviewer's side, when system audio is configured for this clip. */
  systemStream?: MediaStream | null
}

const BARS = 16

/**
 * How long a stream may read as exact digital silence before it is called dead.
 * Only a virtual device that was never routed produces this — a real microphone
 * always has a noise floor — so the threshold just has to outlast the gap
 * before anyone starts talking.
 */
const DEAD_AFTER_MS = 3000

const formatTime = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

// Live level bars driven by a Web Audio AnalyserNode — no viz library.
const LevelBars: React.FC<{
  stream: MediaStream
  width: number
  dimmed?: boolean
  /** Flag exact silence, which means "not routed" rather than "not talking". */
  watchForSilence?: boolean
}> = ({ stream, width, dimmed, watchForSilence }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dead, setDead] = useState(false)

  useEffect(() => {
    setDead(false)
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    const ctx = new AudioCtx()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 64
    analyser.smoothingTimeConstant = 0.75
    source.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    const samples = new Uint8Array(analyser.fftSize)

    const accent =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--glass-accent")
        .trim() || "#8fb0ff"

    const startedAt = performance.now()
    let lastSound = startedAt

    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)

      if (watchForSilence) {
        analyser.getByteTimeDomainData(samples)
        // 128 is silence in this encoding. Anything at all resets the clock.
        if (samples.some((v) => v !== 128)) {
          lastSound = performance.now()
          setDead(false)
        } else if (performance.now() - lastSound > DEAD_AFTER_MS) {
          setDead(true)
        }
      }

      const canvas = canvasRef.current
      if (!canvas) return
      const c = canvas.getContext("2d")
      if (!c) return
      analyser.getByteFrequencyData(data)
      const w = canvas.width
      const h = canvas.height
      c.clearRect(0, 0, w, h)
      c.fillStyle = accent
      const step = Math.floor(data.length / BARS)
      const bw = w / BARS
      for (let i = 0; i < BARS; i++) {
        const v = data[i * step] / 255 // 0..1
        const bh = Math.max(2, v * h)
        c.globalAlpha = 0.35 + v * 0.65
        c.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh)
      }
    }
    draw()

    return () => {
      cancelAnimationFrame(raf)
      source.disconnect()
      void ctx.close()
    }
  }, [stream, watchForSilence])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={16}
      title={dead ? "No system audio — check your macOS Output device" : undefined}
      className={cn(
        "block",
        dimmed && "opacity-30",
        // Red is the only signal the user gets while the clip is still running.
        dead && "opacity-60 [filter:hue-rotate(140deg)_saturate(3)]"
      )}
    />
  )
}

const MicWaveform: React.FC<MicWaveformProps> = ({
  stream,
  seconds,
  systemStream
}) => {
  const [muted, setMuted] = useState(false)

  const toggleMute = () => {
    const track = stream.getAudioTracks()[0]
    if (!track) return
    track.enabled = muted // if currently muted, re-enable
    setMuted((m) => !m)
  }

  return (
    <div className="no-drag flex items-center gap-2 px-2">
      <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
      <span className="text-[11px] tabular-nums glass-muted">
        {formatTime(seconds)}
      </span>
      {systemStream ? (
        // Two channels means each needs naming, and the bars have to shrink to
        // keep the bar from outgrowing the window it is auto-sized to.
        <>
          <span className="text-[10px] glass-subtle">You</span>
          <LevelBars stream={stream} width={40} dimmed={muted} />
          <span className="text-[10px] glass-subtle">Them</span>
          <LevelBars stream={systemStream} width={40} watchForSilence />
        </>
      ) : (
        <LevelBars stream={stream} width={72} dimmed={muted} />
      )}
      <button
        type="button"
        onClick={toggleMute}
        title={muted ? "Unmute mic" : "Mute mic"}
        className="p-1 rounded-md glass-icon hover:text-glass-heading hover:bg-glass-hover"
      >
        {muted ? (
          <MicOff className="w-3.5 h-3.5 text-red-300" strokeWidth={1.75} />
        ) : (
          <Mic className="w-3.5 h-3.5" strokeWidth={1.75} />
        )}
      </button>
    </div>
  )
}

export default MicWaveform
