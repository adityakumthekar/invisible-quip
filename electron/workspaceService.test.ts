import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { emptyWorkspace } from "./workspaceContract";
const auth = vi.hoisted(() => ({ session: null as any }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: auth.session },
        error: null,
      }),
      signOut: async () => {
        auth.session = null;
        return { error: null };
      },
    },
  }),
}));
vi.mock("electron", () => ({ safeStorage: {} }));
import { WorkspaceService } from "./WorkspaceService";
import type { WorkspaceStore } from "./workspaceStore";
let memory: Map<string, string>;
beforeEach(() => {
  memory = new Map();
  auth.session = null;
});
const store = () =>
  ({
    getItem: async (key: string) => memory.get(key) || null,
    setItem: async (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: async (key: string) => {
      memory.delete(key);
    },
  }) as WorkspaceStore;
const service = () =>
  new WorkspaceService(
    { supabaseUrl: "", supabaseAnonKey: "" },
    store(),
    () => {},
    () => {},
  );
describe("local workspace persistence", () => {
  it("starts without credentials and restores projects, drafts and saved outputs after restart", async () => {
    const first = service();
    await first.initialize();
    expect(first.snapshot().configured).toBe(false);
    const project = {
        id: randomUUID(),
        name: "Client work",
        instructions: "Use plain language",
        updatedAt: new Date().toISOString(),
      },
      conversation = {
        id: randomUUID(),
        projectId: project.id,
        title: "Brief",
        updatedAt: project.updatedAt,
      };
    await first.saveProject(project);
    await first.saveConversation(conversation);
    await first.saveDraft(conversation.id, "My unsent question");
    await first.saveOutput({
      id: randomUUID(),
      projectId: project.id,
      title: "Note",
      text: "A useful idea",
      updatedAt: project.updatedAt,
    });
    const restarted = service();
    await restarted.initialize();
    expect(restarted.snapshot().projects).toEqual([project]);
    expect(restarted.snapshot().drafts[conversation.id]).toBe(
      "My unsent question",
    );
    expect(restarted.snapshot().outputs[0].text).toBe("A useful idea");
  });
  it("does not lose a local draft when managed generation requires sign-in", async () => {
    const app = service();
    await app.initialize();
    const project = {
        id: randomUUID(),
        name: "Research",
        instructions: "",
        updatedAt: new Date().toISOString(),
      },
      conversation = {
        id: randomUUID(),
        projectId: project.id,
        title: "Draft",
        updatedAt: project.updatedAt,
      };
    await app.saveProject(project);
    await app.saveConversation(conversation);
    await app.saveDraft(conversation.id, "Keep me");
    await expect(
      app.generate({
        requestId: randomUUID(),
        conversationId: conversation.id,
        text: "Keep me",
        attachmentIds: [],
        sourceIds: [],
      }),
    ).rejects.toThrow(/Sign in/);
    expect(app.snapshot().drafts[conversation.id]).toBe("Keep me");
  });
  it("cascades local project deletion without deleting a different project", async () => {
    const app = service();
    await app.initialize();
    const a = {
        id: randomUUID(),
        name: "A",
        instructions: "",
        updatedAt: new Date().toISOString(),
      },
      b = { ...a, id: randomUUID(), name: "B" };
    await app.saveProject(a);
    await app.saveProject(b);
    await app.saveOutput({
      id: randomUUID(),
      projectId: a.id,
      title: "Note",
      text: "text",
      updatedAt: a.updatedAt,
    });
    await app.remove("Project", a.id);
    expect(app.snapshot().projects.map((p) => p.id)).toEqual([b.id]);
    expect(app.snapshot().outputs).toHaveLength(0);
  });
});

async function cloudFixture() {
  const project = {
    id: randomUUID(),
    name: "Cloud project",
    instructions: "",
    updatedAt: new Date().toISOString(),
  };
  const conversation = {
    id: randomUUID(),
    projectId: project.id,
    title: "Question",
    updatedAt: project.updatedAt,
  };
  auth.session = {
    user: { id: randomUUID(), email: "test@example.com" },
    access_token: "test-token",
  };
  const app = new WorkspaceService(
    { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public" },
    store(),
    () => {},
    () => {},
  );
  const data = {
    ...emptyWorkspace(),
    projects: [project],
    conversations: [conversation],
  };
  const transport = vi.spyOn(app, "api").mockImplementation(async (op) => {
    if (op === "snapshot") return structuredClone(data);
    if (op === "cancel") return { ok: true };
    throw new Error(`Unexpected operation ${op}`);
  });
  await app.initialize();
  await app.saveDraft(conversation.id, "First question");
  const input = {
    requestId: randomUUID(),
    conversationId: conversation.id,
    text: "First question",
    attachmentIds: [],
    sourceIds: [],
  };
  return { app, transport, data, input, project, conversation };
}
describe("cloud generation recovery", () => {
  it("keeps a new draft typed while the answer is streaming", async () => {
    const { app, transport, input } = await cloudFixture();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    transport.mockImplementation(async (op) => {
      if (op === "generate")
        return new Response(
          new ReadableStream({
            start(controller) {
              stream = controller;
            },
          }),
        );
      throw new Error("Offline during refresh");
    });
    const pending = app.generate(input);
    await vi.waitFor(() => expect(stream).toBeDefined());
    await app.saveDraft(input.conversationId, "Next question");
    stream.enqueue(
      new TextEncoder().encode('{"delta":"Useful answer"}\n{"done":true}\n'),
    );
    stream.close();
    await pending;
    expect(app.snapshot().drafts[input.conversationId]).toBe("Next question");
    expect(app.snapshot().messages.map((m) => m.text)).toEqual([
      "First question",
      "Useful answer",
    ]);
  });
  it("retains the submitted draft and partial answer when a stream ends without completion", async () => {
    const { app, transport, input } = await cloudFixture();
    transport.mockImplementation(async (op) => {
      if (op === "generate") return new Response('{"delta":"Partial"}\n');
      throw new Error("Offline");
    });
    await expect(app.generate(input)).rejects.toThrow(/connection ended/);
    expect(app.snapshot().drafts[input.conversationId]).toBe(input.text);
    expect(
      app.snapshot().messages.find((m) => m.text === "Partial")?.status,
    ).toBe("interrupted");
    expect(app.snapshot().generating).toBeNull();
  });
  it("waits for cancellation before clearing an account cache", async () => {
    const { app, transport, input } = await cloudFixture();
    let entered = false;
    transport.mockImplementation(async (op, _value, signal) => {
      if (op === "generate") {
        entered = true;
        return new Promise((_resolve, reject) =>
          signal!.addEventListener(
            "abort",
            () => reject(new DOMException("Stopped", "AbortError")),
            { once: true },
          ),
        );
      }
      if (op === "cancel") return { ok: true };
      throw new Error("Offline");
    });
    const pending = app.generate(input).catch((error) => error);
    await vi.waitFor(() => expect(entered).toBe(true));
    await app.signOut();
    expect((await pending).message).toMatch(/Stopped/);
    expect(app.snapshot().account).toBeNull();
    expect(app.snapshot().messages).toEqual([]);
    expect(
      [...memory.keys()].filter((key) => key !== "workspace-local"),
    ).toEqual([]);
  });
  it("includes a selected saved image in the managed request", async () => {
    const { app, transport, data, input, project } = await cloudFixture();
    const imageId = randomUUID();
    data.sources.push({
      id: imageId,
      projectId: project.id,
      name: "Diagram.png",
      mimeType: "image/png",
      size: 100,
      kind: "image",
      status: "ready",
      createdAt: project.updatedAt,
    });
    await app.refresh();
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    vi.spyOn(app, "readSource").mockResolvedValue({
      preview: `data:image/png;base64,${bytes.toString("base64")}`,
    });
    let request: any;
    transport.mockImplementation(async (op, value) => {
      if (op === "generate") {
        request = value;
        return new Response('{"delta":"A diagram"}\n{"done":true}\n');
      }
      return structuredClone(data);
    });
    await app.generate({ ...input, sourceIds: [imageId] });
    expect(request.attachments).toHaveLength(1);
    expect(request.attachments[0]).toMatchObject({
      name: "Diagram.png",
      mimeType: "image/jpeg",
    });
    expect(
      await sharp(
        Buffer.from(request.attachments[0].data, "base64"),
      ).metadata(),
    ).toMatchObject({ format: "jpeg" });
  });
  it("does not erase an unrelated project draft when deleting a note", async () => {
    const app = service();
    await app.initialize();
    const project = {
      id: randomUUID(),
      name: "Local",
      instructions: "",
      updatedAt: new Date().toISOString(),
    };
    await app.saveProject(project);
    await app.saveDraft(project.id, "Draft before creating a conversation");
    const note = {
      id: randomUUID(),
      projectId: project.id,
      title: "Note",
      text: "Text",
      updatedAt: project.updatedAt,
    };
    await app.saveOutput(note);
    await app.remove("Output", note.id);
    expect(app.snapshot().drafts[project.id]).toBe(
      "Draft before creating a conversation",
    );
  });
});
