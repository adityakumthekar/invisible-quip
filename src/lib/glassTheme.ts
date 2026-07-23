export type GlassTheme = "royal" | "purple" | "neutral"
export type GlassStrength = "clear" | "balanced" | "solid"

const THEME_STORAGE_KEY = "glassTheme"
const STRENGTH_STORAGE_KEY = "glassStrength"
const DEFAULT_THEME: GlassTheme = "royal"
const DEFAULT_STRENGTH: GlassStrength = "balanced"
const themes: GlassTheme[] = ["royal", "purple", "neutral"]
const strengths: GlassStrength[] = ["clear", "balanced", "solid"]

function isGlassTheme(value: string | null): value is GlassTheme {
  return value !== null && themes.includes(value as GlassTheme)
}

function isGlassStrength(value: string | null): value is GlassStrength {
  return value !== null && strengths.includes(value as GlassStrength)
}

export function getGlassTheme(): GlassTheme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  return isGlassTheme(stored) ? stored : DEFAULT_THEME
}

export function setGlassTheme(theme: GlassTheme): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme)
  document.documentElement.dataset.glassTheme = theme
}

export function getGlassStrength(): GlassStrength {
  const stored = localStorage.getItem(STRENGTH_STORAGE_KEY)
  return isGlassStrength(stored) ? stored : DEFAULT_STRENGTH
}

export function setGlassStrength(strength: GlassStrength): void {
  localStorage.setItem(STRENGTH_STORAGE_KEY, strength)
  document.documentElement.dataset.glassStrength = strength
}
