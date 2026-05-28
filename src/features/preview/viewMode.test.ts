import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewLayoutStorageKey } from "../../constants";
import {
  loadPreviewLayout,
  nextPreviewViewMode,
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

    expect(loadPreviewLayout()).toEqual({ viewMode: "preview-only", detached: false });
  });

  it("normalizes detached preview layout to editor-only in the main window", () => {
    expect(normalizePreviewLayout({ viewMode: "split", detached: true })).toEqual({
      viewMode: "editor-only",
      detached: true,
    });
  });

  it("falls back when the stored layout is invalid", () => {
    localStorage.setItem(previewLayoutStorageKey, JSON.stringify({ viewMode: "bogus" }));

    expect(loadPreviewLayout()).toEqual({ viewMode: "split", detached: false });
  });

  it("writes a normalized preview layout", () => {
    writePreviewLayout({ viewMode: "preview-only", detached: true });

    expect(JSON.parse(localStorage.getItem(previewLayoutStorageKey) ?? "")).toEqual({
      viewMode: "editor-only",
      detached: true,
    });
  });
});
