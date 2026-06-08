import { previewLayoutStorageKey } from "../../constants";

export type PreviewViewMode = "split" | "preview-only" | "editor-only";

export type PreviewLayout = {
  viewMode: PreviewViewMode;
  detached: boolean;
  editorPaneRatio: number;
};

export const defaultPreviewLayout: PreviewLayout = {
  viewMode: "split",
  detached: false,
  editorPaneRatio: 0.475,
};

export const minEditorPaneRatio = 0.2;
export const maxEditorPaneRatio = 0.8;

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

export function loadPreviewLayout(): PreviewLayout {
  const stored = localStorage.getItem(previewLayoutStorageKey);
  if (!stored) return defaultPreviewLayout;

  try {
    return normalizePreviewLayout(JSON.parse(stored));
  } catch {
    return defaultPreviewLayout;
  }
}

export function writePreviewLayout(layout: PreviewLayout) {
  localStorage.setItem(previewLayoutStorageKey, JSON.stringify(normalizePreviewLayout(layout)));
}

export function normalizePreviewLayout(value: unknown): PreviewLayout {
  if (!value || typeof value !== "object") return defaultPreviewLayout;

  const layout = value as Partial<PreviewLayout>;
  const detached = layout.detached === true;
  const editorPaneRatio = normalizeEditorPaneRatio(layout.editorPaneRatio);
  if (detached) {
    return { viewMode: "editor-only", detached: true, editorPaneRatio };
  }

  return {
    viewMode: isPreviewViewMode(layout.viewMode) ? layout.viewMode : defaultPreviewLayout.viewMode,
    detached: false,
    editorPaneRatio,
  };
}

export function normalizeEditorPaneRatio(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultPreviewLayout.editorPaneRatio;
  }
  return Math.min(maxEditorPaneRatio, Math.max(minEditorPaneRatio, value));
}

export function editorPaneRatioFromPointer(
  clientX: number,
  containerLeft: number,
  containerWidth: number,
) {
  if (containerWidth <= 0) return defaultPreviewLayout.editorPaneRatio;
  return normalizeEditorPaneRatio((clientX - containerLeft) / containerWidth);
}

function isPreviewViewMode(value: unknown): value is PreviewViewMode {
  return value === "split" || value === "preview-only" || value === "editor-only";
}
