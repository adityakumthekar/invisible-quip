import { randomUUID } from "node:crypto";
import type { AgentRun, ContextSnapshot, Responsibility, StandingAuthority } from "./companionContract";
import { responsibilitySchema, runRequestSchema } from "./companionContract";
import type { AutopilotUpdate } from "./autopilot";
import type { TeachingStepResult } from "./teaching";

export interface TaskState { runs: AgentRun[]; responsibilities: Responsibility[]; matched: Record<string, boolean> }
export interface TaskDependencies {
  save: () => Promise<void>;
  emit: () => void;
  start: (goal: string, maxSteps: number) => Promise<void>;
  stop: () => void;
  busy: () => boolean;
  observe: () => Promise<ContextSnapshot | null>;
  now?: () => number;
}
export function scopeFailure(authority: StandingAuthority, step: TeachingStepResult, context: ContextSnapshot | null): string | null {
  if (!context) return "The current target cannot be verified. Open an enabled app and resume.";
  if (!authority.apps.includes(context.app.bundleId)) return `The run is not authorized in ${context.app.name}.`;
  if (!authority.actions.includes(step.action)) return `The run is not authorized to ${step.action}.`;
  const target = `${context.window.title}\n${context.window.document}`.toLowerCase();
  if (!authority.targets.some(value => target.includes(value.toLowerCase()))) return "The current window or document is outside this run's authorized targets.";
  const bounds = context.window.bounds;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return "The target window bounds cannot be verified. Check Screen Recording permission.";
  const inside = (rect: TeachingStepResult["target"]) => { const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2; return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height; };
  if (!["key", "wait"].includes(step.action) && (!inside(step.target) || (step.to && !inside(step.to)))) return "The proposed action falls outside the authorized window.";
  return null;
}
export class AgentTaskService {
  state: TaskState = { runs: [], responsibilities: [], matched: {} };
  suspended = false;
  private active: string | null = null;
  private launching = false;
  private generation = 0;
  private planned: ContextSnapshot | null = null;
  private now: () => number;
  constructor(private deps: TaskDependencies) { this.now = deps.now ?? Date.now; }
  current() { return this.state.runs.find(run => run.id === this.active); }
  ownsDesktop() { return !!this.active || this.launching; }
  async recover(state?: TaskState) {
    if (state) this.state = state;
    for (const run of this.state.runs) {
      if (["acting", "thinking", "queued"].includes(run.phase)) {
        run.uncertainAction ||= run.phase === "acting";
        run.phase = "paused";
        run.outcome = run.uncertainAction ? "Interrupted during an action. Review the target before resuming; it may already have completed." : "Quip restarted. Resume to reobserve and continue.";
      }
    }
  }
  async saveResponsibility(raw: Responsibility) {
    const value = responsibilitySchema.parse(raw);
    if (this.state.runs.some(run => run.responsibilityId === value.id && ["queued", "thinking", "acting"].includes(run.phase))) throw new Error("Stop this responsibility's run before editing its permissions.");
    this.state.responsibilities = [...this.state.responsibilities.filter(item => item.id !== value.id), value];
    delete this.state.matched[value.id];
    await this.deps.save(); this.deps.emit();
  }
  async removeResponsibility(id: string) {
    if (this.current()?.responsibilityId === id) await this.stop();
    this.state.responsibilities = this.state.responsibilities.filter(item => item.id !== id);
    for (const run of this.state.runs.filter(item => item.responsibilityId === id && item.phase === "queued")) { run.phase = "stopped"; run.outcome = "Responsibility removed."; }
    delete this.state.matched[id];
    await this.deps.save(); this.deps.emit();
  }
  private create(goal: string, authority: StandingAuthority, responsibilityId?: string, triggerKey?: string) {
    const time = new Date(this.now()).toISOString();
    const run: AgentRun = { id: randomUUID(), goal, authority: structuredClone(authority), responsibilityId, triggerKey, phase: "queued", createdAt: time, updatedAt: time, steps: 0, checkpoint: "", outcome: "Queued", uncertainAction: false };
    this.state.runs = [...this.state.runs.filter(item => ["queued", "thinking", "acting", "paused"].includes(item.phase) || this.state.runs.indexOf(item) >= this.state.runs.length - 80), run];
    return run;
  }
  async enqueue(raw: { goal: string; authority: StandingAuthority }) {
    const value = runRequestSchema.parse(raw);
    if (this.state.runs.filter(run => ["queued", "thinking", "acting", "paused"].includes(run.phase)).length >= 20) throw new Error("The task queue is full. Finish or stop some tasks first.");
    this.create(value.goal, value.authority);
    await this.deps.save(); this.deps.emit();
    await this.pump();
  }
  async tick(context: ContextSnapshot | null) {
    if (this.suspended) return;
    let changed = false;
    for (const responsibility of this.state.responsibilities.filter(item => item.enabled)) {
      let key: string | null = null;
      if (responsibility.trigger.kind === "context") {
        const matches = !!context && context.app.bundleId === responsibility.trigger.app && `${context.window.title}\n${context.window.document}\n${context.text}`.toLowerCase().includes(responsibility.trigger.contains.toLowerCase());
        if (matches && !this.state.matched[responsibility.id]) key = `context:${context!.id}`;
        if (this.state.matched[responsibility.id] !== matches) { this.state.matched[responsibility.id] = matches; changed = true; }
      } else if (Date.parse(responsibility.trigger.nextAt) <= this.now()) {
        key = `schedule:${responsibility.trigger.nextAt}`;
        responsibility.trigger.nextAt = new Date(this.now() + responsibility.trigger.everyMinutes * 60000).toISOString();
        changed = true;
      }
      if (key && !this.state.runs.some(run => run.responsibilityId === responsibility.id && (["queued", "thinking", "acting", "paused"].includes(run.phase) || run.triggerKey === key))) {
        this.create(responsibility.goal, responsibility.authority, responsibility.id, key); changed = true;
      }
    }
    if (changed) { await this.deps.save(); this.deps.emit(); }
    const running = this.current();
    if (running && this.now() - Date.parse(running.createdAt) > running.authority.maxMinutes * 60000) await this.halt("blocked", "This run reached its time limit.");
    await this.pump();
  }
  async pump() {
    if (this.suspended || this.active || this.launching || this.deps.busy()) return;
    const run = this.state.runs.find(item => item.phase === "queued");
    if (!run) return;
    this.launching = true; this.active = run.id;
    const generation = ++this.generation;
    try {
      const context = await this.deps.observe();
      if (generation !== this.generation || this.suspended) return;
      if (!context) throw new Error("Open an enabled app before starting desktop work.");
      if (!run.authority.apps.includes(context.app.bundleId)) throw new Error("Open one of this run's authorized apps before starting.");
      run.phase = "thinking"; run.outcome = "Working"; run.updatedAt = new Date(this.now()).toISOString();
      await this.deps.save(); this.deps.emit();
      if (generation !== this.generation) return;
      const goal = `${run.goal}\nAuthorized apps: ${run.authority.apps.join(", ")}\nAuthorized window/document targets: ${run.authority.targets.join(", ")}\nAllowed actions: ${run.authority.actions.join(", ")}\nPrevious verified progress: ${run.checkpoint || "None"}\nReobserve the target and check what is already complete before choosing an action. Never repeat a completed submission. Stay within the authorized apps and targets.`;
      void this.deps.start(goal, run.authority.maxSteps - run.steps).catch(error => {
        if (generation === this.generation) void this.halt("error", error instanceof Error ? error.message : "Task failed");
      });
    } catch (error) {
      if (generation === this.generation) await this.halt("blocked", error instanceof Error ? error.message : "Task could not start");
    } finally { this.launching = false; }
  }
  async capturePlanContext() {
    if (!this.active) return;
    this.planned = await this.deps.observe();
    if (!this.planned) throw new Error("Cannot observe the target app. The run has paused.");
  }
  async authorize(step: TeachingStepResult) {
    const run = this.current();
    if (!run) return false;
    const reason = scopeFailure(run.authority, step, this.planned);
    if (reason) throw new Error(reason);
    return true;
  }
  async beforeAction(step: TeachingStepResult) {
    const run = this.current();
    if (!run) return;
    const generation = this.generation;
    const observed = await this.deps.observe();
    if (generation !== this.generation || this.suspended) throw new Error("Run stopped before actuation.");
    const reason = scopeFailure(run.authority, step, observed);
    if (reason) throw new Error(reason);
    if (!this.planned || observed!.app.bundleId !== this.planned.app.bundleId || observed!.window.id !== this.planned.window.id || observed!.window.title !== this.planned.window.title || observed!.window.document !== this.planned.window.document || observed!.fingerprint !== this.planned.fingerprint) throw new Error("The target changed while planning. Resume to reobserve before acting.");
    if (run.steps >= run.authority.maxSteps || this.now() - Date.parse(run.createdAt) >= run.authority.maxMinutes * 60000) throw new Error("This run reached its authorized limit.");
    run.phase = "acting"; run.uncertainAction = step.action !== "wait";
    run.checkpoint = `Pending verification: ${step.action} — ${step.instruction}`;
    await this.deps.save();
    if (generation !== this.generation) throw new Error("Run stopped before actuation.");
    this.deps.emit();
  }
  async update(update: AutopilotUpdate) {
    const run = this.current();
    if (!run) return;
    run.updatedAt = new Date(this.now()).toISOString();
    if (update.phase === "thinking" && run.phase === "acting") {
      run.steps++;
      run.checkpoint = run.checkpoint.replace("Pending verification:", "Input dispatched; reobserve outcome:");
      // Keep uncertainty until the next screenshot has been interpreted.
    }
    if (update.phase === "acting") run.uncertainAction = update.result?.state === "step" && update.result.action !== "wait";
    if (update.phase === "awaiting-confirmation") {
      await this.halt("blocked", update.reasons?.join(" ") || "Additional authority is required."); return;
    }
    if (["complete", "blocked", "stopped", "error"].includes(update.phase)) {
      run.phase = update.phase as AgentRun["phase"];
      run.outcome = update.error || update.result?.instruction || update.stopReason || update.phase;
      if (update.phase === "complete") { run.uncertainAction = false; run.checkpoint = run.outcome; }
      this.active = null;
    } else run.phase = update.phase === "acting" ? "acting" : "thinking";
    await this.deps.save(); this.deps.emit();
  }
  private async halt(phase: AgentRun["phase"], outcome: string) {
    const run = this.current();
    this.generation++; this.active = null; this.planned = null;
    this.deps.stop();
    if (run) { run.phase = phase; run.outcome = outcome; run.updatedAt = new Date(this.now()).toISOString(); }
    await this.deps.save(); this.deps.emit();
  }
  async stop() {
    for (const run of this.state.runs.filter(item => item.phase === "queued")) { run.phase = "stopped"; run.outcome = "Stopped by you."; }
    await this.halt("stopped", "Stopped. You have control of the desktop.");
  }
  async suspend() { this.suspended = true; await this.halt("paused", "Desktop locked or asleep. Resume when it is available."); }
  wake() { this.suspended = false; this.deps.emit(); }
  async resume(id: string, actionReviewed: boolean) {
    const run = this.state.runs.find(item => item.id === id);
    if (!run || !["paused", "blocked", "error"].includes(run.phase)) throw new Error("This run cannot be resumed.");
    if (run.uncertainAction && !actionReviewed) throw new Error("Review the last action in the target app before resuming.");
    if (run.steps >= run.authority.maxSteps) throw new Error("The step limit is exhausted. Start a new task with a new allowance.");
    if (this.now() - Date.parse(run.createdAt) >= run.authority.maxMinutes * 60000) throw new Error("This run's permission has expired. Start a new task.");
    run.phase = "queued"; run.uncertainAction = false;
    await this.deps.save(); this.deps.emit(); await this.pump();
  }
}
