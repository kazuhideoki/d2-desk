import { workspacesStorageKey } from "../../constants";
import { createTab, normalizeTab } from "../tabs/tabs";
import type { D2Tab, StoredWorkspaces, Workspace } from "../../types";

export function loadWorkspaces(): StoredWorkspaces {
  const stored = localStorage.getItem(workspacesStorageKey);
  if (!stored) return { activeWorkspaceId: null, workspaces: [] };

  try {
    const parsed = JSON.parse(stored) as Partial<StoredWorkspaces>;
    const workspaces = Array.isArray(parsed.workspaces)
      ? parsed.workspaces.filter(isWorkspace).map(normalizeWorkspace)
      : [];
    const activeWorkspaceId =
      typeof parsed.activeWorkspaceId === "string" &&
      workspaces.some((workspace) => workspace.id === parsed.activeWorkspaceId)
        ? parsed.activeWorkspaceId
        : null;

    return { activeWorkspaceId, workspaces };
  } catch {
    return { activeWorkspaceId: null, workspaces: [] };
  }
}

export function writeWorkspaces(state: StoredWorkspaces) {
  localStorage.setItem(workspacesStorageKey, JSON.stringify(state));
}

export function getActiveWorkspace(state: StoredWorkspaces) {
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null;
}

export function activeWorkspaceDirectoryPath(state: StoredWorkspaces) {
  return getActiveWorkspace(state)?.rootPath ?? null;
}

export function createWorkspace(rootPath: string): Workspace {
  const now = new Date().toISOString();
  const firstTab = createTab("untitled.d2", "");
  return {
    id: createWorkspaceId(),
    name: workspaceNameFromPath(rootPath),
    rootPath,
    createdAt: now,
    lastOpenedAt: now,
    activeTabId: firstTab.id,
    tabs: [firstTab],
  };
}

export function addOrTouchWorkspace(state: StoredWorkspaces, rootPath: string) {
  const existing = state.workspaces.find((workspace) => workspace.rootPath === rootPath);
  if (existing) {
    const nextState = activateWorkspace(state, existing.id);
    return { state: nextState, workspaceId: existing.id, created: false };
  }

  const workspace = createWorkspace(rootPath);
  const nextState = {
    activeWorkspaceId: workspace.id,
    workspaces: [...state.workspaces, workspace],
  };
  writeWorkspaces(nextState);
  return { state: nextState, workspaceId: workspace.id, created: true };
}

export function activateWorkspace(state: StoredWorkspaces, workspaceId: string | null) {
  if (workspaceId === null) {
    const nextState = { ...state, activeWorkspaceId: null };
    writeWorkspaces(nextState);
    return nextState;
  }

  const now = new Date().toISOString();
  const nextState = {
    activeWorkspaceId: workspaceId,
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === workspaceId ? { ...workspace, lastOpenedAt: now } : workspace,
    ),
  };
  writeWorkspaces(nextState);
  return nextState;
}

export function removeWorkspace(state: StoredWorkspaces, workspaceId: string) {
  const nextState = {
    activeWorkspaceId: state.activeWorkspaceId === workspaceId ? null : state.activeWorkspaceId,
    workspaces: state.workspaces.filter((workspace) => workspace.id !== workspaceId),
  };
  writeWorkspaces(nextState);
  return nextState;
}

export function writeWorkspaceTabs(
  state: StoredWorkspaces,
  workspaceId: string,
  tabs: D2Tab[],
  activeTabId: string,
) {
  const nextState = {
    ...state,
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === workspaceId ? { ...workspace, tabs, activeTabId } : workspace,
    ),
  };
  writeWorkspaces(nextState);
  return nextState;
}

export function loadWorkspaceTabs(workspace: Workspace) {
  return workspace.tabs.length > 0 ? workspace.tabs : [createTab("untitled.d2", "")];
}

export function loadWorkspaceActiveTabId(workspace: Workspace, tabs: D2Tab[]) {
  return tabs.some((tab) => tab.id === workspace.activeTabId)
    ? workspace.activeTabId
    : (tabs[0]?.id ?? createTab("untitled.d2", "").id);
}

function isWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== "object") return false;
  const workspace = value as Partial<Workspace>;
  return (
    typeof workspace.id === "string" &&
    typeof workspace.name === "string" &&
    typeof workspace.rootPath === "string" &&
    typeof workspace.createdAt === "string" &&
    typeof workspace.lastOpenedAt === "string" &&
    typeof workspace.activeTabId === "string" &&
    Array.isArray(workspace.tabs)
  );
}

function normalizeWorkspace(workspace: Workspace): Workspace {
  const tabs = workspace.tabs.filter(isTab).map(normalizeTab);
  const fallbackTabs = tabs.length > 0 ? tabs : [createTab("untitled.d2", "")];
  const activeTabId = fallbackTabs.some((tab) => tab.id === workspace.activeTabId)
    ? workspace.activeTabId
    : fallbackTabs[0].id;

  return {
    ...workspace,
    name: workspace.name || workspaceNameFromPath(workspace.rootPath),
    activeTabId,
    tabs: fallbackTabs,
  };
}

function isTab(tab: unknown): tab is D2Tab {
  if (!tab || typeof tab !== "object") return false;
  const candidate = tab as Partial<D2Tab>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.fileName === "string" &&
    typeof candidate.source === "string" &&
    (typeof candidate.savedSource === "string" || candidate.savedSource === undefined) &&
    (typeof candidate.filePath === "string" ||
      candidate.filePath === null ||
      candidate.filePath === undefined) &&
    (typeof candidate.hasUserChanges === "boolean" || candidate.hasUserChanges === undefined) &&
    (typeof candidate.editorViewState === "object" || candidate.editorViewState === undefined)
  );
}

function workspaceNameFromPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function createWorkspaceId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
