import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray,
  utilityProcess,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { autoUpdater } from "electron-updater";
import sharp from "sharp";
import { WorkspaceService } from "./WorkspaceService";
import { WorkspaceStore } from "./workspaceStore";
import { ScreenshotHelper } from "./ScreenshotHelper";
import { trustedRenderer, safeBillingUrl } from "./workspacePolicy";
import type { AttachmentPreview, ExtractedSection } from "./workspaceContract";

export interface WorkspaceHost {
  overlay: () => BrowserWindow | null;
  toggleOverlay: () => void;
  extraWindows?: () => BrowserWindow[];
}
export async function initializeWorkspaceApp(host?: WorkspaceHost) {
  if (!app.isPackaged && process.env.QUIP_E2E_USER_DATA)
    app.setPath("userData", process.env.QUIP_E2E_USER_DATA);
  if (!host && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  let workspace: BrowserWindow | null = null,
    overlay: BrowserWindow | null = null,
    tray: Tray | null = null,
    quitting = false;
  const windows = () =>
    [workspace, host?.overlay() ?? overlay, ...(host?.extraWindows?.() ?? [])].filter(
      (win): win is BrowserWindow => !!win && !win.isDestroyed(),
    );
  const resource = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..", "build");
  let config = { supabaseUrl: "", supabaseAnonKey: "" };
  try {
    config = JSON.parse(
      await fs.readFile(path.join(resource, "service-config.json"), "utf8"),
    );
  } catch {
    /* Unconfigured builds still provide local drafts. */
  }
  if (!app.isPackaged)
    config = {
      supabaseUrl: process.env.QUIP_SUPABASE_URL || config.supabaseUrl,
      supabaseAnonKey:
        process.env.QUIP_SUPABASE_ANON_KEY || config.supabaseAnonKey,
    };
  const store = new WorkspaceStore(
    path.join(app.getPath("userData"), "workspace"),
  );
  const service = new WorkspaceService(
    config,
    store,
    (snapshot) =>
      windows().forEach((win) =>
        win.webContents.send("workspace:changed", snapshot),
      ),
    (event) =>
      windows().forEach((win) =>
        win.webContents.send("workspace:generation", event),
      ),
  );
  const capture = new ScreenshotHelper();
  const createWindow = (kind: "workspace" | "overlay") => {
    const compact = kind === "overlay",
      display = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
      width: Math.min(compact ? 530 : 1220, display.width),
      height: Math.min(compact ? 690 : 820, display.height),
      minWidth: compact ? 400 : 800,
      minHeight: 500,
      show: false,
      title: "Quip",
      backgroundColor: compact ? "#ffffff" : "#f7f8fa",
      alwaysOnTop: compact,
      frame: !compact,
      titleBarStyle: compact ? undefined : "hiddenInset",
      webPreferences: {
        preload: path.join(__dirname, host ? "preload.js" : "workspacePreload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    win.once("ready-to-show", () => win.show());
    win.on("focus", () => {
      void service.refresh().catch(() => {});
    });
    win.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    if (app.isPackaged)
      void win.loadFile(path.join(__dirname, "../dist/index.html"), {
        query: { view: kind },
      });
    else void win.loadURL(`http://localhost:5180/?view=${kind}`);
    return win;
  };
  const showWorkspace = () => {
    if (!workspace || workspace.isDestroyed())
      workspace = createWindow("workspace");
    else {
      workspace.show();
      workspace.focus();
    }
  };
  const toggleOverlay = () => {
    if (host) { host.toggleOverlay(); return; }
    if (!overlay || overlay.isDestroyed()) overlay = createWindow("overlay");
    else if (overlay.isVisible()) overlay.hide();
    else {
      overlay.show();
      overlay.focus();
    }
  };
  // The beta does not request microphone, camera or accessibility access.
  session.defaultSession.setPermissionRequestHandler(
    (wc, permission, callback) => callback(!!host && permission === "media" && wc === host.overlay()?.webContents),
  );
  session.defaultSession.setPermissionCheckHandler((wc, permission) => !!host && permission === "media" && wc === host.overlay()?.webContents);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          `default-src 'self'; script-src 'self'${app.isPackaged ? "" : " 'unsafe-inline'"}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'${app.isPackaged ? "" : " ws://localhost:5180 http://localhost:5180"}; object-src 'none'; base-uri 'none'; frame-src 'none'`,
        ],
      },
    }),
  );
  const handle = (name: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(`workspace:${name}`, (event, ...args) => {
      if (
        !windows().some((win) => win.webContents === event.sender) ||
        event.senderFrame !== event.sender.mainFrame ||
        !trustedRenderer(event.senderFrame.url, app.isPackaged)
      )
        throw new Error("Untrusted caller");
      return fn(...args);
    });
  handle("snapshot", () => service.snapshot());
  handle("refresh", async () => {
    await service.refresh();
    for (const source of service
      .snapshot()
      .sources.filter((s) => s.status === "indexing"))
      await service.indexSource(source.id);
  });
  handle("signIn", (email) => service.signIn(email));
  handle("verifyCode", (email, code) => service.verifyCode(email, code));
  handle("signOut", () => service.signOut());
  handle("saveProject", (value) => service.saveProject(value));
  handle("saveConversation", (value) => service.saveConversation(value));
  handle("saveOutput", (value) => service.saveOutput(value));
  for (const kind of ["Project", "Conversation", "Output", "Source"] as const)
    handle(`delete${kind}`, (id) => service.remove(kind, id));
  handle("select", (project, conversation) =>
    service.select(project, conversation),
  );
  handle("saveDraft", (id, text) => service.saveDraft(id, text));
  handle("readSource", (id) => service.readSource(id));
  handle("saveAttachment", (id, project) =>
    service.saveAttachment(id, project),
  );
  handle("discardAttachment", (id) => service.discardAttachment(id));
  handle("cropAttachment", (id, rect) => service.cropAttachment(id, rect));
  handle("generate", (input) => service.generate(input));
  handle("cancelGeneration", () => service.cancelGeneration());
  handle("openWorkspace", showWorkspace);
  handle("toggleOverlay", toggleOverlay);
  const copyText = (text: unknown) => {
    if (typeof text !== "string" || text.length > 1000000)
      throw new Error("Text too large.");
    clipboard.writeText(text);
  };
  handle("copyText", copyText);
  handle("pickFile", async () => {
    const result = await dialog.showOpenDialog({
      title: "Attach a source",
      properties: ["openFile"],
      filters: [
        {
          name: "Documents and images",
          extensions: ["pdf", "docx", "txt", "md", "png", "jpg", "jpeg"],
        },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0],
      stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024 || !stat.size)
      throw new Error("Choose a non-empty file under 20 MB.");
    const ext = path.extname(file).toLowerCase(),
      bytes = await fs.readFile(file),
      image = [".png", ".jpg", ".jpeg"].includes(ext);
    const mimes: Record<string, string> = {
      ".pdf": "application/pdf",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
    };
    if (!mimes[ext]) throw new Error("This file type is not supported.");
    let sections: ExtractedSection[] = [];
    if (!image)
      sections = await new Promise<ExtractedSection[]>((resolve, reject) => {
        const worker = utilityProcess.fork(
            path.join(__dirname, "documentWorker.js"),
            [],
            { stdio: "pipe" },
          ),
          timeout = setTimeout(() => {
            worker.kill();
            reject(
              new Error(
                "This document took too long to read. Try a smaller file.",
              ),
            );
          }, 45000);
        worker.once("spawn", () => worker.postMessage({ path: file }));
        worker.once("message", (message: any) => {
          clearTimeout(timeout);
          worker.kill();
          message.error
            ? reject(new Error(message.error))
            : resolve(message.sections);
        });
        worker.once("exit", (code) => {
          clearTimeout(timeout);
          if (code !== 0)
            reject(new Error("The document could not be read safely."));
        });
      });
    const preview = image
      ? `data:image/jpeg;base64,${(await sharp(bytes).resize({ width: 1200, height: 1000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer()).toString("base64")}`
      : sections
          .map((section) => section.text)
          .join("\n\n")
          .slice(0, 6000);
    return service.addAttachment({
      bytes,
      view: {
        id: randomUUID(),
        name: path.basename(file),
        mimeType: mimes[ext],
        size: bytes.length,
        kind: image ? "image" : "document",
        sections,
        preview,
      },
    });
  });
  handle("captureScreen", async () => {
    const visible = windows().filter((win) => win.isVisible());
    visible.forEach((win) => win.hide());
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const bytes = await capture.captureForChatBuffer();
      return service.addAttachment({
        bytes,
        view: {
          id: randomUUID(),
          name: `Screen ${new Date().toLocaleTimeString()}`,
          mimeType: "image/png",
          size: bytes.length,
          kind: "screen",
          sections: [],
          preview: `data:image/png;base64,${bytes.toString("base64")}`,
        },
      });
    } finally {
      visible.forEach((win) => {
        if (!win.isDestroyed()) win.show();
      });
    }
  });
  handle("exportText", async (name, text) => {
    if (
      typeof name !== "string" ||
      typeof text !== "string" ||
      text.length > 1000000
    )
      throw new Error("Invalid export.");
    const result = await dialog.showSaveDialog({
      defaultPath: `${name.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 100) || "Quip export"}.md`,
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "Plain text", extensions: ["txt"] },
      ],
    });
    if (result.filePath) await fs.writeFile(result.filePath, text, "utf8");
  });
  handle("exportAccount", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose a folder for your Quip export",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) return;
    const folder = path.join(result.filePaths[0], `Quip-export-${Date.now()}`);
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const data = service.snapshot().account
      ? await service.api("exportAccount")
      : service.snapshot();
    await fs.writeFile(
      path.join(folder, "workspace.json"),
      JSON.stringify(data, null, 2),
      { mode: 0o600 },
    );
    for (const source of data.sources || []) {
      const details = await service.api("readSource", source.id),
        url = new URL(details.url);
      if (url.origin !== new URL(config.supabaseUrl).origin)
        throw new Error("Invalid source address.");
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok)
        throw new Error("A source could not be exported. Please retry.");
      const safeName = source.name
        .replace(/[^a-zA-Z0-9._ -]/g, "_")
        .slice(0, 120);
      await fs.writeFile(
        path.join(folder, `${source.id}-${safeName}`),
        Buffer.from(await response.arrayBuffer()),
        { mode: 0o600 },
      );
    }
    shell.showItemInFolder(path.join(folder, "workspace.json"));
  });
  handle("deleteAccount", (value) => service.deleteAccount(value));
  handle("openBilling", async (kind) => {
    if (!["checkout", "portal"].includes(kind))
      throw new Error("Invalid billing operation");
    const result = await service.api("billing", kind);
    await shell.openExternal(safeBillingUrl(result.url));
  });
  handle("feedback", (text) => service.api("feedback", text));
  let updateReady = false;
  handle("installUpdate", () => {
    if (updateReady) {
      quitting = true;
      autoUpdater.quitAndInstall();
    }
  });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("update-available", () => {
    service.setUpdate("Downloading an update…");
    void autoUpdater
      .downloadUpdate()
      .catch(() =>
        service.setUpdate(
          "Update download failed. Try again after restarting Quip.",
        ),
      );
  });
  autoUpdater.on("update-downloaded", () => {
    updateReady = true;
    service.setUpdate("An update is ready. Restart Quip to install.");
  });
  autoUpdater.on("error", () =>
    service.setUpdate("Update check unavailable. Your work is safe."),
  );
  if (app.isPackaged) void autoUpdater.checkForUpdates().catch(() => {});
  await service.initialize();
  if (!host) {
  showWorkspace();
  globalShortcut.register("CommandOrControl+Shift+Space", toggleOverlay);
  globalShortcut.register("CommandOrControl+B", toggleOverlay);
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("Quip");
  tray.setToolTip("Quip workspace");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open workspace", click: showWorkspace },
      { label: "Toggle assistant", click: toggleOverlay },
      { type: "separator" },
      { label: "Quit Quip", click: () => app.quit() },
    ]),
  );
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Quip",
        submenu: [
          { label: "Open workspace", click: showWorkspace },
          { label: "Toggle assistant", click: toggleOverlay },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "windowMenu" },
    ]),
  );
  const interval = setInterval(() => {
    void service.refresh().catch(() => {});
  }, 30000);
  if (!host) { app.on("activate", showWorkspace); app.on("second-instance", showWorkspace); }
  app.on("before-quit", () => {
    quitting = true;
    if (!host) globalShortcut.unregisterAll();
    clearInterval(interval);
    void service.cancelGeneration();
    tray?.destroy();
  });
  return { service, showWorkspace, windows };
}
