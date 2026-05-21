import { sampleSource, tabsStorageKey } from "../../constants";
import type { D2Tab, StoredTabs } from "../../types";

export function isTabUnsaved(tab: D2Tab) {
  return tab.source !== tab.savedSource;
}

export function hasTabPendingUserChanges(tab: D2Tab) {
  return tab.hasUserChanges && isTabUnsaved(tab);
}

export type TabDropPosition = "before" | "after";

export function reorderTabs(
  tabs: D2Tab[],
  draggedTabId: string,
  targetTabId: string,
  position: TabDropPosition,
) {
  if (draggedTabId === targetTabId) return tabs;

  const draggedIndex = tabs.findIndex((tab) => tab.id === draggedTabId);
  const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId);
  if (draggedIndex === -1 || targetIndex === -1) return tabs;

  const nextTabs = [...tabs];
  const [draggedTab] = nextTabs.splice(draggedIndex, 1);
  const targetIndexAfterRemoval = nextTabs.findIndex((tab) => tab.id === targetTabId);
  const insertIndex = position === "before" ? targetIndexAfterRemoval : targetIndexAfterRemoval + 1;
  nextTabs.splice(insertIndex, 0, draggedTab);
  if (nextTabs.every((tab, index) => tab.id === tabs[index]?.id)) return tabs;
  return nextTabs;
}

export function loadTabs(): D2Tab[] {
  const fallbackSource = localStorage.getItem("d2-desk:last-source") ?? sampleSource;
  const fallbackTab = createTab("untitled.d2", fallbackSource, "");
  const stored = localStorage.getItem(tabsStorageKey);
  if (!stored) return [fallbackTab];

  try {
    const parsed = JSON.parse(stored) as Partial<StoredTabs>;
    const storedTabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
    const tabs = storedTabs
      .filter(
        (tab): tab is D2Tab =>
          typeof tab.id === "string" &&
          typeof tab.fileName === "string" &&
          typeof tab.source === "string" &&
          (typeof tab.savedSource === "string" || tab.savedSource === undefined) &&
          (typeof tab.filePath === "string" ||
            tab.filePath === null ||
            tab.filePath === undefined) &&
          (typeof tab.hasUserChanges === "boolean" || tab.hasUserChanges === undefined) &&
          (typeof tab.editorViewState === "object" || tab.editorViewState === undefined),
      )
      .map(normalizeTab);
    return tabs.length > 0 ? tabs : [fallbackTab];
  } catch {
    return [fallbackTab];
  }
}

export function loadActiveTabId(tabs: D2Tab[]) {
  const fallbackId = tabs[0]?.id ?? createTabId();
  const stored = localStorage.getItem(tabsStorageKey);
  if (!stored) return fallbackId;

  try {
    const parsed = JSON.parse(stored) as Partial<StoredTabs>;
    return typeof parsed.activeTabId === "string" &&
      tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : fallbackId;
  } catch {
    return fallbackId;
  }
}

export function createEmptyTab(existingTabs: D2Tab[]) {
  const usedNames = new Set(existingTabs.map((tab) => tab.fileName));
  let index = existingTabs.length + 1;
  let fileName = `untitled-${index}.d2`;
  while (usedNames.has(fileName)) {
    index += 1;
    fileName = `untitled-${index}.d2`;
  }
  return createTab(fileName, "", "");
}

export function createTab(fileName: string, source: string, savedSource = source): D2Tab {
  return {
    id: createTabId(),
    fileName,
    source,
    savedSource,
    filePath: null,
    hasUserChanges: false,
    editorViewState: null,
  };
}

export function writeStoredTabs(tabs: D2Tab[], activeTabId: string) {
  localStorage.setItem(tabsStorageKey, JSON.stringify({ activeTabId, tabs }));
}

function createTabId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function normalizeTab(tab: D2Tab): D2Tab {
  const savedSource = tab.savedSource ?? (tab.filePath ? tab.source : "");
  return {
    id: tab.id,
    fileName: tab.fileName,
    source: tab.source,
    savedSource,
    filePath: tab.filePath ?? null,
    hasUserChanges: tab.hasUserChanges ?? inferLegacyHasUserChanges(tab, savedSource),
    editorViewState: tab.editorViewState ?? null,
  };
}

function inferLegacyHasUserChanges(tab: D2Tab, savedSource: string) {
  if (tab.source === savedSource) return false;
  if (isInitialUntitledSample(tab, savedSource)) return false;
  return true;
}

function isInitialUntitledSample(tab: D2Tab, savedSource: string) {
  return (
    tab.filePath == null &&
    savedSource === "" &&
    /^untitled(?:-\d+)?\.d2$/.test(tab.fileName) &&
    tab.source === sampleSource
  );
}
