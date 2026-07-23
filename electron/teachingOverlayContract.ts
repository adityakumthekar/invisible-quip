import type { DipRect } from "./teaching"

export interface TeachingOverlayTargetEvent {
  instruction: string
  label?: string
  target: DipRect
}
