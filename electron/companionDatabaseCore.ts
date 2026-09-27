import { randomUUID } from "node:crypto";
import type { CompanionRecord, Memory, MemoryPage, MemoryQuery, SyncConflict } from "./dailyContract";

export interface OutboxItem { operationId: string; record: CompanionRecord; baseRevision: number }
// This module runs in a worker. Native SQLite and all plaintext indexes stay out of renderers.
export class CompanionDatabaseCore {
  private db: any;
  async open(filename: string, key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid database key");
    const sqlite = require("@journeyapps/sqlcipher");
    this.db = await new Promise<any>((resolve, reject) => { const db = new sqlite.Database(filename, (error: Error) => error ? reject(error) : resolve(db)); });
    await this.exec(`PRAGMA key = "x'${key}'"; PRAGMA cipher_compatibility = 4; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON;`);
    await this.exec(`
      CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, project_id TEXT, data TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, device_id TEXT NOT NULL, embedding TEXT);
      CREATE INDEX IF NOT EXISTS record_scope ON records(kind, project_id, deleted, updated_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED, text, tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY REFERENCES records(id), operation_id TEXT NOT NULL, base_revision INTEGER NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conflicts (id TEXT PRIMARY KEY, local TEXT NOT NULL, remote TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS processed (id TEXT PRIMARY KEY, observed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audio (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, channel TEXT NOT NULL, start REAL NOT NULL, pcm BLOB NOT NULL, created_at TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
  }
  exec(sql: string): Promise<void> { return new Promise((resolve, reject) => this.db.exec(sql, (e: Error) => e ? reject(e) : resolve())); }
  run(sql: string, args: unknown[] = []): Promise<void> { return new Promise((resolve, reject) => this.db.run(sql, args, (e: Error) => e ? reject(e) : resolve())); }
  all(sql: string, args: unknown[] = []): Promise<any[]> { return new Promise((resolve, reject) => this.db.all(sql, args, (e: Error, rows: any[]) => e ? reject(e) : resolve(rows))); }
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    await this.exec("BEGIN IMMEDIATE");
    try { const result = await work(); await this.exec("COMMIT"); return result; } catch (e) { await this.exec("ROLLBACK"); throw e; }
  }
  private record(row: any): CompanionRecord { return { id: row.id, kind: row.kind, projectId: row.project_id, data: JSON.parse(row.data), revision: row.revision, updatedAt: row.updated_at, deleted: !!row.deleted, deviceId: row.device_id }; }
  async get(id: string): Promise<CompanionRecord | null> { const [row] = await this.all("SELECT * FROM records WHERE id = ?", [id]); return row ? this.record(row) : null; }
  async list(kind?: string, includeDeleted = false): Promise<CompanionRecord[]> {
    const rows = await this.all(`SELECT * FROM records WHERE (? IS NULL OR kind = ?) ${includeDeleted ? "" : "AND deleted = 0"} ORDER BY updated_at DESC, id`, [kind ?? null, kind ?? null]);
    return rows.map(row => this.record(row));
  }
  private async write(record: CompanionRecord) {
    await this.run("INSERT INTO records(id,kind,project_id,data,revision,updated_at,deleted,device_id) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, project_id=excluded.project_id, data=excluded.data, revision=excluded.revision, updated_at=excluded.updated_at, deleted=excluded.deleted, device_id=excluded.device_id, embedding=NULL", [record.id, record.kind, record.projectId, JSON.stringify(record.data), record.revision, record.updatedAt, Number(record.deleted), record.deviceId]);
    await this.run("DELETE FROM search WHERE id = ?", [record.id]);
    if (!record.deleted && record.kind === "memory") await this.run("INSERT INTO search(id,text) VALUES(?,?)", [record.id, `${record.data.title}\n${record.data.text}`]);
  }
  async put(record: CompanionRecord, sync = true) {
    return this.transaction(async () => {
      const existing = await this.get(record.id);
      if (existing?.deleted && !record.deleted) throw new Error("This item was forgotten. Create a new memory to retain it again.");
      if (existing && existing.revision !== record.revision) throw new Error("This item changed. Refresh before saving.");
      await this.write(record);
      if (sync) {
        // Preserve the in-flight operation until acknowledged. A new operation is assigned on every local edit.
        await this.run("INSERT INTO outbox(id,operation_id,base_revision,record) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET operation_id=excluded.operation_id, record=excluded.record", [record.id, randomUUID(), record.revision, JSON.stringify(record)]);
      }
    });
  }
  async forget(id: string, deviceId: string) {
    const record = await this.get(id); if (!record || record.deleted) return;
    const related = (await this.list()).filter(item => item.kind === "edge" && (item.data.from === id || item.data.to === id));
    for (const item of [...related, record]) await this.put({ ...item, data: {}, deleted: true, updatedAt: new Date().toISOString(), deviceId });
    for (const task of await this.list("task")) if (task.data.memoryIds.includes(id)) await this.put({ ...task, data: { ...task.data, memoryIds: task.data.memoryIds.filter((item: string) => item !== id) }, updatedAt: new Date().toISOString(), deviceId });
  }
  async query(query: MemoryQuery): Promise<MemoryPage> {
    const limit = Math.min(100, Math.max(1, query.limit ?? 30)), offset = Math.max(0, query.offset ?? 0);
    const words = (query.query || "").match(/[\p{L}\p{N}_]+/gu)?.slice(0, 20) || [];
    const match = words.map(word => `"${word}"*`).join(" AND ");
    const scope = query.projectId === undefined ? "" : "AND (r.project_id = ? OR (r.project_id IS NULL AND json_extract(r.data, '$.kind') = 'preference'))";
    const args: unknown[] = query.projectId === undefined ? [] : [query.projectId];
    const kind = query.kind ? "AND json_extract(r.data, '$.kind') = ?" : "";
    if (query.kind) args.push(query.kind);
    if (match) args.push(match);
    const from = `FROM records r WHERE r.kind = 'memory' AND r.deleted = 0 ${scope} ${kind} ${match ? "AND r.id IN (SELECT id FROM search WHERE search MATCH ?)" : ""}`;
    const [count] = await this.all(`SELECT count(*) AS total ${from}`, args);
    const rows = await this.all(`SELECT r.* ${from} ORDER BY r.updated_at DESC, r.id LIMIT ? OFFSET ?`, [...args, limit, offset]);
    return { items: rows.map(row => this.record(row) as CompanionRecord<Memory>), total: count.total, nextOffset: offset + rows.length < count.total ? offset + rows.length : null };
  }
  async embedding(id: string, vector: number[]) { await this.run("UPDATE records SET embedding=? WHERE id=? AND deleted=0", [JSON.stringify(vector), id]); }
  async nearest(vector: number[], projectId: string | null, limit = 8): Promise<CompanionRecord<Memory>[]> {
    const rows = await this.all("SELECT * FROM records WHERE deleted=0 AND kind='memory' AND embedding IS NOT NULL AND (project_id = ? OR (project_id IS NULL AND json_extract(data, '$.kind') = 'preference'))", [projectId]);
    const norm = Math.sqrt(vector.reduce((n, v) => n + v * v, 0)) || 1;
    return rows.map(row => {
      const other: number[] = JSON.parse(row.embedding);
      const score = other.length !== vector.length ? -1 : other.reduce((n, v, i) => n + v * vector[i], 0) / ((Math.sqrt(other.reduce((n, v) => n + v * v, 0)) || 1) * norm);
      return { row, score };
    }).filter(item => item.score > 0.25).sort((a, b) => b.score - a.score).slice(0, limit).map(({ row }) => this.record(row) as CompanionRecord<Memory>);
  }
  async outbox(): Promise<OutboxItem[]> { return (await this.all("SELECT * FROM outbox ORDER BY rowid LIMIT 100")).map(row => ({ operationId: row.operation_id, baseRevision: row.base_revision, record: JSON.parse(row.record) })); }
  async acknowledge(operation: OutboxItem, remote: CompanionRecord) {
    await this.transaction(async () => {
      const [pending] = await this.all("SELECT * FROM outbox WHERE id = ?", [remote.id]);
      if (pending?.operation_id === operation.operationId) { await this.run("DELETE FROM outbox WHERE id=?", [remote.id]); await this.write(remote); }
      else if (pending) {
        // An edit made while the request was in flight is rebased on its acknowledged predecessor.
        const record = { ...JSON.parse(pending.record), revision: remote.revision };
        await this.run("UPDATE outbox SET base_revision=?, record=? WHERE id=?", [remote.revision, JSON.stringify(record), remote.id]);
        await this.write(record);
      }
    });
  }
  async receive(remote: CompanionRecord) {
    const current = await this.get(remote.id);
    if (current && current.revision >= remote.revision) return;
    await this.transaction(async () => {
      const [pending] = await this.all("SELECT * FROM outbox WHERE id=?", [remote.id]);
      if (pending) {
        await this.run("INSERT INTO conflicts(id,local,remote) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET remote=excluded.remote", [remote.id, pending.record, JSON.stringify(remote)]);
        if (remote.deleted) { await this.write(remote); await this.run("DELETE FROM outbox WHERE id=?", [remote.id]); }
      } else await this.write(remote);
    });
  }
  async conflict(local: CompanionRecord, remote: CompanionRecord) { await this.run("INSERT INTO conflicts(id,local,remote) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET local=excluded.local,remote=excluded.remote", [local.id, JSON.stringify(local), JSON.stringify(remote)]); }
  async conflicts(): Promise<SyncConflict[]> { return (await this.all("SELECT * FROM conflicts")).map(row => ({ id: row.id, local: JSON.parse(row.local), remote: JSON.parse(row.remote) })); }
  async resolve(id: string, choice: "local" | "remote") {
    const conflict = (await this.conflicts()).find(item => item.id === id); if (!conflict) return;
    if (choice === "local" && conflict.remote.deleted) throw new Error("The remote item was deleted. Its deletion cannot be undone by an older device.");
    await this.transaction(async () => {
      await this.run("DELETE FROM outbox WHERE id=?", [id]);
      await this.write(choice === "remote" ? conflict.remote : { ...conflict.local, revision: conflict.remote.revision });
      if (choice === "local") await this.run("INSERT INTO outbox VALUES(?,?,?,?)", [id, randomUUID(), conflict.remote.revision, JSON.stringify({ ...conflict.local, revision: conflict.remote.revision })]);
      await this.run("DELETE FROM conflicts WHERE id=?", [id]);
    });
  }
  async meta(key: string, value?: string): Promise<string | null> { if (value !== undefined) await this.run("INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value]); return (await this.all("SELECT value FROM metadata WHERE key=?", [key]))[0]?.value ?? null; }
  async processed(id: string, at?: string): Promise<boolean> { if (at) await this.run("INSERT OR IGNORE INTO processed VALUES(?,?)", [id, at]); return !!(await this.all("SELECT id FROM processed WHERE id=?", [id])).length; }
  async audio(value: { id: string; meetingId: string; channel: string; start: number; pcm: Uint8Array }) { await this.run("INSERT OR IGNORE INTO audio VALUES(?,?,?,?,?,?)", [value.id, value.meetingId, value.channel, value.start, Buffer.from(value.pcm), new Date().toISOString()]); }
  async audioChunks(meetingId: string) { return this.all("SELECT * FROM audio WHERE meeting_id=? ORDER BY start,id", [meetingId]); }
  async removeAudio(id: string) { await this.run("DELETE FROM audio WHERE id=?", [id]); }
  async purge() { const since = new Date(Date.now() - 7 * 86400000).toISOString(); await this.run("DELETE FROM audio WHERE created_at < ?", [since]); await this.run("DELETE FROM processed WHERE observed_at < ?", [since]); }
  async close() { if (this.db) await new Promise<void>((resolve, reject) => this.db.close((e: Error) => e ? reject(e) : resolve())); }
}
