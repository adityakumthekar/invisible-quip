import type { TeachingOverlayTargetEvent } from "./teachingOverlayContract"

type SendTarget<Renderer> = (
  renderer: Renderer,
  target: TeachingOverlayTargetEvent
) => void
type SendClear<Renderer> = (renderer: Renderer) => void

export class TeachingOverlayReplayCoordinator<Renderer extends object> {
  private activeRenderer: Renderer | null = null
  private rendererReady = false
  private latestTarget: TeachingOverlayTargetEvent | null = null

  constructor(
    private readonly sendTarget: SendTarget<Renderer>,
    private readonly sendClear: SendClear<Renderer>
  ) {}

  public activate(renderer: Renderer): void {
    this.activeRenderer = renderer
    this.rendererReady = false
  }

  public ready(renderer: Renderer): boolean {
    if (renderer !== this.activeRenderer) {
      return false
    }

    this.rendererReady = true
    this.replayCurrentState()
    return true
  }

  public setTarget(target: TeachingOverlayTargetEvent): void {
    this.latestTarget = target
    this.replayCurrentState()
  }

  public isReady(renderer: Renderer): boolean {
    return renderer === this.activeRenderer && this.rendererReady
  }

  public hasTarget(): boolean {
    return this.latestTarget !== null
  }

  public clear(): void {
    this.latestTarget = null
    this.replayCurrentState()
  }

  public deactivate(renderer: Renderer): void {
    if (renderer !== this.activeRenderer) {
      return
    }

    this.activeRenderer = null
    this.rendererReady = false
    this.latestTarget = null
  }

  private replayCurrentState(): void {
    if (!this.activeRenderer || !this.rendererReady) {
      return
    }

    if (this.latestTarget) {
      this.sendTarget(this.activeRenderer, this.latestTarget)
    } else {
      this.sendClear(this.activeRenderer)
    }
  }
}
