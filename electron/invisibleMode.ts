/**
 * Stealth (invisible) mode is the default; INVISIBLE=false is the debug
 * opt-out that drops capture protection so the overlay shows up in
 * screenshots and screen shares.
 *
 * Read at call time — .env is loaded in main.ts after this module is imported,
 * so caching the value at module scope would read an empty environment.
 */
export function isInvisibleMode(): boolean {
  return process.env.INVISIBLE !== "false"
}
