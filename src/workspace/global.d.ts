import type { WorkspaceAPI } from "../../electron/workspaceContract";
declare global {
  interface Window {
    workspace: WorkspaceAPI;
  }
}
