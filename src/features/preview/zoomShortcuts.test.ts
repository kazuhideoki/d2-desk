import { describe, expect, it } from "vitest";
import { previewZoomShortcutAction } from "./zoomShortcuts";

const baseEvent = {
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
};

describe("preview zoom shortcuts", () => {
  it("matches primary-modifier plus and minus keys", () => {
    expect(previewZoomShortcutAction({ ...baseEvent, key: "+", metaKey: true })).toBe("zoomIn");
    expect(previewZoomShortcutAction({ ...baseEvent, key: "=", code: "Equal", metaKey: true })).toBe(
      "zoomIn",
    );
    expect(previewZoomShortcutAction({ ...baseEvent, key: "-", ctrlKey: true })).toBe("zoomOut");
    expect(previewZoomShortcutAction({ ...baseEvent, key: "_", code: "Minus", metaKey: true })).toBe(
      "zoomOut",
    );
  });

  it("ignores keys without a primary modifier or with option", () => {
    expect(previewZoomShortcutAction({ ...baseEvent, key: "+" })).toBeNull();
    expect(
      previewZoomShortcutAction({ ...baseEvent, key: "+", metaKey: true, altKey: true }),
    ).toBeNull();
    expect(previewZoomShortcutAction({ ...baseEvent, key: "0", metaKey: true })).toBeNull();
  });
});
