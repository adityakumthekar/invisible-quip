export type GlassTheme = "royal" | "purple" | "neutral"
export type GlassStrength = "clear" | "balanced" | "solid"

const THEME_STORAGE_KEY = "glassTheme"
const STRENGTH_STORAGE_KEY = "glassStrength"
const VERSION_STORAGE_KEY = "glassThemeVersion"
const DEFAULT_THEME: GlassTheme = "neutral"
const DEFAULT_STRENGTH: GlassStrength = "balanced"

/* Bump when the default theme changes. main.tsx persists whatever getGlassTheme
   returns, so every existing install already has the old default written to
   storage and would otherwise never see a new one. Migrating once lets the new
   default land while still respecting any theme picked after the migration. */
const THEME_VERSION = "2"
const themes: GlassTheme[] = ["royal", "purple", "neutral"]
const strengths: GlassStrength[] = ["clear", "balanced", "solid"]

function isGlassTheme(value: string | null): value is GlassTheme {
  return value !== null && themes.includes(value as GlassTheme)
}

function isGlassStrength(value: string | null): value is GlassStrength {
  return value !== null && strengths.includes(value as GlassStrength)
}

function migrateIfStale(): void {
  if (localStorage.getItem(VERSION_STORAGE_KEY) === THEME_VERSION) return
  localStorage.setItem(VERSION_STORAGE_KEY, THEME_VERSION)
  localStorage.removeItem(THEME_STORAGE_KEY)
}

export function getGlassTheme(): GlassTheme {
  migrateIfStale()
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
