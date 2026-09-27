import { describe, expect, it, vi } from "vitest";
import { ContextService, type Observation } from "./contextService";

const observation = (): Observation => ({ app: { bundleId: "com.test.Editor", name: "Editor" }, window: { id: 42, title: "Client brief", document: "file:///brief.txt" }, text: "Launch on Friday", selectedText: "", image: Buffer.from("frame") });
function setup() {
  let time = Date.parse("2026-09-10T08:00:00Z");
  const observe = vi.fn(async () => observation());
  const context = new ContextService({ observe, changed: vi.fn(), now: () => time });
  context.configure({ enabled: true, paused: false, apps: ["com.test.Editor"], excludedApps: [], preferences: "Use concise English" });
  return { context, observe, advance: (ms: number) => { time += ms; } };
}
describe("ongoing context", () => {
  it("collects once for concurrent consumers and deduplicates unchanged observations", async () => {
    const { context, observe } = setup();
    await Promise.all([context.refresh(), context.refresh()]);
    await context.refresh();
    expect(observe).toHaveBeenCalledTimes(2);
    expect(context.memory.sources).toHaveLength(1);
    expect(context.prompt()).toContain("Launch on Friday");
    expect(context.prompt()).toContain("Use concise English");
  });
  it("bounds automatic captures but refreshes before explicit work", async () => {
    const { context, observe, advance } = setup();
    await context.refresh(); advance(5000); await context.refresh(); await context.refresh(true);
    expect(observe.mock.calls.map(args => (args as unknown[])[0])).toEqual([true, false, true]);
  });
  it("does not retain disallowed or secure content", async () => {
    const { context, observe } = setup();
    observe.mockResolvedValue({ ...observation(), secure: true });
    await context.refresh(); expect(context.current).toBeNull(); expect(context.memory.sources).toHaveLength(0);
    observe.mockResolvedValue({ ...observation(), app: { bundleId: "com.test.Private", name: "Private" } });
    await context.refresh(); expect(context.imageForCurrent()).toBeUndefined();
  });
  it("discards in-flight observations when permissions change or memory is cleared", async () => {
    const { context, observe } = setup();
    let resolve!: (value: Observation) => void;
    observe.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = context.refresh(); context.forget(); resolve(observation()); await pending;
    expect(context.current).toBeNull(); expect(context.memory.sources).toHaveLength(0);
  });
  it("removes excluded memories and drops stale screenshots on window changes", async () => {
    const { context, observe } = setup();
    await context.refresh();
    observe.mockResolvedValue({ ...observation(), window: { id: 43, title: "Different task", document: "" }, image: undefined });
    await context.refresh(); expect(context.imageForCurrent()).toBeUndefined();
    context.configure({ ...context.settings, excludedApps: ["com.test.Editor"] });
    expect(context.memory.sources).toHaveLength(0); expect(context.memory.summary).toBe("");
  });
  it("expires recent work and stops polling when paused", async () => {
    const { context, observe, advance } = setup();
    await context.refresh(); advance(8 * 86400000); context.prompt();
    expect(context.memory.sources).toHaveLength(0);
    context.configure({ ...context.settings, paused: true }); await context.refresh();
    expect(observe).toHaveBeenCalledTimes(1);
  });
});
