import { contextBridge, ipcRenderer } from "electron";
import type { TodayStickyAPI } from "./todayStickyContract";
const api: TodayStickyAPI = {
  snapshot: () => ipcRenderer.invoke("companion:dailySnapshot"),
  changeTask: (value) => ipcRenderer.invoke("companion:changeTask", value),
  hide: () => ipcRenderer.invoke("companion:hideSticky"),
  openToday: () => ipcRenderer.invoke("companion:openToday"),
  privacy: () => ipcRenderer.invoke("companion:stickyPrivacy"),
  onChange: (callback) => {
    const listener = (_event: unknown, value: any) => callback(value);
    ipcRenderer.on("companion:dailyChanged", listener);
    return () => {
      ipcRenderer.removeListener("companion:dailyChanged", listener);
    };
  },
};
contextBridge.exposeInMainWorld("todaySticky", api);
