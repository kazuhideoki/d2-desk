import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewLayoutStorageKey } from "../../constants";
import {
  editorPaneRatioForSource,
  editorPaneRatioFromPointer,
  loadPreviewLayout,
  nextPreviewViewMode,
  normalizeEditorPaneRatio,
  normalizePreviewLayout,
  previewViewModeStatus,
  sourceLongestLineColumns,
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
      editorPaneRatioMode: "auto",
    });
  });

  it("loads legacy persisted editor pane ratios as manual", () => {
    localStorage.setItem(
      previewLayoutStorageKey,
      JSON.stringify({ viewMode: "split", detached: false, editorPaneRatio: 0.62 }),
    );

    expect(loadPreviewLayout()).toEqual({
      viewMode: "split",
      detached: false,
      editorPaneRatio: 0.62,
      editorPaneRatioMode: "manual",
    });
  });

  it("normalizes detached preview layout to editor-only in the main window", () => {
    expect(normalizePreviewLayout({ viewMode: "split", detached: true })).toEqual({
      viewMode: "editor-only",
      detached: true,
      editorPaneRatio: 0.475,
      editorPaneRatioMode: "auto",
    });
  });

  it("falls back when the stored layout is invalid", () => {
    localStorage.setItem(previewLayoutStorageKey, JSON.stringify({ viewMode: "bogus" }));

    expect(loadPreviewLayout()).toEqual({
      viewMode: "split",
      detached: false,
      editorPaneRatio: 0.475,
      editorPaneRatioMode: "auto",
    });
  });

  it("writes a normalized preview layout", () => {
    writePreviewLayout({
      viewMode: "preview-only",
      detached: true,
      editorPaneRatio: 2,
      editorPaneRatioMode: "manual",
    });

    expect(JSON.parse(localStorage.getItem(previewLayoutStorageKey) ?? "")).toEqual({
      viewMode: "editor-only",
      detached: true,
      editorPaneRatio: 0.8,
      editorPaneRatioMode: "manual",
    });
  });

  it("loads an explicitly persisted editor pane ratio mode", () => {
    localStorage.setItem(
      previewLayoutStorageKey,
      JSON.stringify({
        viewMode: "split",
        detached: false,
        editorPaneRatio: 0.55,
        editorPaneRatioMode: "auto",
      }),
    );

    expect(loadPreviewLayout()).toEqual({
      viewMode: "split",
      detached: false,
      editorPaneRatio: 0.55,
      editorPaneRatioMode: "auto",
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

  it("calculates editor pane ratio from the longest source line", () => {
    expect(
      editorPaneRatioForSource({
        source: "short\nthis is the longest line",
        containerWidth: 1200,
        fontSize: 14,
      }),
    ).toBeCloseTo(360 / 1200);

    expect(
      editorPaneRatioForSource({
        source: "x".repeat(60),
        containerWidth: 1200,
        fontSize: 14,
      }),
    ).toBeCloseTo((60 * 14 * 0.62 + 92) / 1200);
  });

  it("keeps an editor minimum width even when source is empty", () => {
    expect(
      editorPaneRatioForSource({
        source: "",
        containerWidth: 1000,
        fontSize: 14,
      }),
    ).toBe(0.36);
  });

  it("clamps auto editor pane ratios", () => {
    expect(
      editorPaneRatioForSource({
        source: "",
        containerWidth: 4000,
        fontSize: 14,
      }),
    ).toBe(0.2);
    expect(
      editorPaneRatioForSource({
        source: "x".repeat(200),
        containerWidth: 1200,
        fontSize: 14,
      }),
    ).toBe(0.8);
  });

  it("counts tabs and full-width source characters for auto sizing", () => {
    expect(sourceLongestLineColumns(`abc\n\t${String.fromCharCode(0x6f22)}`)).toBe(4);
  });
});
