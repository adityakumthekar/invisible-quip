import { Worker } from "node:worker_threads";
import path from "node:path";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { safeStorage } from "electron";
import type { CompanionDatabaseCore } from "./companionDatabaseCore";
export class CompanionDatabase {
  private worker: Worker | null = null;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private sequence = 0;
  async open(directory: string) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Unlock the Mac keychain to open your memories.");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const keyFile = path.join(directory, "key.bin");
    let key: string;
    try { key = safeStorage.decryptString(await fs.readFile(keyFile)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("The memory key could not be read. The database has been preserved.");
      try { await fs.access(path.join(directory, "memory.db")); throw new Error("The memory database key is missing. Restore its key before opening it."); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      key = randomBytes(32).toString("hex");
      await fs.writeFile(keyFile, safeStorage.encryptString(key), { mode: 0o600, flag: "wx" });
    }
    this.worker = new Worker(path.join(__dirname, "companionDatabaseWorker.js"));
    this.worker.on("message", ({ id, result, error }) => { const work = this.pending.get(id); this.pending.delete(id); error ? work?.reject(new Error(error)) : work?.resolve(result); });
    const fail = (error: Error) => { this.pending.forEach(work => work.reject(error)); this.pending.clear(); this.worker = null; };
    this.worker.on("error", fail);
    this.worker.on("exit", code => { if (code) fail(new Error("Memory database worker stopped.")); });
    await this.call("open", path.join(directory, "memory.db"), key);
  }
  call<K extends keyof CompanionDatabaseCore>(method: K, ...args: CompanionDatabaseCore[K] extends (...args: infer P) => any ? P : never): Promise<CompanionDatabaseCore[K] extends (...args: any[]) => Promise<infer R> ? R : never> {
    return new Promise((resolve, reject) => { if (!this.worker) return reject(new Error("Memory database is unavailable.")); const id = ++this.sequence; this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, method, args }); });
  }
  async close() { if (this.worker) { await this.call("close"); await this.worker.terminate(); this.worker = null; } }
}
