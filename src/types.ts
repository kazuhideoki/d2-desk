import type * as Monaco from "monaco-editor";

export type SourceRange = {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type D2Point = {
  x: number;
  y: number;
};

export type D2Object = {
  id: string;
  kind: "shape" | "connection";
  boardPath?: string[];
  label?: string;
  src?: string;
  dst?: string;
  sourceRanges?: SourceRange[] | null;
  preview: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    path?: string;
    route?: D2Point[];
  };
};

export type D2Board = {
  path: string[];
  kind: "root" | "layers" | "scenarios" | "steps";
  name: string;
  label: string;
  depth: number;
};

export type Diagnostic = {
  message: string;
  severity: "error" | "warning" | "info";
  sourceRange: SourceRange;
};

export type CompileResult = {
  svg: string;
  objects: D2Object[];
  boards?: D2Board[];
  diagnostics: Diagnostic[];
};

export type PerfDebugOptions = {
  wordWrap: boolean;
  autoSuggest: boolean;
  suggestPreview: boolean;
  previewCompile: boolean;
  previewRender: boolean;
};

export type ExportResult = {
  format: string;
  data: string;
};

export type D2CompletionItem = {
  label: string;
  kind: "keyword" | "style" | "shape" | "file" | "icon";
  detail: string;
  description: string;
  documentation: string;
  insertText: string;
  filterText?: string;
  colorSwatches?: string[];
};

export type D2Tab = {
  id: string;
  fileName: string;
  source: string;
  savedSource: string;
  filePath: string | null;
  hasUserChanges: boolean;
  editorViewState: Monaco.editor.ICodeEditorViewState | null;
};

export type StoredTabs = {
  activeTabId: string;
  tabs: D2Tab[];
};

export type Workspace = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  lastOpenedAt: string;
  activeTabId: string;
  tabs: D2Tab[];
};

export type StoredWorkspaces = {
  activeWorkspaceId: string | null;
  workspaces: Workspace[];
};

export type OpenedD2File = {
  path: string;
  contents: string;
};

export type SavedD2File = {
  path: string;
};

export type RenamedD2File = {
  path: string;
  updatedReferences: RenamedD2FileReferenceUpdate[];
};

export type RenamedD2FileReferenceUpdate = {
  path: string;
  contents: string;
  saved: boolean;
};

export type WorkspaceFileEntry = {
  path: string;
  relativePath: string;
  fileName: string;
  directory: string;
};
