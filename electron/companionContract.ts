import type { DailyTaskAPI } from "./dailyTaskContract";
import { z } from "zod";
import type { PromptTarget } from "./dailyContract";

const short = z.string().trim().min(1).max(300);
const id = z.string().min(1).max(100);
export const desktopActions = ["click", "double-click", "right-click", "type", "key", "scroll", "drag", "wait"] as const;
export const authoritySchema = z.object({
  apps: z.array(short).min(1).max(20),
  targets: z.array(short).min(1).max(20),
  actions: z.array(z.enum(desktopActions)).min(1).max(8),
  maxSteps: z.number().int().min(1).max(100),
  maxMinutes: z.number().int().min(1).max(60),
}).strict();
export type StandingAuthority = z.infer<typeof authoritySchema>;
export const responsibilitySchema = z.object({
  id, title: short, goal: z.string().trim().min(1).max(6000), enabled: z.boolean(),
  trigger: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("context"), app: short, contains: short }).strict(),
    z.object({ kind: z.literal("schedule"), everyMinutes: z.number().int().min(5).max(10080), nextAt: z.string().datetime() }).strict(),
  ]),
  authority: authoritySchema,
  deviceId: z.string().uuid().optional(),
}).strict();
export type Responsibility = z.infer<typeof responsibilitySchema>;

export interface ContextSnapshot {
  id: string;
  observedAt: string;
  app: { bundleId: string; name: string };
  window: { title: string; document: string; id?: number; bounds?: { x: number; y: number; width: number; height: number } };
  text: string;
  selectedText: string;
  fingerprint: string;
  focusedField?: PromptTarget;
}
export interface WorkMemory {
  preferences: string;
  summary: string;
  sources: ContextSnapshot[];
}
export const contextSettingsSchema = z.object({
  enabled: z.boolean(), paused: z.boolean(), apps: z.array(short).max(50),
  excludedApps: z.array(short).max(50), preferences: z.string().max(6000),
}).strict();
export type ContextSettings = z.infer<typeof contextSettingsSchema>;

const base = { id, title: short };
const field = z.object({ id, label: short, value: z.string().max(10000) }).strict();
export const surfaceBlockSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("draft"), text: z.string().max(20000) }).strict(),
  z.object({ ...base, kind: z.literal("form"), fields: z.array(field).min(1).max(12) }).strict(),
  z.object({ ...base, kind: z.literal("comparison"), columns: z.array(short).min(1).max(8), rows: z.array(z.object({ id, cells: z.array(z.string().max(2000)).max(8) }).strict()).max(30) }).strict(),
  z.object({ ...base, kind: z.literal("checklist"), items: z.array(z.object({ id, text: short, checked: z.boolean() }).strict()).max(30) }).strict(),
  z.object({ ...base, kind: z.literal("sources"), items: z.array(z.object({ label: short, excerpt: z.string().max(3000), contextId: id }).strict()).max(12) }).strict(),
  z.object({ ...base, kind: z.literal("progress"), text: z.string().max(3000) }).strict(),
]);
export const generatedSurfaceSchema = z.object({
  title: short,
  answer: z.string().max(20000),
  blocks: z.array(surfaceBlockSchema).min(1).max(8),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  for (const block of value.blocks) {
    if (ids.has(block.id)) ctx.addIssue({ code: "custom", message: "Duplicate block id" });
    ids.add(block.id);
    const children = block.kind === "form" ? block.fields : block.kind === "comparison" ? block.rows : block.kind === "checklist" ? block.items : [];
    if (new Set(children.map(child => child.id)).size !== children.length) ctx.addIssue({ code: "custom", message: "Duplicate item id" });
    if (block.kind === "comparison" && block.rows.some(row => row.cells.length !== block.columns.length)) ctx.addIssue({ code: "custom", message: "Comparison columns do not match" });
  }
});
export type SurfaceBlock = z.infer<typeof surfaceBlockSchema>;
export interface DynamicSurface extends z.infer<typeof generatedSurfaceSchema> {
  version: 1; id: string; task: string; createdAt: string; pinned: boolean; saved: boolean;
  conversationId: string;
  values: Record<string, string | boolean>;
}
export interface AgentRun {
  id: string; goal: string; responsibilityId?: string; triggerKey?: string;
  authority: StandingAuthority;
  phase: "queued" | "thinking" | "acting" | "paused" | "complete" | "blocked" | "stopped" | "error";
  createdAt: string; updatedAt: string; steps: number;
  checkpoint: string; outcome: string;
  uncertainAction: boolean;
  countdownUntil?: string;
}
export interface CompanionSnapshot {
  settings: ContextSettings; context: ContextSnapshot | null; memory: WorkMemory;
  contextStatus: string; surfaces: DynamicSurface[]; generating: boolean;
  cue: { id: string; title: string; task: string } | null;
  responsibilities: Responsibility[]; runs: AgentRun[];
  suspended: boolean; error: string | null;
}
export const runRequestSchema = z.object({ goal: z.string().trim().min(1).max(6000), authority: authoritySchema }).strict();
export const surfaceValueSchema = z.object({ surfaceId: id, key: z.string().max(300), value: z.union([z.string().max(20000), z.boolean()]) }).strict();
export type SurfaceCommand = "copy" | "save-note" | "refine";
export interface CompanionAPI extends DailyTaskAPI {
  snapshot(): Promise<CompanionSnapshot>;
  listApps(): Promise<Array<{ bundleId: string; name: string }>>;
  configure(settings: ContextSettings): Promise<void>;
  observe(): Promise<ContextSnapshot | null>;
  forget(): Promise<void>;
  generate(task: string): Promise<DynamicSurface>;
  cancel(): Promise<void>;
  updateValue(value: z.infer<typeof surfaceValueSchema>): Promise<void>;
  retainSurface(id: string, flags: { pinned: boolean; saved: boolean }): Promise<void>;
  removeSurface(id: string): Promise<void>;
  surfaceCommand(id: string, command: SurfaceCommand): Promise<void>;
  dismissCue(): Promise<void>;
  saveResponsibility(value: Responsibility): Promise<void>;
  removeResponsibility(id: string): Promise<void>;
  startRun(value: z.infer<typeof runRequestSchema>): Promise<void>;
  stopRun(): Promise<void>;
  resumeRun(id: string, actionReviewed: boolean): Promise<void>;
  onChange(callback: (value: CompanionSnapshot) => void): () => void;
}
