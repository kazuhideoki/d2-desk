import { beforeEach, describe, expect, it, vi } from "vitest";
import { bottomPanelVisibilityStorageKey } from "../../constants";
import { loadBottomPanelVisible, writeBottomPanelVisible } from "./bottomPanelVisibility";

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

describe("bottomPanelVisibility", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  it("defaults the bottom panel to hidden when no preference is stored", () => {
    expect(loadBottomPanelVisible()).toBe(false);
  });

  it("loads and writes the persisted bottom panel visibility", () => {
    writeBottomPanelVisible(true);
    expect(localStorage.getItem(bottomPanelVisibilityStorageKey)).toBe("true");
    expect(loadBottomPanelVisible()).toBe(true);

    writeBottomPanelVisible(false);
    expect(localStorage.getItem(bottomPanelVisibilityStorageKey)).toBe("false");
    expect(loadBottomPanelVisible()).toBe(false);
  });
});
