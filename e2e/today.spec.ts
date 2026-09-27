import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";

test("Today shares accepted suggestions between windows and restores completed work", async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "quip-today-e2e-"));
  // A local streaming provider fixture exercises the real adapter without using a live AI account.
  const provider = createServer(async (request, response) => {
    if (request.url?.endsWith("/models")) {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({ data: [{ id: "fixture", max_model_len: 32768 }] }),
      );
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const system =
      body.messages.find((message: any) => message.role === "system")
        ?.content ?? "";
    let result;
    if (system.includes("daily task suggestions")) {
      const content = body.messages.find(
        (message: any) => message.role === "user",
      ).content;
      const input = JSON.parse(
        typeof content === "string"
          ? content
          : content.find((part: any) => part.type === "text").text,
      );
      const evidence = input.sources.find((item: any) => item.kind === "note");
      result = {
        candidates: evidence
          ? [
              {
                title: "Send the launch brief",
                details: "Follow through on your saved launch commitment.",
                provenance: "commitment",
                commitmentQuote: "I will send the launch brief",
                evidenceIds: [evidence.id],
                goalIds: input.goals.map((goal: any) => goal.id),
                deadline: null,
                existingTaskId: null,
              },
            ]
          : [],
      };
    } else
      result = {
        title: "Launch draft",
        answer: "Here is a starting point.",
        blocks: [
          { kind: "draft", id: "draft", title: "Draft", text: "Launch brief" },
        ],
      };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  const port = (provider.address() as { port: number }).port;
  const launch = () =>
    electron.launch({
      args: ["dist-electron/main.js"],
      env: {
        ...process.env,
        NODE_ENV: "development",
        INVISIBLE: "false",
        QUIP_E2E_USER_DATA: profile,
        QUIP_SUPABASE_URL: "",
        QUIP_SUPABASE_ANON_KEY: "",
        USE_QWEN: "true",
        USE_OLLAMA: "false",
        QWEN_BASE_URL: `http://127.0.0.1:${port}/v1`,
        QWEN_MODEL: "fixture",
        QWEN_API_KEY: "test",
        GEMINI_API_KEY: "",
        ELECTRON_RUN_AS_NODE: "",
      },
    });
  let app: ElectronApplication | undefined;
  try {
    app = await launch();
    const overlay = await app.firstWindow();
    await overlay.waitForLoadState("domcontentloaded");
    await overlay
      .getByRole("button", { name: "Open Today", exact: true })
      .click();
    await expect(
      overlay.getByRole("heading", { name: "Today", exact: true }),
    ).toBeVisible();
    await expect(
      overlay.getByLabel("Suggest tasks from my activity"),
    ).not.toBeChecked();
    await overlay
      .getByRole("button", { name: "Set goals", exact: true })
      .click();
    await overlay.getByLabel("Goal 1", { exact: true }).fill("Ship the launch");
    await overlay
      .getByRole("button", { name: "Save goals", exact: true })
      .click();
    await overlay
      .getByRole("button", { name: "Saved work and documents", exact: true })
      .click();
    await expect.poll(() => app!.windows().length).toBe(2);
    const workspace = app.windows().find((window) => window !== overlay)!;
    await workspace
      .getByRole("button", { name: "Start with local drafts", exact: true })
      .click();
    await workspace.getByRole("button", { name: "Today", exact: true }).click();
    await expect(
      workspace.getByText("Ship the launch", { exact: true }),
    ).toBeVisible();
    await workspace
      .getByRole("button", { name: "Add task", exact: true })
      .click();
    await workspace
      .getByLabel("Task title", { exact: true })
      .fill("Review the launch checklist");
    await workspace
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    await expect(
      overlay.getByRole("heading", {
        name: "Review the launch checklist",
        exact: true,
      }),
    ).toBeVisible();

    await workspace.evaluate(async () => {
      const id = crypto.randomUUID();
      const updatedAt = new Date().toISOString();
      await window.workspace.saveProject({
        id,
        name: "Launch",
        instructions: "",
        updatedAt,
      });
      await window.workspace.saveOutput({
        id: crypto.randomUUID(),
        projectId: id,
        title: "Launch commitment",
        text: "I will send the launch brief to the team.",
        updatedAt,
      });
    });
    await workspace.getByLabel("Suggest tasks from my activity").check();
    await workspace
      .getByRole("button", { name: "Refresh suggestions", exact: true })
      .click();
    const suggestion = workspace.getByRole("article", {
      name: "Send the launch brief",
      exact: true,
    });
    await expect(
      suggestion.getByText("Explicit commitment", { exact: true }),
    ).toBeVisible();
    await suggestion.getByText("Supporting context · 1").click();
    await expect(
      suggestion.getByText("I will send the launch brief to the team.", {
        exact: true,
      }),
    ).toBeVisible();
    await suggestion
      .getByRole("button", { name: "Add to Today", exact: true })
      .click();
    const overlayTask = overlay.getByRole("article", {
      name: "Send the launch brief",
      exact: true,
    });
    await expect(
      overlayTask.getByRole("button", {
        name: "Complete Send the launch brief",
        exact: true,
      }),
    ).toBeVisible();
    await workspace.locator(".qw-today").evaluate((element) => {
      element.scrollTop = 0;
    });
    await workspace.screenshot({ path: "test-results/today-workspace.png" });
    await overlay
      .locator(".qc-root")
      .screenshot({ path: "test-results/today-overlay.png" });
    await overlayTask
      .getByRole("button", {
        name: "Complete Send the launch brief",
        exact: true,
      })
      .click();
    await workspace.getByText("Completed · 1", { exact: true }).click();
    await expect(
      suggestion.getByRole("button", { name: "Undo completion", exact: true }),
    ).toBeVisible();
    expect(
      await workspace.evaluate(() => ({
        require: typeof (window as any).require,
        invoke: typeof (window.companion as any).invoke,
      })),
    ).toEqual({ require: "undefined", invoke: "undefined" });
    await app.close();
    app = await launch();
    const restored = await app.firstWindow();
    await restored
      .getByRole("button", { name: "Open Today", exact: true })
      .click();
    await expect(
      restored.getByText("Ship the launch", { exact: true }).first(),
    ).toBeVisible();
    await restored.getByText("Completed · 1", { exact: true }).click();
    await restored
      .getByRole("article", { name: "Send the launch brief", exact: true })
      .getByRole("button", { name: "Undo completion", exact: true })
      .click();
    await expect(
      restored.getByRole("button", {
        name: "Complete Send the launch brief",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await app?.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
    await fs.rm(profile, { recursive: true, force: true });
  }
});
