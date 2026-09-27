import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import sharp from "sharp";
import "./build-service-config.mjs";
await sharp("build/icon.svg").png().toFile("build/icon.png");
for (const name of ["preload", "workspacePreload", "todayStickyPreload"])
  await build({
    entryPoints: [`electron/${name}.ts`],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: `dist-electron/${name}.js`,
  });
// PDF.js is ESM. Keep its dynamic import native instead of tsc's require rewrite.
await build({
  entryPoints: ["electron/documentWorker.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  packages: "external",
  outfile: "dist-electron/documentWorker.js",
});

if (process.platform === "darwin") {
  execFileSync("xcrun", ["swiftc", "native/context-observer.swift", "-o", "dist-electron/context-observer", "-O", "-module-cache-path", process.env.TMPDIR ? `${process.env.TMPDIR}/quip-swift-cache` : "/tmp/quip-swift-cache"], { stdio: "inherit" });
}
