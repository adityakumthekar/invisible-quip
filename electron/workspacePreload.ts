import { contextBridge, ipcRenderer } from "electron";
import type { WorkspaceAPI } from "./workspaceContract";
const call = (method: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`workspace:${method}`, ...args);
const listen = (channel: string, callback: (data: any) => void) => {
  const listener = (_event: unknown, data: unknown) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const api: WorkspaceAPI = {
  snapshot: () => call("snapshot"),
  refresh: () => call("refresh"),
  signIn: (email) => call("signIn", email),
  verifyCode: (email, code) => call("verifyCode", email, code),
  signOut: () => call("signOut"),
  saveProject: (project) => call("saveProject", project),
  deleteProject: (id) => call("deleteProject", id),
  saveConversation: (value) => call("saveConversation", value),
  deleteConversation: (id) => call("deleteConversation", id),
  select: (project, conversation) => call("select", project, conversation),
  saveDraft: (id, text) => call("saveDraft", id, text),
  saveOutput: (value) => call("saveOutput", value),
  deleteOutput: (id) => call("deleteOutput", id),
  pickFile: () => call("pickFile"),
  captureScreen: () => call("captureScreen"),
  cropAttachment: (id, rect) => call("cropAttachment", id, rect),
  discardAttachment: (id) => call("discardAttachment", id),
  saveAttachment: (id, project) => call("saveAttachment", id, project),
  deleteSource: (id) => call("deleteSource", id),
  readSource: (id) => call("readSource", id),
  generate: (input) => call("generate", input),
  cancelGeneration: () => call("cancelGeneration"),
  openWorkspace: () => call("openWorkspace"),
  toggleOverlay: () => call("toggleOverlay"),
  copyText: (text) => call("copyText", text),
  exportText: (name, text) => call("exportText", name, text),
  exportAccount: () => call("exportAccount"),
  deleteAccount: (text) => call("deleteAccount", text),
  openBilling: (kind) => call("openBilling", kind),
  feedback: (text) => call("feedback", text),
  installUpdate: () => call("installUpdate"),
  onChange: (listener) => listen("workspace:changed", listener),
  onGeneration: (listener) => listen("workspace:generation", listener),
};
contextBridge.exposeInMainWorld("workspace", api);
