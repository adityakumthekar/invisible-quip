// The capture worklet, shipped as a source string rather than a module file.
//
// Why a blob: URL and not `addModule(new URL("./x.worklet.ts", import.meta.url))`:
// this project has no root vite.config.ts — the renderer builds on stock Vite
// defaults with `--base ./` on the command line — and electron-builder packs
// dist/ inside app.asar, asar being on by default with no asarUnpack. So the
// tidy-looking route would mean introducing a build config the repo has
// deliberately never had, and then fetching a separately-emitted script asset
// over file:// from inside an archive under webSecurity. A blob: URL is
// origin-opaque and behaves identically in dev (http://localhost:5180) and
// packaged (file://), which is the only place those two diverge.
//
// The body stays a template literal on purpose. Root tsconfig is strict with
// noUnusedParameters and `npm run build` gates on tsc, so a real
// AudioWorkletProcessor subclass would need lib shims and a process() signature
// that trips it. Nothing here decides anything — every judgement lives in
// vad.ts and pcm.ts, which are unit-tested.

export const CAPTURE_PROCESSOR = "quip-capture"

const WORKLET_SOURCE = `
class QuipCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.size = (options && options.processorOptions && options.processorOptions.frameSamples) || 1024
    this.buf = new Float32Array(this.size)
    this.filled = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    // A track that is muted or has ended delivers nothing. Staying alive is the
    // point: the device coming back must not need a re-arm.
    if (!channel) return true

    for (let i = 0; i < channel.length; i++) {
      this.buf[this.filled++] = channel[i]
      if (this.filled === this.size) {
        // Transferred, not copied, so a fresh buffer is needed each time.
        this.port.postMessage(this.buf, [this.buf.buffer])
        this.buf = new Float32Array(this.size)
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor(${JSON.stringify(CAPTURE_PROCESSOR)}, QuipCaptureProcessor)
`

/**
 * Register the processor on a context. Module registration is per-context and
 * throws on a duplicate name, which is fine because arming builds a fresh
 * AudioContext every time.
 */
export async function loadCaptureWorklet(ctx: AudioContext): Promise<void> {
  const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" })
  const url = URL.createObjectURL(blob)
  try {
    await ctx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Wire the graph. The node is connected through a silenced gain to the
 * destination for one non-obvious reason: an AudioWorkletNode that reaches
 * nothing is never pulled, so `process()` would simply not be called and the
 * capture would sit there delivering nothing. The zero gain is what keeps that
 * connection from putting anything on the user's output — which matters more
 * than usual here, since their output device is a Multi-Output that feeds
 * straight back into the device being captured.
 */
export function connectCaptureGraph(
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  node: AudioWorkletNode
): GainNode {
  const silence = ctx.createGain()
  silence.gain.value = 0
  source.connect(node)
  node.connect(silence)
  silence.connect(ctx.destination)
  return silence
}
