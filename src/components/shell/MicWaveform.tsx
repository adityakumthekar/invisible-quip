import React, { useEffect, useRef, useState } from "react"
import { Mic, MicOff } from "lucide-react"
import { cn } from "../../lib/utils"

interface MicWaveformProps {
  stream: MediaStream
  seconds: number
}

const BARS = 16

const formatTime = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

// Live mic level bars driven by a Web Audio AnalyserNode — no viz library.
const MicWaveform: React.FC<MicWaveformProps> = ({ stream, seconds }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
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

    const accent =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--glass-accent")
        .trim() || "#8fb0ff"

    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
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
  }, [stream])

  const toggleMute = () => {
    const track = stream.getAudioTracks()[0]
    if (!track) return
    track.enabled = muted // if currently muted, re-enable
    setMuted((m) => !m)
  }

  return (
    <div className="no-drag flex items-center gap-2 px-2">
      <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
      <span className="text-meta tabular-nums glass-muted">
        {formatTime(seconds)}
      </span>
      <canvas
        ref={canvasRef}
        width={72}
        height={16}
        className={cn("block", muted && "opacity-30")}
      />
      <button
        type="button"
        onClick={toggleMute}
        title={muted ? "Unmute mic" : "Mute mic"}
        className="p-1 rounded-inner glass-icon hover:text-glass-heading hover:bg-glass-hover"
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
