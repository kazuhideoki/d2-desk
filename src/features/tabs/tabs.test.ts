import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleSource, tabsStorageKey } from "../../constants";
import {
  activeTabIdAfterClose,
  applyExternalFileContents,
  createEmptyTab,
  createTab,
  hasTabExternalChanges,
  hasTabPendingUserChanges,
  insertTabAfter,
  isTabUnsaved,
  loadActiveTabId,
  loadTabs,
  normalizeTab,
  reorderTabs,
  shouldConfirmExternalOverwrite,
  tabAbsolutePath,
  writeStoredTabs,
} from "./tabs";
import type { D2Tab } from "../../types";

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

describe("tabs", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  it("loads a fallback tab from the legacy last-source key", () => {
    localStorage.setItem("d2-desk:last-source", "api -> db");

    const tabs = loadTabs();

    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      fileName: "untitled.d2",
      source: "api -> db",
      savedSource: "",
      diskSource: "",
      filePath: null,
      hasUserChanges: false,
      hasExternalChanges: false,
      editorViewState: null,
    });
  });

  it("loads and normalizes persisted tabs while ignoring invalid entries", () => {
    localStorage.setItem(
      tabsStorageKey,
      JSON.stringify({
        activeTabId: "kept",
        tabs: [
          {
            id: "kept",
            fileName: "main.d2",
            source: "api -> db",
            filePath: "/tmp/main.d2",
          },
          { id: "invalid", source: "missing fileName" },
        ],
      }),
    );

    expect(loadTabs()).toEqual([
      {
        id: "kept",
        fileName: "main.d2",
        source: "api -> db",
        savedSource: "api -> db",
        diskSource: "api -> db",
        filePath: "/tmp/main.d2",
        hasUserChanges: false,
        hasExternalChanges: false,
        editorViewState: null,
      },
    ]);
  });

  it("falls back when persisted tab JSON is malformed", () => {
    localStorage.setItem("d2-desk:last-source", "fallback");
    localStorage.setItem(tabsStorageKey, "{");

    expect(loadTabs()[0]).toMatchObject({ source: "fallback" });
  });

  it("creates a startup fallback tab when the persisted tab list is empty", () => {
    localStorage.setItem("d2-desk:last-source", "fallback");
    localStorage.setItem(tabsStorageKey, JSON.stringify({ activeTabId: "", tabs: [] }));

    const tabs = loadTabs();

    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ fileName: "untitled.d2", source: "fallback" });
  });

  it("keeps the stored active tab only when it exists", () => {
    localStorage.setItem(tabsStorageKey, JSON.stringify({ activeTabId: "two", tabs: [] }));
    const tabs = [
      createTab("one.d2", ""),
      { ...createTab("two.d2", ""), id: "two" },
    ];

    expect(loadActiveTabId(tabs)).toBe("two");

    localStorage.setItem(tabsStorageKey, JSON.stringify({ activeTabId: "missing", tabs: [] }));

    expect(loadActiveTabId(tabs)).toBe(tabs[0].id);
  });

  it("creates the next available untitled tab name", () => {
    const tab = createEmptyTab([
      { ...createTab("untitled-2.d2", ""), fileName: "untitled-2.d2" },
      { ...createTab("untitled-3.d2", ""), fileName: "untitled-3.d2" },
    ]);

    expect(tab.fileName).toBe("untitled-4.d2");
    expect(tab.source).toBe("");
    expect(tab.savedSource).toBe("");
  });

  it("infers pending changes for legacy tabs without marking the initial sample dirty", () => {
    const initialSample = legacyTab({
      fileName: "untitled.d2",
      source: sampleSource,
      savedSource: undefined,
    });
    const editedUntitled = legacyTab({
      fileName: "untitled.d2",
      source: "api -> db",
      savedSource: undefined,
    });

    expect(normalizeTab(initialSample).hasUserChanges).toBe(false);
    expect(normalizeTab(editedUntitled).hasUserChanges).toBe(true);
  });

  it("checks unsaved and pending-user-change state separately", () => {
    const clean = createTab("main.d2", "api");
    const autoChanged = { ...clean, source: "api -> db", hasUserChanges: false };
    const userChanged = { ...clean, source: "api -> db", hasUserChanges: true };

    expect(isTabUnsaved(clean)).toBe(false);
    expect(isTabUnsaved(autoChanged)).toBe(true);
    expect(hasTabPendingUserChanges(autoChanged)).toBe(false);
    expect(hasTabPendingUserChanges(userChanged)).toBe(true);
  });

  it("auto-applies external file contents when the tab has no pending user changes", () => {
    const tab = { ...createTab("main.d2", "api"), filePath: "/tmp/main.d2" };

    expect(applyExternalFileContents(tab, "api -> db")).toMatchObject({
      source: "api -> db",
      savedSource: "api -> db",
      diskSource: "api -> db",
      hasUserChanges: false,
      hasExternalChanges: false,
    });
  });

  it("records external file contents without replacing pending user changes", () => {
    const tab = {
      ...createTab("main.d2", "api"),
      filePath: "/tmp/main.d2",
      source: "api -> cache",
      hasUserChanges: true,
    };

    const nextTab = applyExternalFileContents(tab, "api -> db");

    expect(nextTab).toMatchObject({
      source: "api -> cache",
      savedSource: "api",
      diskSource: "api -> db",
      hasUserChanges: true,
      hasExternalChanges: true,
    });
    expect(hasTabExternalChanges(nextTab)).toBe(true);
  });

  it("requires save confirmation when unsaved app changes would overwrite external disk changes", () => {
    const tab = {
      ...createTab("main.d2", "A"),
      source: "B",
      hasUserChanges: true,
    };

    expect(shouldConfirmExternalOverwrite(tab, "C", "B")).toBe(true);
  });

  it("skips save confirmation when disk still matches the last saved source", () => {
    const tab = {
      ...createTab("main.d2", "A"),
      source: "B",
      hasUserChanges: true,
    };

    expect(shouldConfirmExternalOverwrite(tab, "A", "B")).toBe(false);
  });

  it("skips save confirmation when disk already matches the content being saved", () => {
    const tab = {
      ...createTab("main.d2", "A"),
      source: "B",
      hasUserChanges: true,
    };

    expect(shouldConfirmExternalOverwrite(tab, "B", "B")).toBe(false);
  });

  it("skips save confirmation for clean tabs", () => {
    const tab = createTab("main.d2", "A");

    expect(shouldConfirmExternalOverwrite(tab, "C", "A")).toBe(false);
  });

  it("returns a copyable absolute path only for file-backed tabs", () => {
    expect(tabAbsolutePath({ ...createTab("main.d2", ""), filePath: "/tmp/main.d2" })).toBe(
      "/tmp/main.d2",
    );
    expect(tabAbsolutePath(createTab("untitled.d2", ""))).toBeNull();
    expect(tabAbsolutePath(null)).toBeNull();
  });

  it("reorders tabs before or after the drop target", () => {
    const tabs = [
      { ...createTab("one.d2", ""), id: "one" },
      { ...createTab("two.d2", ""), id: "two" },
      { ...createTab("three.d2", ""), id: "three" },
      { ...createTab("four.d2", ""), id: "four" },
    ];

    expect(reorderTabs(tabs, "four", "two", "before").map((tab) => tab.id)).toEqual([
      "one",
      "four",
      "two",
      "three",
    ]);
    expect(reorderTabs(tabs, "one", "three", "after").map((tab) => tab.id)).toEqual([
      "two",
      "three",
      "one",
      "four",
    ]);
  });

  it("inserts a tab after the target tab", () => {
    const tabs = [
      { ...createTab("one.d2", ""), id: "one" },
      { ...createTab("two.d2", ""), id: "two" },
    ];
    const tab = { ...createTab("inserted.d2", ""), id: "inserted" };

    expect(insertTabAfter(tabs, tab, "one").map((item) => item.id)).toEqual([
      "one",
      "inserted",
      "two",
    ]);
  });

  it("appends a tab when inserting after a missing target", () => {
    const tabs = [{ ...createTab("one.d2", ""), id: "one" }];
    const tab = { ...createTab("inserted.d2", ""), id: "inserted" };

    expect(insertTabAfter(tabs, tab, "missing").map((item) => item.id)).toEqual([
      "one",
      "inserted",
    ]);
  });

  it("selects the next active tab after closing the current tab", () => {
    const tabs = [
      { ...createTab("one.d2", ""), id: "one" },
      { ...createTab("two.d2", ""), id: "two" },
      { ...createTab("three.d2", ""), id: "three" },
    ];

    expect(activeTabIdAfterClose(tabs, "two", "two")).toBe("three");
    expect(activeTabIdAfterClose(tabs, "three", "three")).toBe("two");
    expect(activeTabIdAfterClose(tabs, "two", "one")).toBe("two");
  });

  it("allows closing the last tab without selecting a replacement", () => {
    const tabs = [{ ...createTab("one.d2", ""), id: "one" }];

    expect(activeTabIdAfterClose(tabs, "one", "one")).toBe("");
  });

  it("keeps tab order when a reorder request is invalid", () => {
    const tabs = [
      { ...createTab("one.d2", ""), id: "one" },
      { ...createTab("two.d2", ""), id: "two" },
    ];

    expect(reorderTabs(tabs, "one", "one", "before")).toBe(tabs);
    expect(reorderTabs(tabs, "missing", "two", "after")).toBe(tabs);
    expect(reorderTabs(tabs, "one", "missing", "after")).toBe(tabs);
  });

  it("keeps the same tab array when a reorder request does not change the order", () => {
    const tabs = [
      { ...createTab("one.d2", ""), id: "one" },
      { ...createTab("two.d2", ""), id: "two" },
      { ...createTab("three.d2", ""), id: "three" },
    ];

    expect(reorderTabs(tabs, "one", "two", "before")).toBe(tabs);
    expect(reorderTabs(tabs, "three", "two", "after")).toBe(tabs);
  });

  it("writes tabs with their active id", () => {
    const tab = createTab("main.d2", "api");

    writeStoredTabs([tab], tab.id);

    expect(JSON.parse(localStorage.getItem(tabsStorageKey) ?? "")).toEqual({
      activeTabId: tab.id,
      tabs: [tab],
    });
  });
});

function legacyTab(overrides: Partial<D2Tab>): D2Tab {
  return {
    id: "legacy",
    fileName: "untitled.d2",
    source: "",
    savedSource: "",
    diskSource: "",
    filePath: null,
    hasUserChanges: undefined as unknown as boolean,
    hasExternalChanges: undefined as unknown as boolean,
    editorViewState: null,
    ...overrides,
  };
}
