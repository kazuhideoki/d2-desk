type PreviewZoomShortcutEvent = {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

type PreviewZoomWheelEvent = {
  deltaY: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

export type PreviewZoomShortcutAction = "zoomIn" | "zoomOut";

export function previewZoomShortcutAction(
  event: PreviewZoomShortcutEvent,
): PreviewZoomShortcutAction | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;

  if (event.key === "+" || event.key === "=" || event.code === "Equal") {
    return "zoomIn";
  }
  if (event.key === "-" || event.key === "_" || event.code === "Minus") {
    return "zoomOut";
  }

  return null;
}

export function previewZoomWheelAction(
  event: PreviewZoomWheelEvent,
): PreviewZoomShortcutAction | null {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.deltaY === 0) return null;
  return event.deltaY < 0 ? "zoomIn" : "zoomOut";
}
