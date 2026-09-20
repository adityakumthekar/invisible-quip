import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
test("a fresh Mac build supports private local work, persistence, and a shared overlay", async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "quip-e2e-"));
  const launch = () =>
    electron.launch({
      args: ["dist-electron/main.js"],
      env: {
        ...process.env,
        NODE_ENV: "development",
        INVISIBLE: "false",
        USE_QWEN: "true",
        USE_OLLAMA: "false",
        QWEN_BASE_URL: "http://127.0.0.1:1/v1",
        QWEN_API_KEY: "test",
        GEMINI_API_KEY: "",
        QUIP_E2E_USER_DATA: profile,
        QUIP_LEGACY_FEATURES: "false",
        QUIP_SUPABASE_URL: "",
        QUIP_SUPABASE_ANON_KEY: "",
        ELECTRON_RUN_AS_NODE: "",
      },
    });
  let app = await launch();
  try {
    for (const name of ["brief.pdf", "brief.docx"]) {
      const extracted = await app.evaluate(
        async ({ utilityProcess }, { worker, source }) => {
          return await new Promise<any>((resolve, reject) => {
            const child = utilityProcess.fork(worker, [], { stdio: "pipe" });
            const timeout = setTimeout(() => {
              child.kill();
              reject(new Error("Extraction timed out"));
            }, 15000);
            child.on("spawn", () => child.postMessage({ path: source }));
            child.on("message", (message) => {
              clearTimeout(timeout);
              child.kill();
              resolve(message);
            });
            child.on("exit", (code) => {
              clearTimeout(timeout);
              if (code) reject(new Error(`Extraction exited ${code}`));
            });
          });
        },
        {
          worker: path.resolve("dist-electron/documentWorker.js"),
          source: path.resolve("electron/fixtures", name),
        },
      );
      expect(extracted.error).toBeUndefined();
      expect(extracted.sections[0].text).toContain(
        "Launch deadline is Friday.",
      );
      if (name.endsWith(".pdf")) expect(extracted.sections[0].page).toBe(1);
    }
    const overlay = await app.firstWindow();
    await overlay.getByRole("button", { name: "Saved work and documents", exact: true }).click();
    await expect.poll(() => app.windows().length).toBe(2);
    const page = app.windows().find(window => window !== overlay)!;
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("button", { name: "Start with local drafts" }).click();
    await page
      .getByRole("button", { name: "Create your first project" })
      .click();
    await page.getByLabel("Project name").fill("Client launch");
    await page
      .getByLabel("Project instructions")
      .fill("Use plain language. The audience is the client team.");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Client launch", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
    await page
      .getByLabel("Message Quip")
      .fill("Draft a concise project update.");
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            Object.values((await window.workspace.snapshot()).drafts)[0],
        ),
      )
      .toBe("Draft a concise project update.");
    await page.getByRole("tab", { name: "Saved work" }).click();
    await page.getByRole("button", { name: "New note" }).click();
    await page.getByLabel("Title", { exact: true }).fill("Launch decisions");
    await page
      .getByLabel("Note or draft")
      .fill("Keep the scope focused and share the brief on Friday.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Launch decisions" }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/workspace.png" });
    await overlay.evaluate(() => window.workspace.toggleOverlay());
    await page
      .getByRole("button", { name: "Open assistant", exact: true })
      .click();
    await expect.poll(() => app.windows().length).toBe(2);
    await expect.poll(async () => (await overlay.evaluate(() => window.workspace.snapshot())).activeProjectId).toBe(
      (await page.evaluate(() => window.workspace.snapshot())).activeProjectId!,
    );
    await expect.poll(async () => Object.values((await overlay.evaluate(() => window.workspace.snapshot())).drafts)[0]).toBe("Draft a concise project update.");
    await overlay.screenshot({ path: "test-results/assistant.png" });
    await app.close();
    app = await launch();
    const restoredOverlay = await app.firstWindow();
    await restoredOverlay.getByRole("button", { name: "Saved work and documents", exact: true }).click();
    await expect.poll(() => app.windows().length).toBe(2);
    const restored = app.windows().find(window => window !== restoredOverlay)!;
    await expect(
      restored.getByRole("heading", { name: "Client launch", exact: true }),
    ).toBeVisible();
    await expect(restored.getByLabel("Message Quip")).toHaveValue(
      "Draft a concise project update.",
    );
    await restored.getByRole("tab", { name: "Saved work" }).click();
    await expect(
      restored.getByRole("heading", { name: "Launch decisions" }),
    ).toBeVisible();
    // The renderer gets no Node primitives, generic IPC or provider credentials.
    expect(
      await restored.evaluate(() => ({
        node: typeof (window as any).require,
        invoke: typeof (window.workspace as any).invoke,
      })),
    ).toEqual({ node: "undefined", invoke: "undefined" });
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
