import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  GestureRecognizer,
  type Gesture,
  type Touch
} from "../../src/lib/remoteGestures"
import {
  elementPointToNormalized,
  IDENTITY_TRANSFORM,
  panBy,
  zoomAbout,
  type Point,
  type ViewportTransform
} from "../../src/lib/remoteViewport"
import type {
  NormalizedPoint,
  RemoteCommand,
  RemoteDisplay,
  ScreenPreset
} from "../../src/lib/remoteProtocol"
import { screenStreamUrl } from "../lib/remoteClient"
import KeyBar from "./KeyBar"

/**
 * Touch drives the laptop; View drives the picture.
 *
 * The alternative — inferring intent from finger count alone — collapses as
 * soon as you zoom in, because two-finger drag then has to mean both "scroll
 * the laptop" and "pan the view". An explicit mode is one more thing to learn
 * and many fewer things to get wrong.
 */
type Mode = "touch" | "view"

interface ScreenViewProps {
  displays: RemoteDisplay[]
  activeDisplayId: number | null
  inputEnabled: boolean
  onCommand: (command: RemoteCommand) => Promise<unknown>
  onSelectDisplay: (displayId: number) => void
}

const PRESET_LABELS: Record<ScreenPreset, string> = {
  low: "Low",
  medium: "Medium",
  high: "High"
}

const ScreenView: React.FC<ScreenViewProps> = ({
  displays,
  activeDisplayId,
  inputEnabled,
  onCommand,
  onSelectDisplay
}) => {
  const [preset, setPreset] = useState<ScreenPreset>("medium")
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("touch")
  const [transform, setTransform] = useState<ViewportTransform>(IDENTITY_TRANSFORM)
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 })
  const [flash, setFlash] = useState<Point | null>(null)

  const surfaceRef = useRef<HTMLDivElement>(null)
  const recognizer = useRef(new GestureRecognizer())
  const transformRef = useRef(transform)
  transformRef.current = transform
  const modeRef = useRef(mode)
  modeRef.current = mode

  // A ticket is single-use, so the stream URL has to be minted fresh — on
  // mount, on a quality change, and after any drop.
  const openStream = useCallback(async () => {
    setStreamError(null)
    const url = await screenStreamUrl(preset)
    if (!url) {
      setStreamError("Could not reach the laptop.")
      setStreamUrl(null)
      return
    }
    setStreamUrl(url)
  }, [preset])

  useEffect(() => {
    void openStream()
  }, [openStream])

  const containerSize = () => {
    const element = surfaceRef.current
    return element
      ? { width: element.clientWidth, height: element.clientHeight }
      : { width: 0, height: 0 }
  }

  /** Element point → a point the laptop can act on, or null if off-frame. */
  const toNormalized = useCallback(
    (point: Point): NormalizedPoint | null => {
      if (activeDisplayId === null || frameSize.width === 0) {
        return null
      }
      const normalized = elementPointToNormalized(
        point,
        containerSize(),
        frameSize,
        transformRef.current
      )
      return normalized
        ? { ...normalized, displayId: activeDisplayId }
        : null
    },
    [activeDisplayId, frameSize]
  )

  /** Briefly mark where a tap landed — the laptop is the only other feedback. */
  const showFlash = (point: Point) => {
    setFlash(point)
    window.setTimeout(() => setFlash(null), 220)
  }

  const applyGesture = useCallback(
    (gesture: Gesture) => {
      const container = containerSize()

      // Pinch always zooms, in both modes: it has no plausible second meaning,
      // and needing to change mode to see something clearly is a bad trade.
      if (gesture.type === "pinch") {
        setTransform((current) =>
          zoomAbout(current, gesture.center, gesture.factor)
        )
        return
      }

      if (modeRef.current === "view") {
        if (gesture.type === "drag") {
          setTransform((current) =>
            panBy(
              current,
              {
                x: gesture.to.x - gesture.from.x,
                y: gesture.to.y - gesture.from.y
              },
              container
            )
          )
        }
        if (gesture.type === "two-finger-pan") {
          setTransform((current) => panBy(current, gesture.delta, container))
        }
        if (gesture.type === "double-tap") {
          // A quick way back out of a zoom without pinching all the way.
          setTransform(IDENTITY_TRANSFORM)
        }
        return
      }

      // Touch mode: everything below actuates on the laptop.
      switch (gesture.type) {
        case "tap": {
          const point = toNormalized(gesture.point)
          if (!point) return
          showFlash(gesture.point)
          void onCommand({ type: "input/click", point, button: "left", clicks: 1 })
          return
        }
        case "double-tap": {
          const point = toNormalized(gesture.point)
          if (!point) return
          showFlash(gesture.point)
          void onCommand({ type: "input/click", point, button: "left", clicks: 2 })
          return
        }
        case "long-press": {
          const point = toNormalized(gesture.point)
          if (!point) return
          showFlash(gesture.point)
          void onCommand({ type: "input/click", point, button: "right", clicks: 1 })
          return
        }
        case "drag": {
          const from = toNormalized(gesture.from)
          const to = toNormalized(gesture.to)
          if (!from || !to) return
          void onCommand({ type: "input/drag", from, to })
          return
        }
        case "two-finger-pan": {
          const point = toNormalized(gesture.center)
          if (!point) return
          // Inverted: dragging the content up scrolls the page down, which is
          // what every touch surface does.
          void onCommand({
            type: "input/scroll",
            point,
            dx: -gesture.delta.x,
            dy: -gesture.delta.y
          })
          return
        }
      }
    },
    [onCommand, toNormalized]
  )

  const toTouches = (event: React.TouchEvent): Touch[] => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) {
      return []
    }
    return Array.from(event.touches).map((touch) => ({
      id: touch.identifier,
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top
    }))
  }

  const handle = (gestures: Gesture[]) => gestures.forEach(applyGesture)

  const activeDisplay = displays.find((display) => display.id === activeDisplayId)

  return (
    <div className="screen-view">
      <div className="screen-toolbar">
        <div className="segmented" role="group" aria-label="Interaction mode">
          <button
            type="button"
            aria-pressed={mode === "touch"}
            onClick={() => setMode("touch")}
            disabled={!inputEnabled}
          >
            Touch
          </button>
          <button
            type="button"
            aria-pressed={mode === "view"}
            onClick={() => setMode("view")}
          >
            View
          </button>
        </div>

        {displays.length > 1 && (
          <select
            aria-label="Display"
            value={activeDisplayId ?? ""}
            onChange={(event) => onSelectDisplay(Number(event.target.value))}
          >
            {displays.map((display) => (
              <option key={display.id} value={display.id}>
                {display.label}
              </option>
            ))}
          </select>
        )}

        <select
          aria-label="Stream quality"
          value={preset}
          onChange={(event) => setPreset(event.target.value as ScreenPreset)}
        >
          {(Object.keys(PRESET_LABELS) as ScreenPreset[]).map((value) => (
            <option key={value} value={value}>
              {PRESET_LABELS[value]}
            </option>
          ))}
        </select>

        {transform.scale > 1 && (
          <button type="button" onClick={() => setTransform(IDENTITY_TRANSFORM)}>
            Fit
          </button>
        )}
      </div>

      {!inputEnabled && (
        <p className="notice notice-inline" role="status">
          Watching only. Turn on <strong>Allow phone input</strong> in Settings →
          Remote on the laptop to touch the screen.
        </p>
      )}

      <div
        className="screen-surface"
        ref={surfaceRef}
        // touch-action: none in CSS — the browser must not claim these
        // gestures for scrolling the page that is showing the screen.
        onTouchStart={(event) =>
          handle(recognizer.current.start(toTouches(event), event.timeStamp))
        }
        onTouchMove={(event) =>
          handle(recognizer.current.move(toTouches(event), event.timeStamp))
        }
        onTouchEnd={(event) =>
          handle(recognizer.current.end(toTouches(event), event.timeStamp))
        }
        onTouchCancel={() => recognizer.current.cancel()}
      >
        {streamUrl ? (
          <img
            className="screen-frame"
            src={streamUrl}
            alt="The laptop screen"
            draggable={false}
            style={{
              transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`
            }}
            onLoad={(event) => {
              const image = event.currentTarget
              setFrameSize({
                width: image.naturalWidth,
                height: image.naturalHeight
              })
            }}
            onError={() => setStreamError("The screen stream stopped.")}
          />
        ) : (
          <p className="notice">{streamError ?? "Connecting to the screen…"}</p>
        )}

        {flash && (
          <span
            className="tap-flash"
            style={{ left: flash.x, top: flash.y }}
            aria-hidden="true"
          />
        )}
      </div>

      {streamError && (
        <div className="stream-error" role="alert">
          <span>{streamError}</span>
          <button type="button" onClick={() => void openStream()}>
            Retry
          </button>
        </div>
      )}

      {inputEnabled && mode === "touch" && (
        <KeyBar
          onKey={(combo) => void onCommand({ type: "input/key", combo })}
          onText={(text) => void onCommand({ type: "input/text", text })}
        />
      )}

      <p className="screen-hint">
        {mode === "touch"
          ? "Tap to click · hold for right-click · two fingers to scroll · pinch to zoom"
          : `Drag to pan · pinch to zoom · double-tap to fit${
              activeDisplay ? ` · ${activeDisplay.width}×${activeDisplay.height}` : ""
            }`}
      </p>
    </div>
  )
}

export default ScreenView
