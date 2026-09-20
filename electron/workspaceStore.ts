import fs from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
export class WorkspaceStore {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private file(key: string) {
    if (!/^[a-zA-Z0-9._-]+$/.test(key)) throw new Error("Invalid storage key");
    return path.join(this.directory, `${key}.bin`);
  }
  async getItem(key: string): Promise<string | null> {
    await this.writes;
    try {
      return safeStorage.decryptString(await fs.readFile(this.file(key)));
    } catch {
      return null;
    }
  }
  async getItemStrict(key: string): Promise<string | null> {
    await this.writes;
    try { return safeStorage.decryptString(await fs.readFile(this.file(key))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  setItem(key: string, value: string): Promise<void> {
    const operation = this.writes.then(async () => {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error(
          "Secure storage is unavailable. Unlock your system keychain and try again.",
        );
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const file = this.file(key),
        temporary = `${file}.tmp`;
      await fs.writeFile(temporary, safeStorage.encryptString(value), {
        mode: 0o600,
      });
      await fs.rename(temporary, file);
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  async removeItem(key: string) {
    await this.writes;
    await fs.rm(this.file(key), { force: true });
  }
}
