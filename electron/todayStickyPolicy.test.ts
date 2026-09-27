import { describe, expect, it } from "vitest";
import { createTodayStickyOptions, fitSticky } from "./todayStickyPolicy";

describe("Today sticky window", () => {
  it("inherits Quip capture protection with isolated, frameless utility chrome", () => {
    const options = createTodayStickyOptions(true, "/sticky.js", "darwin");
    expect(options).toMatchObject({
      contentProtection: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      width: 332,
      height: 420,
      resizable: true,
      transparent: true,
      vibrancy: "under-window",
      visualEffectState: "active",
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: "/sticky.js",
      },
    });
  });
  it("retains the transparent protected window without macOS-only effects elsewhere", () => {
    for (const platform of ["win32", "linux"] as const) {
      const options = createTodayStickyOptions(true, "/sticky.js", platform);
      expect(options).toMatchObject({
        contentProtection: true,
        transparent: true,
      });
      expect(options.vibrancy).toBeUndefined();
      expect(options.visualEffectState).toBeUndefined();
    }
  });
  it("honors the explicit capturable debug mode", () => {
    expect(
      createTodayStickyOptions(false, "/sticky.js").contentProtection,
    ).toBe(false);
  });
  it("keeps the note reachable when monitors change", () => {
    expect(
      fitSticky(
        { x: 1800, y: 1000, width: 332, height: 420 },
        { x: 0, y: 0, width: 1440, height: 900 },
      ),
    ).toEqual({ x: 1108, y: 480, width: 332, height: 420 });
    expect(
      fitSticky(
        { x: 0, y: -400, width: 332, height: 420 },
        { x: -1280, y: 0, width: 1280, height: 800 },
      ),
    ).toEqual({ x: -332, y: 0, width: 332, height: 420 });
  });
});
