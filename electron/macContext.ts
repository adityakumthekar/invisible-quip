import { execFile } from "node:child_process";
import path from "node:path";
import { desktopCapturer, systemPreferences } from "electron";
import { z } from "zod";
import type { Observation } from "./contextService";

const observation = z.object({ app: z.object({ bundleId: z.string(), name: z.string() }), window: z.object({ title: z.string(), document: z.string(), id: z.number().optional(), bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional() }), text: z.string(), selectedText: z.string(), secure: z.boolean() });
export async function observeMac(capture: boolean, allowed: (app: string) => boolean): Promise<Observation | null> {
  if (process.platform !== "darwin") throw new Error("Automatic context is currently supported on macOS.");
  if (!systemPreferences.isTrustedAccessibilityClient(false)) throw new Error("Enable Accessibility for Quip in System Settings to read app context.");
  const probe = (apps: string[]) => new Promise<Observation | null>((resolve, reject) => {
    execFile(path.join(__dirname, "context-observer"), apps, { timeout: 5000, maxBuffer: 128000 }, (error, stdout) => {
      if (error) return reject(new Error("Could not read app context. Check Accessibility permission and the native helper build."));
      try { const raw = JSON.parse(stdout); resolve(raw ? observation.parse(raw) : null); } catch { reject(new Error("The context observer returned invalid data.")); }
    });
  });
  const metadata = await probe([]);
  if (!metadata || !allowed(metadata.app.bundleId)) return metadata;
  const value = await probe([metadata.app.bundleId]);
  if (!value || value.app.bundleId !== metadata.app.bundleId || !allowed(value.app.bundleId) || value.secure) return null;
  if (capture && value.window.id && systemPreferences.getMediaAccessStatus("screen") === "granted") {
    const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 1100, height: 800 } });
    const source = sources.find(item => Number(item.id.split(":")[1]) === value.window.id);
    if (source && !source.thumbnail.isEmpty()) value.image = source.thumbnail.toJPEG(65);
  }
  return value;
}
