import { describe, expect, it } from "vitest";
import { previewZoomShortcutAction, previewZoomWheelAction } from "./zoomShortcuts";

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

  it("matches command wheel direction", () => {
    expect(previewZoomWheelAction({ deltaY: -1, metaKey: true, ctrlKey: false, altKey: false })).toBe(
      "zoomIn",
    );
    expect(previewZoomWheelAction({ deltaY: 1, metaKey: true, ctrlKey: false, altKey: false })).toBe(
      "zoomOut",
    );
  });

  it("ignores wheel events without command or with option/control", () => {
    expect(
      previewZoomWheelAction({ deltaY: -1, metaKey: false, ctrlKey: false, altKey: false }),
    ).toBeNull();
    expect(
      previewZoomWheelAction({ deltaY: -1, metaKey: true, ctrlKey: true, altKey: false }),
    ).toBeNull();
    expect(
      previewZoomWheelAction({ deltaY: -1, metaKey: true, ctrlKey: false, altKey: true }),
    ).toBeNull();
    expect(
      previewZoomWheelAction({ deltaY: 0, metaKey: true, ctrlKey: false, altKey: false }),
    ).toBeNull();
  });
});
