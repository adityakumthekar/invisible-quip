import { createMainWindowOptions } from "./mainWindowPolicy";
import type { Rect } from "./windowSizing";

export function createTodayStickyOptions(
  invisible: boolean,
  preload: string,
  platform: NodeJS.Platform = process.platform,
) {
  return {
    ...createMainWindowOptions(invisible, preload),
    title: "Quip Today",
    width: 332,
    height: 420,
    minWidth: 280,
    minHeight: 220,
    maxWidth: 520,
    skipTaskbar: true,
    // CSS backdrop-filter cannot blur the desktop behind an Electron window.
    // Keep the native material active even when this utility note is unfocused.
    ...(platform === "darwin"
      ? {
          vibrancy: "under-window" as const,
          visualEffectState: "active" as const,
        }
      : {}),
  };
}
export function fitSticky(bounds: Rect, workArea: Rect): Rect {
  const width = Math.min(Math.max(280, bounds.width), workArea.width);
  const height = Math.min(Math.max(220, bounds.height), workArea.height);
  return {
    width,
    height,
    x: Math.max(
      workArea.x,
      Math.min(bounds.x, workArea.x + workArea.width - width),
    ),
    y: Math.max(
      workArea.y,
      Math.min(bounds.y, workArea.y + workArea.height - height),
    ),
  };
}
