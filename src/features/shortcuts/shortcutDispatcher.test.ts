import { describe, expect, it } from "vitest";
import {
  dispatchGlobalShortcut,
  type ShortcutAction,
  type ShortcutDispatch,
  type ShortcutKeyEvent,
} from "./shortcutDispatcher";

const baseEvent: ShortcutKeyEvent = {
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

function keyEvent(overrides: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  const key = overrides.key ?? baseEvent.key;
  return {
    ...baseEvent,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    ...overrides,
  };
}

function actionOf(event: ShortcutKeyEvent) {
  return dispatchGlobalShortcut(event)?.action ?? null;
}

function expectDispatch(
  event: ShortcutKeyEvent,
  action: ShortcutAction,
  options: { stopImmediatePropagation?: boolean } = {},
) {
  expect(dispatchGlobalShortcut(event)).toEqual({
    action,
    preventDefault: true,
    stopImmediatePropagation: options.stopImmediatePropagation ?? false,
  } satisfies ShortcutDispatch);
}

describe("shortcut dispatcher", () => {
  it("dispatches F2 rename without requiring a primary modifier", () => {
    expectDispatch(keyEvent({ key: "F2" }), "editor.renameFocusedNode");
    expectDispatch(keyEvent({ key: "F2", shiftKey: true }), "editor.renameFocusedNode");
    expect(actionOf(keyEvent({ key: "F2", metaKey: true }))).toBeNull();
  });

  it("dispatches primary modifier shortcuts in the existing priority order", () => {
    expectDispatch(
      keyEvent({ key: "O", metaKey: true, shiftKey: true }),
      "editor.goToSymbol",
      { stopImmediatePropagation: true },
    );
    expectDispatch(keyEvent({ key: "o", ctrlKey: true }), "file.open");
    expectDispatch(
      keyEvent({ key: "P", ctrlKey: true, shiftKey: true }),
      "view.openCommandPalette",
      { stopImmediatePropagation: true },
    );
    expectDispatch(
      keyEvent({ key: "p", metaKey: true }),
      "file.openWorkspaceFile",
      { stopImmediatePropagation: true },
    );
    expect(actionOf(keyEvent({ key: "p", ctrlKey: true }))).toBeNull();
  });

  it("preserves shortcuts that currently allow shift as an extra modifier", () => {
    expectDispatch(keyEvent({ key: "s", metaKey: true, shiftKey: true }), "file.save");
    expectDispatch(keyEvent({ key: "T", metaKey: true, shiftKey: true }), "file.newTab");
    expectDispatch(
      keyEvent({ key: "W", ctrlKey: true, shiftKey: true }),
      "file.closeTab",
      { stopImmediatePropagation: true },
    );
    expectDispatch(
      keyEvent({ key: "Q", metaKey: true, shiftKey: true }),
      "file.quit",
      { stopImmediatePropagation: true },
    );
  });

  it("dispatches view shortcuts with the same stop propagation behavior", () => {
    expectDispatch(
      keyEvent({ key: "j", metaKey: true }),
      "view.toggleBottomPanel",
      { stopImmediatePropagation: true },
    );
    expect(actionOf(keyEvent({ key: "J", metaKey: true, shiftKey: true }))).toBeNull();
    expectDispatch(
      keyEvent({ key: "I", ctrlKey: true, shiftKey: true }),
      "editor.format",
      { stopImmediatePropagation: true },
    );
    expectDispatch(keyEvent({ key: "=", metaKey: true }), "view.zoomIn");
    expectDispatch(keyEvent({ key: "+", metaKey: true, shiftKey: true }), "view.zoomIn");
    expectDispatch(keyEvent({ key: "-", ctrlKey: true }), "view.zoomOut");
    expectDispatch(keyEvent({ key: "_", ctrlKey: true, shiftKey: true }), "view.zoomOut");
    expectDispatch(keyEvent({ key: "0", metaKey: true }), "view.resetZoom");
  });

  it("dispatches option-modified preview and navigation shortcuts", () => {
    expectDispatch(
      keyEvent({ key: "p", code: "KeyP", metaKey: true, altKey: true }),
      "view.togglePreviewViewMode",
      { stopImmediatePropagation: true },
    );
    expect(actionOf(keyEvent({ key: "p", code: "KeyP", ctrlKey: true, altKey: true }))).toBeNull();
    expectDispatch(
      keyEvent({ key: "p", code: "KeyP", metaKey: true, altKey: true, shiftKey: true }),
      "view.toggleDetachedPreview",
      { stopImmediatePropagation: true },
    );
    expectDispatch(
      keyEvent({ key: "ArrowUp", ctrlKey: true, altKey: true, shiftKey: true }),
      "view.previousComposition",
      { stopImmediatePropagation: true },
    );
    expectDispatch(
      keyEvent({ key: "ArrowDown", ctrlKey: true, altKey: true, shiftKey: true }),
      "view.nextComposition",
      { stopImmediatePropagation: true },
    );
    expectDispatch(
      keyEvent({ key: "ArrowLeft", ctrlKey: true, altKey: true }),
      "tabs.focusPrevious",
      { stopImmediatePropagation: true },
    );
    expectDispatch(
      keyEvent({ key: "ArrowRight", metaKey: true, altKey: true }),
      "tabs.focusNext",
      { stopImmediatePropagation: true },
    );
    expect(actionOf(keyEvent({ key: "ArrowUp", ctrlKey: true, altKey: true }))).toBeNull();
    expect(actionOf(keyEvent({ key: "ArrowDown", ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("ignores keys outside the existing shortcut shapes", () => {
    expect(actionOf(keyEvent({ key: "s" }))).toBeNull();
    expect(actionOf(keyEvent({ key: "s", metaKey: true, altKey: true }))).toBeNull();
    expect(actionOf(keyEvent({ key: "x", metaKey: true }))).toBeNull();
    expect(actionOf(keyEvent({ key: "ArrowDown", altKey: true }))).toBeNull();
  });
});
