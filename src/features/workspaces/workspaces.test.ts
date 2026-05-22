import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspacesStorageKey } from "../../constants";
import { createTab } from "../tabs/tabs";
import type { StoredWorkspaces, Workspace } from "../../types";
import {
  activateWorkspace,
  activeWorkspaceDirectoryPath,
  addOrTouchWorkspace,
  getActiveWorkspace,
  loadWorkspaceActiveTabId,
  loadWorkspaceTabs,
  loadWorkspaces,
  removeWorkspace,
  writeWorkspaceTabs,
} from "./workspaces";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.get(key) ?? null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

describe("workspaces", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  it("returns an empty workspace state when nothing valid is stored", () => {
    expect(loadWorkspaces()).toEqual({ activeWorkspaceId: null, workspaces: [] });

    localStorage.setItem(workspacesStorageKey, "{");

    expect(loadWorkspaces()).toEqual({ activeWorkspaceId: null, workspaces: [] });
  });

  it("normalizes stored workspaces and clears missing active ids", () => {
    localStorage.setItem(
      workspacesStorageKey,
      JSON.stringify({
        activeWorkspaceId: "missing",
        workspaces: [
          {
            id: "workspace-1",
            name: "",
            rootPath: "/tmp/project",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastOpenedAt: "2026-01-01T00:00:00.000Z",
            activeTabId: "missing-tab",
            tabs: [{ id: "bad-tab" }],
          },
          { id: "bad-workspace" },
        ],
      }),
    );

    const state = loadWorkspaces();

    expect(state.activeWorkspaceId).toBeNull();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].name).toBe("project");
    expect(state.workspaces[0].tabs).toHaveLength(1);
    expect(state.workspaces[0].tabs[0].fileName).toBe("untitled.d2");
    expect(state.workspaces[0].activeTabId).toBe(state.workspaces[0].tabs[0].id);
  });

  it("adds a new workspace and writes it as active", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "workspace-id" });
    const state: StoredWorkspaces = { activeWorkspaceId: null, workspaces: [] };

    const result = addOrTouchWorkspace(state, "/tmp/my-project");

    expect(result.created).toBe(true);
    expect(result.workspaceId).toBe("workspace-id");
    expect(result.state.activeWorkspaceId).toBe("workspace-id");
    expect(result.state.workspaces[0]).toMatchObject({
      id: "workspace-id",
      name: "my-project",
      rootPath: "/tmp/my-project",
    });
    expect(JSON.parse(localStorage.getItem(workspacesStorageKey) ?? "")).toEqual(result.state);
  });

  it("touches an existing workspace instead of duplicating it", () => {
    const state: StoredWorkspaces = {
      activeWorkspaceId: null,
      workspaces: [workspace({ id: "workspace-1", rootPath: "/tmp/project" })],
    };

    const result = addOrTouchWorkspace(state, "/tmp/project");

    expect(result.created).toBe(false);
    expect(result.workspaceId).toBe("workspace-1");
    expect(result.state.workspaces).toHaveLength(1);
    expect(result.state.activeWorkspaceId).toBe("workspace-1");
  });

  it("activates, removes, and reads the active workspace", () => {
    const state: StoredWorkspaces = {
      activeWorkspaceId: null,
      workspaces: [workspace({ id: "one" }), workspace({ id: "two" })],
    };

    const activated = activateWorkspace(state, "two");

    expect(activated.activeWorkspaceId).toBe("two");
    expect(getActiveWorkspace(activated)?.id).toBe("two");
    expect(activeWorkspaceDirectoryPath(activated)).toBe("/tmp/project");

    const removed = removeWorkspace(activated, "two");

    expect(removed.activeWorkspaceId).toBeNull();
    expect(removed.workspaces.map((item) => item.id)).toEqual(["one"]);
    expect(activeWorkspaceDirectoryPath(removed)).toBeNull();
  });

  it("updates tabs for only the target workspace", () => {
    const tab = createTab("updated.d2", "api");
    const state: StoredWorkspaces = {
      activeWorkspaceId: "one",
      workspaces: [workspace({ id: "one" }), workspace({ id: "two" })],
    };

    const updated = writeWorkspaceTabs(state, "two", [tab], tab.id);

    expect(updated.workspaces[0].tabs).toEqual(state.workspaces[0].tabs);
    expect(updated.workspaces[1].tabs).toEqual([tab]);
    expect(updated.workspaces[1].activeTabId).toBe(tab.id);
  });

  it("falls back to a valid tab list and active tab id", () => {
    const tab = createTab("main.d2", "api");
    const emptyWorkspace = workspace({ tabs: [] });
    const staleWorkspace = workspace({ activeTabId: "missing", tabs: [tab] });

    expect(loadWorkspaceTabs(emptyWorkspace)[0].fileName).toBe("untitled.d2");
    expect(loadWorkspaceActiveTabId(staleWorkspace, [tab])).toBe(tab.id);
  });
});

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  const tab = createTab("main.d2", "api");
  return {
    id: "workspace",
    name: "project",
    rootPath: "/tmp/project",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: "2026-01-01T00:00:00.000Z",
    activeTabId: tab.id,
    tabs: [tab],
    ...overrides,
  };
}
