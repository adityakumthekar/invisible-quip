import { describe, expect, it, vi } from "vitest";
import {
  DailyTaskService,
  evidenceId,
  supportedDeadline,
} from "./dailyTaskService";
import { localDay, type TaskEvidence } from "./dailyTaskContract";
const goal = {
  id: "12345678-1234-4234-8234-123456789abc",
  text: "Finish the launch",
};
const source = (
  id = "brief",
  kind: TaskEvidence["kind"] = "desktop",
  excerpt = "I will send the launch brief by September 20, 2026.",
): TaskEvidence => ({
  id,
  sourceId: `source:${id}`,
  kind,
  app: "com.test.editor",
  title: "Launch brief",
  excerpt,
  observedAt: new Date(2026, 8, 19, 0).toISOString(),
  projectId: null,
});
const candidate = (evidence = "brief", extra = {}) => ({
  title: "Send the launch brief",
  details: "Keep your launch commitment",
  provenance: "commitment",
  commitmentQuote: "I will send the launch brief",
  evidenceIds: [evidence],
  goalIds: [goal.id],
  deadline: { day: "2026-09-20", quote: "September 20, 2026" },
  existingTaskId: null,
  ...extra,
});
async function setup() {
  let now = new Date(2026, 8, 19, 0).getTime(),
    identity: string | null = null,
    blocked: string | null = null;
  const files = new Map<string, string>();
  const answer = vi.fn(async () =>
    JSON.stringify({ candidates: [candidate()] }),
  );
  const changed = vi.fn();
  const deps = {
    store: {
      getItem: async (key: string) => files.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        files.set(key, value);
      },
    },
    answer,
    identity: () => identity,
    blocked: () => blocked,
    changed,
    now: () => now,
  };
  const service = new DailyTaskService(deps);
  await service.setAccount(null);
  await service.configure({ enabled: true, goals: [goal] });
  return {
    service,
    deps,
    files,
    answer,
    advance: (ms: number) => {
      now += ms;
    },
    block: (value: string | null) => {
      blocked = value;
    },
    account: (value: string | null) => {
      identity = value;
    },
  };
}
const edit = (title: string, day: string | null = "2026-09-19") => ({
  title,
  details: "",
  dueAt: null,
  plannedDay: day,
  goalIds: [],
});
async function suggest(service: DailyTaskService) {
  await service.ingest([source()]);
  await service.refresh(true);
  return service.snapshot().tasks[0];
}

describe("Quip Today", () => {
  it("starts disabled, preserves unrelated storage, and rejects broken saved state", async () => {
    const { deps, files } = await setup();
    files.clear();
    files.set("assistant-local", "existing assistant");
    const fresh = new DailyTaskService(deps);
    await fresh.setAccount(null);
    expect(fresh.snapshot().preferences.enabled).toBe(false);
    files.set("today-local", "broken");
    const broken = new DailyTaskService(deps);
    await broken.setAccount(null);
    expect(broken.snapshot().ready).toBe(false);
    await expect(
      broken.change({ kind: "save", data: edit("Test") }),
    ).rejects.toThrow();
    expect(files.get("today-local")).toBe("broken");
    expect(files.get("assistant-local")).toBe("existing assistant");
  });
  it("creates evidence-backed suggestions without accepting or completing them", async () => {
    const { service } = await setup();
    const task = await suggest(service);
    expect(task).toMatchObject({
      status: "suggested",
      provenance: "commitment",
      dueAt: "2026-09-20",
      plannedDay: null,
      completedAt: null,
    });
    expect(task.evidence[0].excerpt).toContain("launch brief");
    expect(service.snapshot().pending).toBe(0);
  });
  it("supports accept, edit, defer, complete, undo and deletion across restarts", async () => {
    const { service, deps } = await setup();
    const task = await suggest(service);
    await service.change({
      kind: "status",
      id: task.id,
      status: "todo",
      plannedDay: "2026-09-19",
    });
    await service.change({
      kind: "save",
      id: task.id,
      data: { ...edit("My revised task", "2026-09-22"), dueAt: task.dueAt },
    });
    await service.change({ kind: "status", id: task.id, status: "done" });
    const restarted = new DailyTaskService(deps);
    await restarted.setAccount(null);
    expect(restarted.snapshot().tasks[0]).toMatchObject({
      title: "My revised task",
      plannedDay: "2026-09-22",
      dueAt: "2026-09-20",
      status: "done",
    });
    await restarted.change({ kind: "status", id: task.id, status: "todo" });
    expect(restarted.snapshot().tasks[0].completedAt).toBeNull();
    await restarted.change({ kind: "delete", id: task.id });
    expect(restarted.snapshot().tasks).toHaveLength(0);
  });
  it("rejects invented evidence atomically and retains the queued input for retry", async () => {
    const { service, answer } = await setup();
    answer.mockResolvedValue(
      JSON.stringify({ candidates: [candidate(), candidate("invented")] }),
    );
    await suggest(service);
    expect(service.snapshot().tasks).toHaveLength(0);
    expect(service.snapshot().pending).toBe(1);
    expect(service.snapshot().error).toContain("unavailable evidence");
  });
  it("does not turn assistant text or unquoted inferences into commitments", async () => {
    const { service, answer } = await setup();
    await service.ingest([source("ai", "assistant")]);
    answer.mockResolvedValue(JSON.stringify({ candidates: [candidate("ai")] }));
    await service.refresh(true);
    expect(service.snapshot().tasks).toHaveLength(0);
    answer.mockResolvedValue(
      JSON.stringify({
        candidates: [
          candidate("user", {
            commitmentQuote: "invented promise",
            deadline: { day: "2026-09-20", quote: "Friday" },
          }),
        ],
      }),
    );
    await service.ingest([
      source("user", "user", "Researching a launch on Friday"),
    ]);
    await service.refresh(true);
    expect(service.snapshot().tasks[0]).toMatchObject({
      provenance: "inferred",
      dueAt: null,
    });
    expect(supportedDeadline("2026-09-20", "by 2026-09-20")).toBe(true);
    expect(supportedDeadline("2026-09-20", "20 September 2026")).toBe(true);
    expect(supportedDeadline("2026-09-20", "Friday or 09/20")).toBe(false);
  });
  it("deduplicates observations and merges evidence without overwriting edits", async () => {
    const { service, answer } = await setup();
    const task = await suggest(service);
    await service.ingest([source()]);
    expect(service.snapshot().pending).toBe(0);
    await service.change({
      kind: "status",
      id: task.id,
      status: "todo",
      plannedDay: "2026-09-19",
    });
    await service.change({
      kind: "save",
      id: task.id,
      data: edit("My own wording"),
    });
    await service.ingest([source("repeat")]);
    answer.mockResolvedValue(
      JSON.stringify({
        candidates: [candidate("repeat", { existingTaskId: task.id })],
      }),
    );
    await service.refresh(true);
    expect(service.snapshot().tasks).toHaveLength(1);
    expect(service.snapshot().tasks[0]).toMatchObject({
      title: "My own wording",
      dueAt: null,
      status: "todo",
    });
    expect(service.snapshot().tasks[0].evidence).toHaveLength(2);
    expect(evidenceId("window", "Same   text!")).toBe(
      evidenceId("window", "same text"),
    );
  });
  it.each(["done", "dismissed", "deleted"])(
    "suppresses %s tasks",
    async (status) => {
      const { service, answer } = await setup();
      const task = await suggest(service);
      if (status === "deleted")
        await service.change({ kind: "delete", id: task.id });
      else
        await service.change({
          kind: "status",
          id: task.id,
          status: status as "done" | "dismissed",
        });
      await service.ingest([source("repeat")]);
      answer.mockResolvedValue(
        JSON.stringify({ candidates: [candidate("repeat")] }),
      );
      await service.refresh(true);
      expect(
        service.snapshot().tasks.filter((task) => task.status === "suggested"),
      ).toHaveLength(0);
    },
  );
  it("preserves user order across extraction and day rollover without changing deadlines", async () => {
    const { service, advance } = await setup();
    await service.change({ kind: "save", data: edit("One") });
    advance(1);
    await service.change({ kind: "save", data: edit("Two") });
    const second = service
      .snapshot()
      .tasks.find((task) => task.title === "Two")!;
    await service.change({ kind: "move", id: second.id, direction: "up" });
    await suggest(service);
    advance(86400000);
    expect(service.snapshot().day).toBe("2026-09-20");
    expect(service.snapshot().tasks[0].title).toBe("Two");
    expect(service.snapshot().tasks[0].plannedDay).toBe("2026-09-19");
    expect(
      service
        .snapshot()
        .tasks.find((task) => task.title === "Send the launch brief")!.dueAt,
    ).toBe("2026-09-20");
  });
  it("throttles changed-content batches, persists a daily budget and allows explicit refresh", async () => {
    const { service, answer, advance, deps } = await setup();
    answer.mockResolvedValue('{"candidates":[]}');
    for (let i = 0; i < 25; i++) {
      await service.ingest([source(String(i))]);
      await service.refresh();
      if (i === 0) {
        await service.ingest([source("quick")]);
        await service.refresh();
        expect(answer).toHaveBeenCalledTimes(1);
      }
      advance(15 * 60000);
    }
    expect(answer).toHaveBeenCalledTimes(24);
    const restarted = new DailyTaskService(deps);
    await restarted.setAccount(null);
    await restarted.refresh();
    expect(answer).toHaveBeenCalledTimes(24);
    await restarted.refresh(true);
    expect(answer).toHaveBeenCalledTimes(25);
    advance(86400000);
    await restarted.ingest([
      { ...source("next-day"), observedAt: new Date(deps.now()).toISOString() },
    ]);
    await restarted.refresh();
    expect(answer).toHaveBeenCalledTimes(26);
  });
  it("keeps lists usable on provider failure and retries pending evidence", async () => {
    const { service, answer } = await setup();
    answer.mockRejectedValueOnce(new Error("Provider offline"));
    await suggest(service);
    expect(service.snapshot().error).toBe("Provider offline");
    expect(service.snapshot().pending).toBe(1);
    await service.change({ kind: "save", data: edit("Offline task") });
    await service.refresh(true);
    expect(service.snapshot().tasks).toHaveLength(2);
    expect(service.snapshot().error).toBeNull();
  });
  it("pauses collection and inference when disabled, locked or busy", async () => {
    const { service, answer, block } = await setup();
    block("Locked");
    await service.ingest([source()]);
    expect(service.snapshot().pending).toBe(0);
    block(null);
    await service.ingest([source()]);
    block("Busy");
    await service.refresh(true);
    expect(answer).not.toHaveBeenCalled();
    block(null);
    await service.configure({ enabled: false, goals: [goal] });
    await service.refresh(true);
    expect(answer).not.toHaveBeenCalled();
    expect(service.snapshot().pending).toBe(1);
  });
  it("discards late responses after cancellation and source removal", async () => {
    const { service, answer } = await setup();
    let resolve!: (value: string) => void;
    answer.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await service.ingest([source()]);
    const work = service.refresh(true);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await service.removeSources(() => true);
    resolve(JSON.stringify({ candidates: [candidate()] }));
    await work;
    expect(service.snapshot().tasks).toHaveLength(0);
    expect(service.snapshot().pending).toBe(0);
  });
  it("removes excluded evidence and forgets context while keeping accepted task text", async () => {
    const { service } = await setup();
    const task = await suggest(service);
    await service.change({
      kind: "status",
      id: task.id,
      status: "todo",
      plannedDay: "2026-09-19",
    });
    await service.removeSources((source) => source.app === "com.test.editor");
    expect(service.snapshot().tasks[0].evidence).toHaveLength(0);
    await service.forget();
    await service.ingest([source()]);
    expect(service.snapshot().pending).toBe(0);
    expect(service.snapshot().tasks[0].title).toBe(task.title);
  });
  it("isolates accounts and prevents late results from crossing identities", async () => {
    const { service, answer, account } = await setup();
    const task = await suggest(service);
    let resolve!: (value: string) => void;
    answer.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await service.ingest([source("new")]);
    const work = service.refresh(true);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    account("account-b");
    expect(service.snapshot().tasks).toHaveLength(0);
    await service.setAccount("account-b");
    resolve(JSON.stringify({ candidates: [candidate("new")] }));
    await work;
    expect(service.snapshot().tasks).toHaveLength(0);
    await service.change({ kind: "save", data: edit("B task") });
    account(null);
    await service.setAccount(null);
    expect(service.snapshot().tasks.map((task) => task.title)).toEqual([
      task.title,
    ]);
  });
  it("reserves a single inference slot for concurrent refreshes", async () => {
    const { service, answer } = await setup();
    let resolve!: (text: string) => void;
    answer.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await service.ingest([source()]);
    const first = service.refresh(true),
      second = service.refresh(true);
    await vi.waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    resolve(JSON.stringify({ candidates: [candidate()] }));
    await Promise.all([first, second]);
    expect(service.snapshot().tasks).toHaveLength(1);
  });
  it("rechecks permissions before applying a response", async () => {
    const { deps, answer } = await setup();
    let allowed = true,
      resolve!: (text: string) => void;
    const service = new DailyTaskService({ ...deps, allowed: () => allowed });
    await service.setAccount(null);
    answer.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await service.ingest([source()]);
    const work = service.refresh(true);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    allowed = false;
    resolve(JSON.stringify({ candidates: [candidate()] }));
    await work;
    expect(service.snapshot().tasks).toHaveLength(0);
    expect(service.snapshot().pending).toBe(0);
  });
  it("persists expiry even without another successful review", async () => {
    const { service, advance, files } = await setup();
    await service.ingest([source()]);
    advance(8 * 86400000);
    await service.refresh();
    expect(JSON.parse(files.get("today-local")!).pending).toEqual([]);
  });
  it("cancels a pending response when settings change", async () => {
    const { service, answer } = await setup();
    let resolve!: (text: string) => void;
    answer.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await service.ingest([source()]);
    const work = service.refresh(true);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await service.configure({ enabled: false, goals: [] });
    resolve(JSON.stringify({ candidates: [candidate()] }));
    await work;
    expect(service.snapshot().tasks).toHaveLength(0);
    expect(service.snapshot().pending).toBe(1);
  });
  it("caps suggestions at ten and pending excerpts at 200 with seven-day expiry", async () => {
    const { service, answer, advance } = await setup();
    for (let i = 0; i < 3; i++) {
      await service.ingest([source(`batch${i}`)]);
      answer.mockResolvedValue(
        JSON.stringify({
          candidates: Array.from({ length: 5 }, (_, j) =>
            candidate(`batch${i}`, { title: `Task ${i}-${j}` }),
          ),
        }),
      );
      await service.refresh(true);
    }
    expect(service.snapshot().tasks).toHaveLength(10);
    await service.ingest(
      Array.from({ length: 250 }, (_, i) => source(`queue${i}`)),
    );
    expect(service.snapshot().pending).toBe(200);
    advance(8 * 86400000);
    await service.refresh();
    expect(service.snapshot().pending).toBe(0);
    expect(service.snapshot().tasks[0].evidence).toHaveLength(1);
  });
});
