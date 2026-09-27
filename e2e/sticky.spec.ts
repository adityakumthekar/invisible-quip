import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("protected sticky note shares tasks and can be hidden and reopened", async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "quip-sticky-e2e-"));
  const app = await electron.launch({ args: ["dist-electron/main.js"], env: { ...process.env, NODE_ENV: "development", INVISIBLE: "true", QUIP_E2E_USER_DATA: profile, QUIP_SUPABASE_URL: "", QUIP_SUPABASE_ANON_KEY: "", USE_QWEN: "true", USE_OLLAMA: "false", QWEN_BASE_URL: "http://127.0.0.1:1/v1", QWEN_API_KEY: "test", GEMINI_API_KEY: "", ELECTRON_RUN_AS_NODE: "" } });
  try {
    const overlay = await app.firstWindow();
    await overlay.getByRole("button", { name: "Open Today", exact: true }).click();
    await overlay.getByRole("button", { name: "Pin as sticky note", exact: true }).click();
    await expect.poll(() => app.windows().length).toBe(2);
    const sticky = app.windows().find(window => window !== overlay)!;
    await expect(sticky.getByRole("heading", { name: "A little focus.", exact: true })).toBeVisible();
    const native = await app.browserWindow(sticky);
    expect(await native.evaluate(window => ({ protected: window.isContentProtected(), floating: window.isAlwaysOnTop(), frame: window.hasShadow(), width: window.getBounds().width }))).toMatchObject({ protected: true, floating: true, frame: false, width: 332 });
    expect(await sticky.evaluate(() => ({ node: typeof (window as any).require, legacy: typeof (window as any).electronAPI, companion: typeof (window as any).companion }))).toEqual({ node: "undefined", legacy: "undefined", companion: "undefined" });
    await sticky.getByLabel("New sticky task", { exact: true }).fill("Finish my most important task");
    await sticky.getByRole("button", { name: "Add sticky task", exact: true }).click();
    await expect(overlay.getByRole("heading", { name: "Finish my most important task", exact: true })).toBeVisible();
    await sticky.getByRole("button", { name: "Complete Finish my most important task", exact: true }).click();
    await expect(sticky.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
    await sticky.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(sticky.getByText("Finish my most important task", { exact: true })).toBeVisible();
    await sticky.getByRole("button", { name: "Privacy", exact: true }).click();
    await expect(sticky.getByRole("note")).toContainText("Some macOS sharing and recording tools can still capture it.");
    await sticky.getByRole("button", { name: "Hide sticky note", exact: true }).click();
    expect(await native.evaluate(window => window.isVisible())).toBe(false);
    await overlay.getByRole("button", { name: "Pin as sticky note", exact: true }).click();
    await expect.poll(async () => native.evaluate(window => window.isVisible())).toBe(true);
    expect(app.windows()).toHaveLength(2);
    // Exercise the same coordinator used by the global hide shortcut.
    await app.evaluate((_electron, modulePath) => {
      const require = process.getBuiltinModule("module").createRequire(modulePath);
      require(modulePath).AppState.getInstance().toggleQuipWindows();
    }, path.resolve("dist-electron/main.js"));
    expect(await native.evaluate(window => window.isVisible())).toBe(false);
    const main = await app.browserWindow(overlay);
    expect(await main.evaluate(window => window.isVisible())).toBe(false);
    await app.evaluate((_electron, modulePath) => {
      const require = process.getBuiltinModule("module").createRequire(modulePath);
      require(modulePath).AppState.getInstance().toggleQuipWindows();
    }, path.resolve("dist-electron/main.js"));
    expect(await native.evaluate(window => window.isVisible())).toBe(true);
    await native.evaluate(window => window.setContentProtection(false)); // Capture a test-only visual preview.
    await sticky.getByRole("button", { name: "Privacy", exact: true }).click();
    await sticky.screenshot({ path: "test-results/today-sticky.png" });
    await sticky.keyboard.press("Escape");
    await expect.poll(async () => native.evaluate(window => window.isVisible())).toBe(false);
  } finally { await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
});
