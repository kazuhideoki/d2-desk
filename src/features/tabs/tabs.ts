import { sampleSource, tabsStorageKey } from "../../constants";
import type { D2Tab, StoredTabs } from "../../types";

export function isTabUnsaved(tab: D2Tab) {
  return tab.source !== tab.savedSource;
}

export function hasTabPendingUserChanges(tab: D2Tab) {
  return tab.hasUserChanges && isTabUnsaved(tab);
}

export function hasTabExternalChanges(tab: D2Tab) {
  return tab.hasExternalChanges && tabAbsolutePath(tab) !== null;
}

export function tabDiskSource(tab: Pick<D2Tab, "diskSource" | "savedSource">) {
  return tab.diskSource ?? tab.savedSource;
}

export function tabAbsolutePath(tab: Pick<D2Tab, "filePath"> | null | undefined) {
  return tab?.filePath && tab.filePath.length > 0 ? tab.filePath : null;
}

export function applyExternalFileContents(tab: D2Tab, contents: string) {
  const previousDiskSource = tabDiskSource(tab);
  if (contents === previousDiskSource && !tab.hasExternalChanges) return tab;

  if (hasTabPendingUserChanges(tab)) {
    const hasExternalChanges = contents !== tab.savedSource;
    if (tab.diskSource === contents && tab.hasExternalChanges === hasExternalChanges) {
      return tab;
    }
    return {
      ...tab,
      diskSource: contents,
      hasExternalChanges,
    };
  }

  if (
    tab.source === contents &&
    tab.savedSource === contents &&
    tab.diskSource === contents &&
    !tab.hasExternalChanges
  ) {
    return tab;
  }

  return {
    ...tab,
    source: contents,
    savedSource: contents,
    diskSource: contents,
    hasUserChanges: false,
    hasExternalChanges: false,
  };
}

export function shouldConfirmExternalOverwrite(
  tab: Pick<D2Tab, "source" | "savedSource" | "hasUserChanges">,
  diskSource: string,
  nextSource = tab.source,
) {
  return (
    tab.hasUserChanges &&
    tab.source !== tab.savedSource &&
    diskSource !== tab.savedSource &&
    diskSource !== nextSource
  );
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

export function insertTabAfter(tabs: D2Tab[], tab: D2Tab, targetTabId: string) {
  const targetIndex = tabs.findIndex((existingTab) => existingTab.id === targetTabId);
  if (targetIndex === -1) return [...tabs, tab];

  const nextTabs = [...tabs];
  nextTabs.splice(targetIndex + 1, 0, tab);
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
          (typeof tab.diskSource === "string" || tab.diskSource === undefined) &&
          (typeof tab.hasUserChanges === "boolean" || tab.hasUserChanges === undefined) &&
          (typeof tab.hasExternalChanges === "boolean" ||
            tab.hasExternalChanges === undefined) &&
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
    diskSource: savedSource,
    filePath: null,
    hasUserChanges: false,
    hasExternalChanges: false,
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
  const diskSource = tab.diskSource ?? savedSource;
  return {
    id: tab.id,
    fileName: tab.fileName,
    source: tab.source,
    savedSource,
    diskSource,
    filePath: tab.filePath ?? null,
    hasUserChanges: tab.hasUserChanges ?? inferLegacyHasUserChanges(tab, savedSource),
    hasExternalChanges: tab.hasExternalChanges ?? false,
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
