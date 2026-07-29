// Whether the control bar is retracted to its blob. Persisted so the overlay
// relaunches in whichever state it was left in.
const STORAGE_KEY = "quipBarCollapsed"

/**
 * Anything other than the stored "1" reads as expanded — an unset or corrupted
 * value must never leave a first launch showing nothing but an unexplained dot.
 */
export function getBarCollapsed(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "1"
}

export function setBarCollapsed(collapsed: boolean): void {
  localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0")
}
