import { z } from "zod";

export const memoryKinds = ["fact", "preference", "decision", "project", "person", "document", "meeting", "task"] as const;
export const evidenceSchema = z.object({
  id: z.string().max(100), sourceId: z.string().max(100), app: z.string().max(300), title: z.string().max(300),
  excerpt: z.string().max(2000), observedAt: z.string().datetime(),
  origin: z.enum(["user", "draft", "ai", "inferred", "meeting"]), timestamp: z.number().nonnegative().optional(),
}).strict();
export const memorySchema = z.object({
  kind: z.enum(memoryKinds), title: z.string().trim().min(1).max(300), text: z.string().trim().min(1).max(12000),
  evidence: z.array(evidenceSchema).max(30), status: z.enum(["observed", "inferred", "confirmed", "conflicted"]),
  pinned: z.boolean().default(false),
}).strict();
export type Memory = z.infer<typeof memorySchema>;
export const edgeSchema = z.object({ from: z.string().uuid(), to: z.string().uuid(), relation: z.enum(["relates-to", "belongs-to", "decided-in", "assigned-to", "contradicts", "supports"]) }).strict();
export type MemoryEdge = z.infer<typeof edgeSchema>;
export const taskSchema = z.object({ title: z.string().trim().min(1).max(300), details: z.string().max(6000), status: z.enum(["suggested", "todo", "done", "dismissed"]), dueAt: z.string().datetime().nullable(), memoryIds: z.array(z.string().uuid()).max(30), remindedAt: z.string().datetime().nullable().default(null) }).strict();
export type DailyTask = z.infer<typeof taskSchema>;
export const segmentSchema = z.object({ id: z.string().max(100), start: z.number().nonnegative(), end: z.number().nonnegative(), channel: z.enum(["microphone", "system"]), text: z.string().max(12000) }).strict();
export type TranscriptSegment = z.infer<typeof segmentSchema>;
export const meetingSchema = z.object({
  title: z.string().trim().min(1).max(300), startedAt: z.string().datetime(), endedAt: z.string().datetime().nullable(),
  status: z.enum(["recording", "paused", "processing", "complete", "interrupted", "error"]),
  segments: z.array(segmentSchema).max(10000), summary: z.string().max(30000), decisions: z.array(z.object({ text: z.string().max(2000), segmentIds: z.array(z.string()).max(20) }).strict()).max(100),
  error: z.string().max(2000).nullable(), channels: z.array(z.enum(["microphone", "system"])).max(2),
}).strict();
export type Meeting = z.infer<typeof meetingSchema>;
export const promptTargetSchema = z.object({
  app: z.string().max(300), windowId: z.number(), windowTitle: z.string().max(1000), fieldId: z.string().min(1).max(2000),
  role: z.string().max(100), label: z.string().max(1000), value: z.string().max(16000), editable: z.boolean(),
}).strict();
export type PromptTarget = z.infer<typeof promptTargetSchema>;
export interface PromptSuggestion {
  id: string; original: string; improved: string; explanation: string; questions: string[];
  memories: Array<{ id: string; title: string }>; target: PromptTarget | null; createdAt: string; applied: boolean;
}
export type RecordKind = "memory" | "edge" | "task" | "meeting" | "prompt" | "responsibility";
export interface CompanionRecord<T = any> {
  id: string; kind: RecordKind; projectId: string | null; data: T;
  revision: number; updatedAt: string; deleted: boolean; deviceId: string;
}
export interface MemoryQuery { query?: string; projectId?: string | null; kind?: Memory["kind"]; offset?: number; limit?: number }
export interface MemoryPage { items: CompanionRecord<Memory>[]; total: number; nextOffset: number | null }
export interface SyncConflict { id: string; local: CompanionRecord; remote: CompanionRecord }
export interface LocalModels {
  online: boolean; ready: boolean; vision: boolean; embedding: boolean; transcription: boolean;
  models: string[]; downloading: string | null; progress: string; error: string | null;
}
export const localSettingsSchema = z.object({
  model: z.string().min(1).max(200).default("qwen3-vl:4b-instruct"),
  embeddingModel: z.literal("embeddinggemma:300m").default("embeddinggemma:300m"),
  backgroundPaused: z.boolean().default(false), syncEnabled: z.boolean().default(true),
  promptEnabled: z.boolean().default(true), lowPower: z.boolean().default(false),
}).strict();
export type LocalSettings = z.infer<typeof localSettingsSchema>;
export interface DailySnapshot {
  ready: boolean; error: string | null; deviceId: string; settings: LocalSettings; models: LocalModels;
  memoryCount: number; recent: CompanionRecord<Memory>[]; tasks: CompanionRecord<DailyTask>[];
  meetings: CompanionRecord<Meeting>[]; activeMeeting: string | null; prompts: CompanionRecord[];
  suggestion: PromptSuggestion | null; prompting: boolean;
  queue: { waiting: number; active: string | null };
  sync: { state: "local" | "paused" | "syncing" | "synced" | "offline" | "error"; pending: number; lastAt: string | null; error: string | null; conflicts: SyncConflict[] };
}
export type CompanionDestination = "today" | "memories" | "tasks" | "meetings" | "prompts" | "settings";
export interface DailyAPI {
  dailySnapshot(): Promise<DailySnapshot>;
  memories(query: MemoryQuery): Promise<MemoryPage>;
  graph(projectId: string | null, focusId?: string): Promise<{ nodes: CompanionRecord<Memory>[]; edges: CompanionRecord<MemoryEdge>[] }>;
  saveMemory(record: { id?: string; projectId: string | null; data: Memory }): Promise<void>;
  connectMemories(edge: MemoryEdge): Promise<void>;
  forgetMemory(id: string): Promise<void>;
  saveTask(record: { id?: string; projectId: string | null; data: DailyTask }): Promise<void>;
  configureLocal(settings: LocalSettings): Promise<void>;
  checkModels(): Promise<void>;
  downloadModel(model: "generation" | "embedding" | "transcription"): Promise<void>;
  cancelDownload(): Promise<void>;
  openOllama(): Promise<void>;
  syncNow(): Promise<void>;
  resolveConflict(id: string, choice: "local" | "remote"): Promise<void>;
  importLocalMemories(): Promise<void>;
  suggestPrompt(text: string, excludedMemoryIds?: string[]): Promise<void>;
  applyPrompt(id: string, text: string): Promise<void>;
  undoPrompt(): Promise<void>;
  dismissPrompt(): Promise<void>;
  startMeeting(title: string, channels: Array<"microphone" | "system">): Promise<string>;
  meetingChunk(id: string, channel: "microphone" | "system", start: number, pcm: ArrayBuffer, sequence: number): Promise<void>;
  pauseMeeting(id: string, paused: boolean): Promise<void>;
  stopMeeting(id: string): Promise<void>;
  retryMeeting(id: string): Promise<void>;
  deleteMeeting(id: string): Promise<void>;
  openDestination(destination: CompanionDestination, id?: string): Promise<void>;
  onDestination(callback: (value: { destination: CompanionDestination; id?: string }) => void): () => void;
  onDailyChange(callback: (value: DailySnapshot) => void): () => void;
}
