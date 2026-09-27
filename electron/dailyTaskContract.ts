import { z } from "zod";

export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Choose a valid date");
export const taskEvidenceSchema = z
  .object({
    id: z.string().min(1).max(200),
    sourceId: z.string().min(1).max(500),
    kind: z.enum(["desktop", "user", "note", "assistant"]),
    app: z.string().max(300),
    title: z.string().max(300),
    excerpt: z.string().min(1).max(2000),
    observedAt: z.string().datetime(),
    projectId: z.string().nullable(),
  })
  .strict();
export type TaskEvidence = z.infer<typeof taskEvidenceSchema>;
export const goalSchema = z
  .object({ id: z.string().uuid(), text: z.string().trim().min(1).max(300) })
  .strict();
export type DailyGoal = z.infer<typeof goalSchema>;
export const taskSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(300),
    details: z.string().max(6000),
    status: z.enum(["suggested", "todo", "done", "dismissed"]),
    provenance: z.enum(["manual", "commitment", "inferred"]),
    evidence: z.array(taskEvidenceSchema).max(20),
    goalIds: z.array(z.string().uuid()).max(3),
    dueAt: daySchema.nullable(),
    plannedDay: daySchema.nullable(),
    order: z.number().int().nonnegative().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    dedupeKeys: z.array(z.string().max(100)).max(30),
  })
  .strict();
export type DailyTask = z.infer<typeof taskSchema>;
export const taskEditSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    details: z.string().max(6000),
    dueAt: daySchema.nullable(),
    plannedDay: daySchema.nullable(),
    goalIds: z.array(z.string().uuid()).max(3),
  })
  .strict();
export const taskChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("save"),
      id: z.string().uuid().optional(),
      data: taskEditSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("status"),
      id: z.string().uuid(),
      status: z.enum(["todo", "done", "dismissed"]),
      plannedDay: daySchema.nullable().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("delete"), id: z.string().uuid() }).strict(),
  z
    .object({
      kind: z.literal("move"),
      id: z.string().uuid(),
      direction: z.enum(["up", "down"]),
    })
    .strict(),
]);
export type TaskChange = z.infer<typeof taskChangeSchema>;
export const dailyPreferencesSchema = z
  .object({ enabled: z.boolean(), goals: z.array(goalSchema).max(3) })
  .strict()
  .refine(
    (value) =>
      new Set(value.goals.map((goal) => goal.id)).size === value.goals.length,
    "Goals must have unique IDs",
  );
export type DailyPreferences = z.infer<typeof dailyPreferencesSchema>;
export interface TodaySnapshot {
  identity: string | null;
  ready: boolean;
  day: string;
  tasks: DailyTask[];
  preferences: DailyPreferences;
  refreshing: boolean;
  lastRefreshAt: string | null;
  pending: number;
  error: string | null;
  status: string;
}
export interface DailyTaskAPI {
  pinToday(): Promise<void>;
  onOpenToday(callback: () => void): () => void;
  dailySnapshot(): Promise<TodaySnapshot>;
  changeTask(change: TaskChange): Promise<void>;
  configureDaily(preferences: DailyPreferences): Promise<void>;
  refreshDaily(): Promise<void>;
  helpWithTask(id: string): Promise<void>;
  onTaskHelp(callback: () => void): () => void;
  onDailyChange(callback: (value: TodaySnapshot) => void): () => void;
}
export function localDay(time: number | Date = Date.now()): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function rankTasks(tasks: DailyTask[], day: string): DailyTask[] {
  return [...tasks].sort((a, b) => {
    if (a.order !== null || b.order !== null)
      return (
        (a.order ?? Infinity) - (b.order ?? Infinity) ||
        a.createdAt.localeCompare(b.createdAt)
      );
    const urgent = (task: DailyTask) =>
      task.dueAt && task.dueAt <= day ? 0 : 1;
    return (
      urgent(a) - urgent(b) ||
      (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") ||
      b.goalIds.length - a.goalIds.length ||
      Number(b.provenance === "commitment") -
        Number(a.provenance === "commitment") ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
    );
  });
}
