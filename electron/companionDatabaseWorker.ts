import { parentPort } from "node:worker_threads";
import { CompanionDatabaseCore } from "./companionDatabaseCore";
const database = new CompanionDatabaseCore();
const methods = new Set(["open", "get", "list", "put", "forget", "query", "embedding", "nearest", "outbox", "acknowledge", "receive", "conflict", "conflicts", "resolve", "meta", "processed", "audio", "audioChunks", "removeAudio", "purge", "close"]);
let tail: Promise<unknown> = Promise.resolve();
parentPort!.on("message", ({ id, method, args }) => {
  tail = tail.then(async () => {
    try {
      if (!methods.has(method)) throw new Error("Unknown database operation");
      const result = await (database as any)[method](...args);
      parentPort!.postMessage({ id, result });
    } catch (error) { parentPort!.postMessage({ id, error: error instanceof Error ? error.message : "Database operation failed" }); }
  });
});
