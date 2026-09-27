import { app, BrowserWindow, screen } from "electron";
import path from "node:path";
import { isInvisibleMode } from "./invisibleMode";
import { createTodayStickyOptions, fitSticky } from "./todayStickyPolicy";

/** A separate, protected utility window. Task content stays in DailyTaskService. */
export class TodayStickyWindow {
  private window: BrowserWindow | null = null;
  private wanted = false;
  private loaded = false;
  getWindow() {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }
  isVisible() {
    return this.wanted;
  }
  show() {
    this.wanted = true;
    let window = this.getWindow();
    if (!window) {
      const invisible = isInvisibleMode();
      const { contentProtection, ...options } = createTodayStickyOptions(
        invisible,
        path.join(__dirname, "todayStickyPreload.js"),
      );
      const area = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint(),
      ).workArea;
      window = new BrowserWindow({
        ...options,
        ...fitSticky(
          {
            x: area.x + area.width - 356,
            y: area.y + 36,
            width: 332,
            height: 420,
          },
          area,
        ),
      });
      this.window = window;
      this.loaded = false;
      window.setContentProtection(contentProtection);
      if (process.platform === "darwin") {
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        window.setHiddenInMissionControl(invisible);
      }
      window.setAlwaysOnTop(
        true,
        process.platform === "darwin" ? "floating" : "normal",
      );
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      window.webContents.on("before-input-event", (event, input) => {
        if (input.type === "keyDown" && input.key === "Escape") {
          event.preventDefault();
          this.hide();
        }
      });
      window.on("close", (event) => {
        event.preventDefault();
        this.hide();
      });
      window.on("show", () => window!.setContentProtection(isInvisibleMode()));
      window.once("ready-to-show", () => {
        this.loaded = true;
        if (this.wanted) this.reveal();
      });
      window.once("closed", () => {
        this.window = null;
        this.loaded = false;
        this.wanted = false;
      });
      screen.on("display-removed", this.reposition);
      screen.on("display-metrics-changed", this.reposition);
      const load = app.isPackaged
        ? window.loadFile(path.join(__dirname, "../dist/index.html"), {
            query: { view: "today-sticky" },
          })
        : window.loadURL("http://localhost:5180/?view=today-sticky");
      void load.catch((error) => {
        console.error("Sticky note could not open:", error.message);
        this.close();
      });
    }
    if (this.loaded) this.reveal();
  }
  private reveal() {
    this.reposition();
    this.getWindow()?.showInactive();
  }
  private reposition = () => {
    const window = this.getWindow();
    if (!window) return;
    const bounds = window.getBounds();
    window.setBounds(
      fitSticky(bounds, screen.getDisplayMatching(bounds).workArea),
    );
  };
  hide() {
    this.wanted = false;
    this.getWindow()?.hide();
  }
  close() {
    screen.removeListener("display-removed", this.reposition);
    screen.removeListener("display-metrics-changed", this.reposition);
    this.wanted = false;
    this.getWindow()?.destroy();
    this.window = null;
  }
}
