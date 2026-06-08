import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewLayoutStorageKey } from "../../constants";
import {
  editorPaneRatioFromPointer,
  loadPreviewLayout,
  nextPreviewViewMode,
  normalizeEditorPaneRatio,
  normalizePreviewLayout,
  previewViewModeStatus,
  writePreviewLayout,
} from "./viewMode";

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

describe("preview view mode", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  it("cycles split, preview-only, editor-only, then split", () => {
    expect(nextPreviewViewMode("split")).toBe("preview-only");
    expect(nextPreviewViewMode("preview-only")).toBe("editor-only");
    expect(nextPreviewViewMode("editor-only")).toBe("split");
  });

  it("describes each mode for status messages", () => {
    expect(previewViewModeStatus("split")).toBe("Editor and preview shown");
    expect(previewViewModeStatus("preview-only")).toBe("Preview only shown");
    expect(previewViewModeStatus("editor-only")).toBe("Editor only shown");
  });

  it("loads the persisted preview layout", () => {
    localStorage.setItem(
      previewLayoutStorageKey,
      JSON.stringify({ viewMode: "preview-only", detached: false }),
    );

    expect(loadPreviewLayout()).toEqual({
      viewMode: "preview-only",
      detached: false,
      editorPaneRatio: 0.475,
    });
  });

  it("loads the persisted editor pane ratio", () => {
    localStorage.setItem(
      previewLayoutStorageKey,
      JSON.stringify({ viewMode: "split", detached: false, editorPaneRatio: 0.62 }),
    );

    expect(loadPreviewLayout()).toEqual({
      viewMode: "split",
      detached: false,
      editorPaneRatio: 0.62,
    });
  });

  it("normalizes detached preview layout to editor-only in the main window", () => {
    expect(normalizePreviewLayout({ viewMode: "split", detached: true })).toEqual({
      viewMode: "editor-only",
      detached: true,
      editorPaneRatio: 0.475,
    });
  });

  it("falls back when the stored layout is invalid", () => {
    localStorage.setItem(previewLayoutStorageKey, JSON.stringify({ viewMode: "bogus" }));

    expect(loadPreviewLayout()).toEqual({
      viewMode: "split",
      detached: false,
      editorPaneRatio: 0.475,
    });
  });

  it("writes a normalized preview layout", () => {
    writePreviewLayout({ viewMode: "preview-only", detached: true, editorPaneRatio: 2 });

    expect(JSON.parse(localStorage.getItem(previewLayoutStorageKey) ?? "")).toEqual({
      viewMode: "editor-only",
      detached: true,
      editorPaneRatio: 0.8,
    });
  });

  it("normalizes editor pane ratios", () => {
    expect(normalizeEditorPaneRatio(0.1)).toBe(0.2);
    expect(normalizeEditorPaneRatio(0.5)).toBe(0.5);
    expect(normalizeEditorPaneRatio(0.9)).toBe(0.8);
    expect(normalizeEditorPaneRatio(Number.NaN)).toBe(0.475);
  });

  it("calculates editor pane ratio from pointer position", () => {
    expect(editorPaneRatioFromPointer(350, 100, 500)).toBe(0.5);
    expect(editorPaneRatioFromPointer(0, 100, 500)).toBe(0.2);
    expect(editorPaneRatioFromPointer(700, 100, 500)).toBe(0.8);
  });
});
