import { previewLayoutStorageKey } from "../../constants";

export type PreviewViewMode = "split" | "preview-only" | "editor-only";
export type EditorPaneRatioMode = "auto" | "manual";

export type PreviewLayout = {
  viewMode: PreviewViewMode;
  detached: boolean;
  editorPaneRatio: number;
  editorPaneRatioMode: EditorPaneRatioMode;
};

export const defaultPreviewLayout: PreviewLayout = {
  viewMode: "split",
  detached: false,
  editorPaneRatio: 0.475,
  editorPaneRatioMode: "auto",
};

export const minEditorPaneRatio = 0.2;
export const maxEditorPaneRatio = 0.8;
export const minAutoEditorPaneWidth = 360;
const editorPaneHorizontalChromeWidth = 92;
const editorPaneCharacterWidthRatio = 0.62;
const editorPaneDefaultTabSize = 2;

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
  const editorPaneRatioMode = normalizeEditorPaneRatioMode(layout.editorPaneRatioMode);
  if (detached) {
    return { viewMode: "editor-only", detached: true, editorPaneRatio, editorPaneRatioMode };
  }

  return {
    viewMode: isPreviewViewMode(layout.viewMode) ? layout.viewMode : defaultPreviewLayout.viewMode,
    detached: false,
    editorPaneRatio,
    editorPaneRatioMode,
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

export function editorPaneRatioForSource({
  source,
  containerWidth,
  fontSize,
}: {
  source: string;
  containerWidth: number;
  fontSize: number;
}) {
  if (containerWidth <= 0 || fontSize <= 0 || !Number.isFinite(fontSize)) {
    return defaultPreviewLayout.editorPaneRatio;
  }

  const longestLineColumns = sourceLongestLineColumns(source);
  const characterWidth = fontSize * editorPaneCharacterWidthRatio;
  const sourceWidth = longestLineColumns * characterWidth + editorPaneHorizontalChromeWidth;
  const editorWidth = Math.max(minAutoEditorPaneWidth, sourceWidth);
  return normalizeEditorPaneRatio(editorWidth / containerWidth);
}

export function sourceLongestLineColumns(source: string, tabSize = editorPaneDefaultTabSize) {
  return source
    .split("\n")
    .reduce((longest, line) => Math.max(longest, lineDisplayColumns(line, tabSize)), 0);
}

function isPreviewViewMode(value: unknown): value is PreviewViewMode {
  return value === "split" || value === "preview-only" || value === "editor-only";
}

function normalizeEditorPaneRatioMode(value: unknown): EditorPaneRatioMode {
  if (isEditorPaneRatioMode(value)) return value;
  return defaultPreviewLayout.editorPaneRatioMode;
}

function isEditorPaneRatioMode(value: unknown): value is EditorPaneRatioMode {
  return value === "auto" || value === "manual";
}

function lineDisplayColumns(line: string, tabSize: number) {
  let columns = 0;
  for (const character of line) {
    if (character === "\t") {
      columns += tabSize - (columns % tabSize);
      continue;
    }

    columns += isFullWidthCodePoint(character.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return columns;
}

function isFullWidthCodePoint(codePoint: number) {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
      (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}
