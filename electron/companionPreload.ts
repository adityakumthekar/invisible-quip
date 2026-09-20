import { contextBridge, ipcRenderer } from "electron";
import type { CompanionAPI } from "./companionContract";
const call = (method: string, ...args: unknown[]) => ipcRenderer.invoke(`companion:${method}`, ...args);
const api: CompanionAPI = {
  pinToday: () => call("pinToday"),
  onOpenToday: callback => { const listener = () => callback(); ipcRenderer.on("companion:openToday", listener); return () => { ipcRenderer.removeListener("companion:openToday", listener); }; },
  dailySnapshot: () => call("dailySnapshot"), changeTask: value => call("changeTask", value),
  configureDaily: value => call("configureDaily", value), refreshDaily: () => call("refreshDaily"), helpWithTask: id => call("helpWithTask", id),
  onTaskHelp: callback => { const listener = () => callback(); ipcRenderer.on("companion:taskHelp", listener); return () => { ipcRenderer.removeListener("companion:taskHelp", listener); }; },
  onDailyChange: callback => { const listener = (_event: unknown, value: any) => callback(value); ipcRenderer.on("companion:dailyChanged", listener); return () => { ipcRenderer.removeListener("companion:dailyChanged", listener); }; },
  snapshot: () => call("snapshot"), listApps: () => call("listApps"),
  configure: value => call("configure", value), observe: () => call("observe"), forget: () => call("forget"),
  generate: task => call("generate", task), cancel: () => call("cancel"),
  updateValue: value => call("updateValue", value), retainSurface: (id, flags) => call("retainSurface", id, flags),
  removeSurface: id => call("removeSurface", id), surfaceCommand: (id, command) => call("surfaceCommand", id, command), dismissCue: () => call("dismissCue"),
  saveResponsibility: value => call("saveResponsibility", value), removeResponsibility: id => call("removeResponsibility", id),
  startRun: value => call("startRun", value), stopRun: () => call("stopRun"), resumeRun: (id, reviewed) => call("resumeRun", id, reviewed),
  onChange: callback => {
    const listener = (_event: unknown, value: any) => callback(value);
    ipcRenderer.on("companion:changed", listener);
    return () => ipcRenderer.removeListener("companion:changed", listener);
  },
};
contextBridge.exposeInMainWorld("companion", api);
