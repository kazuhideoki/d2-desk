export type PreviewViewMode = "split" | "preview-only" | "editor-only";

export function nextPreviewViewMode(current: PreviewViewMode): PreviewViewMode {
  switch (current) {
    case "split":
      return "preview-only";
    case "preview-only":
      return "editor-only";
    case "editor-only":
      return "split";
  }
}

export function previewViewModeStatus(mode: PreviewViewMode) {
  switch (mode) {
    case "split":
      return "Editor and preview shown";
    case "preview-only":
      return "Preview only shown";
    case "editor-only":
      return "Editor only shown";
  }
}
