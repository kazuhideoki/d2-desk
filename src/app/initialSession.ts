import type { D2Tab, StoredWorkspaces } from "../types";
import { loadActiveTabId, loadTabs } from "../features/tabs/tabs";
import {
  getActiveWorkspace,
  loadWorkspaceActiveTabId,
  loadWorkspaces,
  loadWorkspaceTabs,
} from "../features/workspaces/workspaces";

export type InitialSession = {
  workspaceState: StoredWorkspaces;
  tabs: D2Tab[];
  activeTabId: string;
};

export function loadInitialSession(): InitialSession {
  const workspaceState = loadWorkspaces();
  const activeWorkspace = getActiveWorkspace(workspaceState);
  if (activeWorkspace) {
    const tabs = loadWorkspaceTabs(activeWorkspace);
    return {
      workspaceState,
      tabs,
      activeTabId: loadWorkspaceActiveTabId(activeWorkspace, tabs),
    };
  }

  const tabs = loadTabs();
  return {
    workspaceState,
    tabs,
    activeTabId: loadActiveTabId(tabs),
  };
}
