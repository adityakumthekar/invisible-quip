import { describe, expect, it, vi } from "vitest";
import { AgentTaskService, scopeFailure } from "./agentTaskService";
import type { ContextSnapshot, Responsibility, StandingAuthority } from "./companionContract";
import type { TeachingStepResult } from "./teaching";
const authority: StandingAuthority = { apps: ["com.test.Editor"], targets: ["Client brief"], actions: ["click", "type", "key", "wait"], maxSteps: 5, maxMinutes: 10 };
const context = (): ContextSnapshot => ({ id: "context-1", app: { bundleId: "com.test.Editor", name: "Editor" }, window: { id: 42, title: "Client brief", document: "", bounds: { x: 0, y: 0, width: 1000, height: 800 } }, text: "Launch on Friday", selectedText: "", fingerprint: "fresh", observedAt: "2026-09-10T08:00:00.000Z" });
const step: TeachingStepResult = { state: "step", action: "type", risk: "confirm", instruction: "Write the summary", text: "Launch on Friday", target: { x: 20, y: 30, width: 100, height: 20 }, displayId: 1, displayBounds: { x: 0, y: 0, width: 1000, height: 800 } };
function setup() {
  let time = Date.parse("2026-09-10T08:00:00Z");
  const save = vi.fn(async () => {}), start = vi.fn(async () => {}), stop = vi.fn(), observe = vi.fn(async () => context());
  const tasks = new AgentTaskService({ save, start, stop, observe, busy: () => false, emit: vi.fn(), now: () => time });
  return { tasks, save, start, stop, observe, advance: (ms: number) => { time += ms; } };
}
const responsibility = (): Responsibility => ({ id: "responsibility-1", title: "Prepare launch brief", goal: "Prepare the launch brief", enabled: true, authority, trigger: { kind: "context", app: "com.test.Editor", contains: "Launch" } });
describe("standing authority", () => {
  it("requires actual app, target, action, and window bounds to match", () => {
    expect(scopeFailure(authority, step, context())).toBeNull();
    expect(scopeFailure(authority, step, null)).toMatch(/cannot be verified/);
    expect(scopeFailure(authority, step, { ...context(), app: { bundleId: "other", name: "Other" } })).toMatch(/not authorized/);
    expect(scopeFailure(authority, step, { ...context(), window: { title: "Private", document: "" } })).toMatch(/outside/);
    expect(scopeFailure(authority, { ...step, action: "drag" }, context())).toMatch(/not authorized/);
    expect(scopeFailure(authority, { ...step, target: { x: 1200, y: 20, width: 1, height: 1 } }, context())).toMatch(/outside/);
  });
});
describe("persistent delegated work", () => {
  it("serializes runs and persists authorization before starting", async () => {
    const { tasks, start, save } = setup();
    await Promise.all([tasks.enqueue({ goal: "First", authority }), tasks.enqueue({ goal: "Second", authority })]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0]);
    expect(tasks.state.runs.map(run => run.phase)).toEqual(["thinking", "queued"]);
  });
  it("writes a checkpoint before allowing an authorized action", async () => {
    const { tasks, save } = setup();
    await tasks.enqueue({ goal: "Write brief", authority }); await tasks.capturePlanContext();
    expect(await tasks.authorize(step)).toBe(true);
    await tasks.beforeAction(step);
    expect(tasks.current()?.uncertainAction).toBe(true);
    expect(tasks.current()?.checkpoint).toContain("Pending verification");
    expect(save).toHaveBeenCalled();
  });
  it("blocks stale screen plans and stops before deferred actuation can proceed", async () => {
    const { tasks, observe } = setup();
    await tasks.enqueue({ goal: "Write brief", authority }); await tasks.capturePlanContext();
    observe.mockResolvedValue({ ...context(), fingerprint: "changed" });
    await expect(tasks.beforeAction(step)).rejects.toThrow(/target changed/);
    let resolve!: (value: ContextSnapshot) => void;
    observe.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = tasks.beforeAction(step); await tasks.stop(); resolve(context());
    await expect(pending).rejects.toThrow(/stopped/);
    expect(tasks.state.runs[0].phase).toBe("stopped");
  });
  it("fires a context responsibility once per matching episode, including after restart", async () => {
    const { tasks, start } = setup();
    await tasks.saveResponsibility(responsibility());
    await tasks.tick(context()); await tasks.tick(context());
    expect(start).toHaveBeenCalledTimes(1); expect(tasks.state.runs).toHaveLength(1);
    const restored = setup(); await restored.tasks.recover(structuredClone(tasks.state));
    await restored.tasks.tick(context()); expect(restored.start).not.toHaveBeenCalled();
    expect(restored.tasks.state.runs[0].phase).toBe("paused");
  });
  it("advances missed schedules without replaying a backlog", async () => {
    const { tasks } = setup();
    await tasks.saveResponsibility({ ...responsibility(), trigger: { kind: "schedule", everyMinutes: 5, nextAt: "2026-09-09T00:00:00.000Z" } });
    await tasks.tick(null); await tasks.tick(null);
    expect(tasks.state.runs).toHaveLength(1);
    expect(tasks.state.responsibilities[0].trigger).toMatchObject({ nextAt: "2026-09-10T08:05:00.000Z" });
  });
  it("pauses on lock and requires reconciliation after an interrupted action", async () => {
    const { tasks, start } = setup();
    await tasks.enqueue({ goal: "Write brief", authority }); await tasks.capturePlanContext(); await tasks.beforeAction(step);
    await tasks.suspend(); tasks.wake();
    const run = tasks.state.runs[0];
    await expect(tasks.resume(run.id, false)).rejects.toThrow(/Review/);
    await tasks.resume(run.id, true);
    expect(start).toHaveBeenCalledTimes(2); expect(start.mock.calls[1][0]).toContain("Previous verified progress");
  });
  it("honors time and step limits without widening permissions on resume", async () => {
    const { tasks, advance } = setup();
    await tasks.enqueue({ goal: "Write brief", authority }); advance(11 * 60000); await tasks.tick(context());
    expect(tasks.state.runs[0].phase).toBe("blocked");
    await expect(tasks.resume(tasks.state.runs[0].id, true)).rejects.toThrow(/expired/);
  });
  it("does not run if observing the target fails", async () => {
    const { tasks, observe, start } = setup(); observe.mockResolvedValue(null as any);
    await tasks.enqueue({ goal: "Write brief", authority });
    expect(start).not.toHaveBeenCalled(); expect(tasks.state.runs[0].phase).toBe("blocked");
  });
});
