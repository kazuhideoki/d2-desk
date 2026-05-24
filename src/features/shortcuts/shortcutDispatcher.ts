export type ShortcutAction =
  | "editor.format"
  | "editor.goToSymbol"
  | "editor.renameFocusedNode"
  | "editor.selectLargerSyntaxNode"
  | "editor.selectSmallerSyntaxNode"
  | "file.closeTab"
  | "file.newTab"
  | "file.open"
  | "file.openWorkspaceFile"
  | "file.quit"
  | "file.save"
  | "tabs.focusNext"
  | "tabs.focusPrevious"
  | "view.nextComposition"
  | "view.openCommandPalette"
  | "view.previousComposition"
  | "view.resetZoom"
  | "view.toggleBottomPanel"
  | "view.toggleDetachedPreview"
  | "view.togglePreviewViewMode"
  | "view.zoomIn"
  | "view.zoomOut";

export type ShortcutDispatch = {
  action: ShortcutAction;
  preventDefault: true;
  stopImmediatePropagation: boolean;
};

export type ShortcutKeyEvent = {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

function dispatch(
  action: ShortcutAction,
  options: { stopImmediatePropagation?: boolean } = {},
): ShortcutDispatch {
  return {
    action,
    preventDefault: true,
    stopImmediatePropagation: options.stopImmediatePropagation ?? false,
  };
}

function matchesKey(event: ShortcutKeyEvent, key: string, code: string) {
  return event.key.toLowerCase() === key || event.code === code;
}

export function dispatchGlobalShortcut(event: ShortcutKeyEvent): ShortcutDispatch | null {
  if (event.key === "F2" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    return dispatch("editor.renameFocusedNode");
  }

  if ((event.metaKey || event.ctrlKey) && event.altKey && event.shiftKey) {
    if (event.key.toLowerCase() === "p" || event.code === "KeyP") {
      return dispatch("view.toggleDetachedPreview", { stopImmediatePropagation: true });
    }
    return null;
  }

  if ((event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey) {
    if (
      event.metaKey &&
      !event.ctrlKey &&
      (event.key.toLowerCase() === "p" || event.code === "KeyP")
    ) {
      return dispatch("view.togglePreviewViewMode", { stopImmediatePropagation: true });
    }
    if (event.key === "ArrowLeft") {
      return dispatch("tabs.focusPrevious", { stopImmediatePropagation: true });
    }
    if (event.key === "ArrowRight") {
      return dispatch("tabs.focusNext", { stopImmediatePropagation: true });
    }
    if (event.key === "ArrowUp") {
      return dispatch("view.previousComposition", { stopImmediatePropagation: true });
    }
    if (event.key === "ArrowDown") {
      return dispatch("view.nextComposition", { stopImmediatePropagation: true });
    }
    return null;
  }

  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();

  if (key === "o" && event.shiftKey) {
    return dispatch("editor.goToSymbol", { stopImmediatePropagation: true });
  }
  if (key === "p" && event.shiftKey) {
    return dispatch("view.openCommandPalette", { stopImmediatePropagation: true });
  }
  if (key === "o") {
    return dispatch("file.open");
  }
  if (key === "p" && event.metaKey && !event.ctrlKey && !event.shiftKey) {
    return dispatch("file.openWorkspaceFile", { stopImmediatePropagation: true });
  }
  if (key === "s") {
    return dispatch("file.save");
  }
  if (event.shiftKey && matchesKey(event, "i", "KeyI")) {
    return dispatch("editor.selectLargerSyntaxNode", { stopImmediatePropagation: true });
  }
  if (event.shiftKey && matchesKey(event, "e", "KeyE")) {
    return dispatch("editor.selectSmallerSyntaxNode", { stopImmediatePropagation: true });
  }
  if (!event.shiftKey && key === "j") {
    return dispatch("view.toggleBottomPanel", { stopImmediatePropagation: true });
  }
  if (event.key === "+" || event.key === "=") {
    return dispatch("view.zoomIn");
  }
  if (event.key === "-" || event.key === "_") {
    return dispatch("view.zoomOut");
  }
  if (event.key === "0") {
    return dispatch("view.resetZoom");
  }
  if (key === "t") {
    return dispatch("file.newTab");
  }
  if (key === "w") {
    return dispatch("file.closeTab", { stopImmediatePropagation: true });
  }
  if (key === "q") {
    return dispatch("file.quit", { stopImmediatePropagation: true });
  }

  return null;
}
