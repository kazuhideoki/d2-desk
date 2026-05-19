import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { BottomPanel } from "./components/BottomPanel";
import { EditorPane } from "./components/EditorPane";
import { PreviewPane } from "./components/PreviewPane";
import { TabBar } from "./components/TabBar";
import { Toolbar } from "./components/Toolbar";
import { WorkspaceManager } from "./components/WorkspaceManager";
import { baseEditorFontSize, baseEditorLineHeight, zoomStep } from "./constants";
import {
  configureD2Language,
  getD2CompletionContext,
  isD2LineCommentPosition,
} from "./d2Language";
import {
  createEmptyTab,
  hasTabPendingUserChanges,
  loadActiveTabId,
  loadTabs,
  writeStoredTabs,
} from "./tabs";
import type {
  CompileResult,
  D2Tab,
  ExportResult,
  OpenedD2File,
  SavedD2File,
  SourceRange,
  StoredWorkspaces,
} from "./types";
import {
  baseName,
  clampZoom,
  downloadBytes,
  downloadURL,
  ensureD2FileName,
  fileNameFromPath,
  getDiagramViewBox,
  normalizeSvgSize,
} from "./utils";
import {
  activateWorkspace,
  addOrTouchWorkspace,
  getActiveWorkspace,
  loadWorkspaceActiveTabId,
  loadWorkspaces,
  loadWorkspaceTabs,
  removeWorkspace,
  writeWorkspaceTabs,
} from "./workspaces";
import "./App.css";

type InitialSession = {
  workspaceState: StoredWorkspaces;
  tabs: D2Tab[];
  activeTabId: string;
};

type CursorObjectLookup = {
  modelVersionId: number | null;
  objects: CompileResult["objects"];
};

type RenameNodeResult = {
  source: string;
  id: string;
};

type RenameDialogState = {
  id: string;
  value: string;
  error: string | null;
};

type InternalSuggestCompletionItem = {
  completion: Monaco.languages.CompletionItem;
};

type InternalSuggestFocusEvent = {
  item?: InternalSuggestCompletionItem;
};

type InternalSuggestWidget = {
  onDidFocus?: (listener: (event: InternalSuggestFocusEvent) => void) => Monaco.IDisposable;
  onDidHide?: (listener: () => void) => Monaco.IDisposable;
};

type InternalSuggestController = {
  widget?: {
    value?: InternalSuggestWidget;
  };
};

const nodeRenamePattern = /^[A-Za-z0-9_-]+$/;

function lastD2IdSegment(id: string) {
  const parts = id.split(".");
  return parts[parts.length - 1] ?? id;
}

function loadInitialSession(): InitialSession {
  const workspaceState = loadWorkspaces();
  const activeWorkspace = getActiveWorkspace(workspaceState);
  if (activeWorkspace) {
    const tabs = loadWorkspaceTabs(activeWorkspace);
    return {
      workspaceState,
      tabs,
      activeTabId: loadWorkspaceActiveTabId(activeWorkspace, tabs),
    };
  }

  const tabs = loadTabs();
  return {
    workspaceState,
    tabs,
    activeTabId: loadActiveTabId(tabs),
  };
}

function sourceRangeContains(range: SourceRange, lineNumber: number, column: number) {
  if (lineNumber < range.startLine || lineNumber > range.endLine) {
    return false;
  }
  if (lineNumber === range.startLine && column < range.startColumn) {
    return false;
  }
  if (lineNumber === range.endLine && column > range.endColumn) {
    return false;
  }
  return true;
}

function objectIdAtPosition(
  objects: CompileResult["objects"],
  lineNumber: number,
  column: number,
) {
  let bestMatch: { id: string; size: number } | null = null;
  for (const object of objects) {
    for (const range of object.sourceRanges ?? []) {
      if (sourceRangeContains(range, lineNumber, column)) {
        const size =
          range.startLine === range.endLine
            ? range.endColumn - range.startColumn
            : (range.endLine - range.startLine) * 10000 + range.endColumn - range.startColumn;
        if (!bestMatch || size < bestMatch.size) {
          bestMatch = { id: object.id, size };
        }
      }
    }
  }
  return bestMatch?.id ?? null;
}

function completionPreviewSource(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  completion: Monaco.languages.CompletionItem,
) {
  if (
    completion.insertTextRules &&
    completion.insertTextRules & monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
  ) {
    return null;
  }
  if (completion.additionalTextEdits?.length) {
    return null;
  }

  const completionRange =
    "replace" in completion.range ? completion.range.replace : completion.range;
  const range = model.validateRange(completionRange);
  const source = model.getValue();
  const startOffset = model.getOffsetAt({
    lineNumber: range.startLineNumber,
    column: range.startColumn,
  });
  const endOffset = model.getOffsetAt({
    lineNumber: range.endLineNumber,
    column: range.endColumn,
  });

  return `${source.slice(0, startOffset)}${completion.insertText}${source.slice(endOffset)}`;
}

function App() {
  const initialSessionRef = useRef<InitialSession | null>(null);
  if (!initialSessionRef.current) {
    initialSessionRef.current = loadInitialSession();
  }

  const [workspaceState, setWorkspaceState] = useState(
    () => initialSessionRef.current!.workspaceState,
  );
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [tabs, setTabs] = useState<D2Tab[]>(() => initialSessionRef.current!.tabs);
  const [activeTabId, setActiveTabId] = useState(() => initialSessionRef.current!.activeTabId);
  const [compileResult, setCompileResult] = useState<CompileResult>({
    svg: "",
    objects: [],
    diagnostics: [],
  });
  const [suggestPreviewResult, setSuggestPreviewResult] = useState<CompileResult | null>(null);
  const [status, setStatus] = useState("Ready");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);
  const [editorZoom, setEditorZoom] = useState(1);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [theme, setTheme] = useState(4);
  const [layout, setLayout] = useState("dagre");
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorationIds = useRef<string[]>([]);
  const activeCompileRequestId = useRef(0);
  const activeSuggestPreviewRequestId = useRef(0);
  const suggestPreviewTimeoutRef = useRef<number | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const openSourceFileRef = useRef<() => void>(() => undefined);
  const saveSourceRef = useRef<() => void>(() => undefined);
  const formatDocumentRef = useRef<() => void>(() => undefined);
  const closeActiveTabRef = useRef<() => void>(() => undefined);
  const quitApplicationRef = useRef<() => void>(() => undefined);
  const workspaceStateRef = useRef(workspaceState);
  const activeWorkspaceIdRef = useRef(workspaceState.activeWorkspaceId);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const editorTabIdRef = useRef(activeTabId);
  const objectLookupRef = useRef<CursorObjectLookup>({
    modelVersionId: null,
    objects: [],
  });
  const activeCursorLookupRequestId = useRef(0);
  const closeTabInFlightRef = useRef(false);
  const quitInFlightRef = useRef(false);
  const activeIdRef = useRef(activeId);
  const compileResultRef = useRef(compileResult);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );
  const source = activeTab?.source ?? "";
  const fileName = activeTab?.fileName ?? "untitled.d2";
  const currentFilePath = activeTab?.filePath ?? null;
  const latestCompileInputsRef = useRef({ tabId: activeTabId, source, layout, theme });
  latestCompileInputsRef.current = { tabId: activeTabId, source, layout, theme };
  const visibleCompileResult = suggestPreviewResult ?? compileResult;

  const activeObject = useMemo(
    () => visibleCompileResult.objects.find((object) => object.id === (hoverId ?? activeId)),
    [activeId, hoverId, visibleCompileResult.objects],
  );

  const renderedSvg = useMemo(
    () => normalizeSvgSize(visibleCompileResult.svg),
    [visibleCompileResult.svg],
  );

  const exportRenderedSvg = useMemo(() => normalizeSvgSize(compileResult.svg), [compileResult.svg]);

  const overlayViewBox = useMemo(() => getDiagramViewBox(renderedSvg), [renderedSvg]);

  const editorFontSize = Math.round(baseEditorFontSize * editorZoom);
  const editorLineHeight = Math.round(baseEditorLineHeight * editorZoom);

  useEffect(() => {
    workspaceStateRef.current = workspaceState;
    activeWorkspaceIdRef.current = workspaceState.activeWorkspaceId;
  }, [workspaceState]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  function invalidateCursorLookup() {
    activeCursorLookupRequestId.current += 1;
  }

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    compileResultRef.current = compileResult;
  }, [compileResult]);

  useEffect(() => {
    if (!renameDialog) return;
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renameDialog?.id]);

  const persistTabs = useCallback((nextTabs: D2Tab[], nextActiveTabId: string) => {
    const workspaceId = activeWorkspaceIdRef.current;
    if (!workspaceId) {
      writeStoredTabs(nextTabs, nextActiveTabId);
      return;
    }

    const hasWorkspace = workspaceStateRef.current.workspaces.some(
      (workspace) => workspace.id === workspaceId,
    );
    if (!hasWorkspace) {
      writeStoredTabs(nextTabs, nextActiveTabId);
      return;
    }

    workspaceStateRef.current = writeWorkspaceTabs(
      workspaceStateRef.current,
      workspaceId,
      nextTabs,
      nextActiveTabId,
    );
  }, []);

  const persistActiveEditorViewState = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return tabsRef.current;

    const tabId = activeTabIdRef.current;
    if (editorTabIdRef.current !== tabId) return tabsRef.current;

    const viewState = editor.saveViewState();
    if (!viewState) return tabsRef.current;

    const nextTabs = tabsRef.current.map((tab) =>
      tab.id === tabId ? { ...tab, editorViewState: viewState } : tab,
    );
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    persistTabs(nextTabs, tabId);
    return nextTabs;
  }, [persistTabs]);

  const activateTab = useCallback((tabId: string) => {
    invalidateCursorLookup();
    activeTabIdRef.current = tabId;
    setActiveTabId(tabId);
    setActiveId(null);
    setHoverId(null);
  }, []);

  const updateActiveTab = useCallback((updates: Partial<D2Tab>) => {
    if ("source" in updates) {
      invalidateCursorLookup();
    }
    setTabs((currentTabs) => {
      const tabId = activeTabIdRef.current;
      const nextTabs = currentTabs.map((tab) => {
        if (tab.id !== tabId) return tab;

        const nextTab = { ...tab, ...updates };
        if ("source" in updates || "savedSource" in updates) {
          nextTab.hasUserChanges = nextTab.source !== nextTab.savedSource;
        }
        return nextTab;
      });
      tabsRef.current = nextTabs;
      persistTabs(nextTabs, tabId);
      return nextTabs;
    });
  }, [persistTabs]);

  const createNewTab = useCallback(() => {
    const nextTab = createEmptyTab(tabsRef.current);
    const nextTabs = [...tabsRef.current, nextTab];
    tabsRef.current = nextTabs;
    activeTabIdRef.current = nextTab.id;
    invalidateCursorLookup();
    setTabs(nextTabs);
    setActiveTabId(nextTab.id);
    persistTabs(nextTabs, nextTab.id);
    setActiveId(null);
    setHoverId(null);
    setStatus(`Created ${nextTab.fileName}`);
  }, [persistTabs]);

  const clearSuggestPreview = useCallback(() => {
    activeSuggestPreviewRequestId.current += 1;
    if (suggestPreviewTimeoutRef.current !== null) {
      window.clearTimeout(suggestPreviewTimeoutRef.current);
      suggestPreviewTimeoutRef.current = null;
    }
    setSuggestPreviewResult(null);
  }, []);

  const scheduleSuggestPreview = useCallback(
    (previewSource: string, modelVersionId: number) => {
      const latestInputs = latestCompileInputsRef.current;
      if (previewSource === latestInputs.source) {
        clearSuggestPreview();
        return;
      }

      const requestId = activeSuggestPreviewRequestId.current + 1;
      activeSuggestPreviewRequestId.current = requestId;
      if (suggestPreviewTimeoutRef.current !== null) {
        window.clearTimeout(suggestPreviewTimeoutRef.current);
      }

      const tabId = latestInputs.tabId;
      const previewLayout = latestInputs.layout;
      const previewTheme = latestInputs.theme;
      suggestPreviewTimeoutRef.current = window.setTimeout(() => {
        suggestPreviewTimeoutRef.current = null;
        void (async () => {
          try {
            const result = await invoke<CompileResult>("sidecar_call", {
              method: "compile",
              params: { source: previewSource, layout: previewLayout, theme: previewTheme },
            });
            const currentInputs = latestCompileInputsRef.current;
            const currentModelVersionId = editorRef.current?.getModel()?.getVersionId() ?? null;
            if (
              requestId !== activeSuggestPreviewRequestId.current ||
              tabId !== currentInputs.tabId ||
              previewLayout !== currentInputs.layout ||
              previewTheme !== currentInputs.theme ||
              modelVersionId !== currentModelVersionId
            ) {
              return;
            }
            if (result.diagnostics.length > 0) {
              return;
            }
            setSuggestPreviewResult(result);
          } catch {
            // Keep the current valid preview when a transient candidate cannot compile.
          }
        })();
      }, 100);
    },
    [clearSuggestPreview],
  );

  const compile = useCallback(
    async (nextSource: string, tabId: string, requestId: number) => {
      try {
        const result = await invoke<CompileResult>("sidecar_call", {
          method: "compile",
          params: { source: nextSource, layout, theme },
        });
        const latestInputs = latestCompileInputsRef.current;
        if (
          requestId !== activeCompileRequestId.current ||
          tabId !== latestInputs.tabId ||
          nextSource !== latestInputs.source ||
          layout !== latestInputs.layout ||
          theme !== latestInputs.theme
        ) {
          return;
        }
        if (result.diagnostics.length > 0) {
          setCompileResult((previous) => ({
            ...previous,
            diagnostics: result.diagnostics,
          }));
          setStatus("Diagnostics updated; preview kept from last valid compile");
          return;
        }
        objectLookupRef.current = {
          modelVersionId: editorRef.current?.getModel()?.getVersionId() ?? null,
          objects: result.objects,
        };
        setCompileResult(result);
        setStatus("Compiled");
      } catch (error) {
        const latestInputs = latestCompileInputsRef.current;
        if (
          requestId !== activeCompileRequestId.current ||
          tabId !== latestInputs.tabId ||
          nextSource !== latestInputs.source ||
          layout !== latestInputs.layout ||
          theme !== latestInputs.theme
        ) {
          return;
        }
        setCompileResult((previous) => ({
          ...previous,
          diagnostics: [
            {
              message: String(error),
              severity: "error",
              sourceRange: {
                file: "main.d2",
                startLine: 1,
                startColumn: 1,
                endLine: 1,
                endColumn: 1,
              },
            },
          ],
        }));
        setStatus("Compile failed; preview kept from last valid compile");
      }
    },
    [layout, theme],
  );

  useEffect(() => {
    persistTabs(tabs, activeTabId);
  }, [activeTabId, persistTabs, tabs]);

  useEffect(() => {
    localStorage.setItem("d2-desk:last-source", source);
    clearSuggestPreview();
    const requestId = activeCompileRequestId.current + 1;
    activeCompileRequestId.current = requestId;
    setStatus("Compiling");
    const timeout = window.setTimeout(() => {
      void compile(source, activeTabId, requestId);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [activeTabId, clearSuggestPreview, compile, source]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;

    const markers = compileResult.diagnostics.map((diagnostic) => ({
      startLineNumber: diagnostic.sourceRange.startLine,
      startColumn: diagnostic.sourceRange.startColumn,
      endLineNumber: diagnostic.sourceRange.endLine,
      endColumn: diagnostic.sourceRange.endColumn,
      message: diagnostic.message,
      severity: monaco.MarkerSeverity.Error,
    }));
    monaco.editor.setModelMarkers(model, "d2", markers);
  }, [compileResult.diagnostics]);

  useEffect(() => {
    highlightObject(hoverId ?? activeId, false);
  }, [activeId, hoverId, visibleCompileResult.objects]);

  const openSourceFile = useCallback(async () => {
    try {
      const selected = await open({
        title: "Open D2 file",
        filters: [
          { name: "D2", extensions: ["d2"] },
          { name: "Text", extensions: ["txt"] },
        ],
        multiple: false,
        defaultPath: currentFilePath ?? undefined,
      });
      if (!selected || Array.isArray(selected)) {
        setStatus("Open canceled");
        return;
      }

      const result = await invoke<OpenedD2File>("read_d2_file", { path: selected });
      updateActiveTab({
        source: result.contents,
        savedSource: result.contents,
        fileName: fileNameFromPath(result.path),
        filePath: result.path,
        editorViewState: null,
      });
      setStatus(`Opened ${result.path}`);
    } catch (error) {
      setStatus(String(error));
    }
  }, [currentFilePath, updateActiveTab]);

  const saveSource = useCallback(async () => {
    try {
      const path =
        currentFilePath ??
        (await save({
          title: "Save D2 file",
          filters: [{ name: "D2", extensions: ["d2"] }],
          defaultPath: ensureD2FileName(fileName),
        }));
      if (!path) {
        setStatus("Save canceled");
        return;
      }

      const result = await invoke<SavedD2File>("write_d2_file", {
        path,
        contents: source,
      });
      updateActiveTab({
        fileName: fileNameFromPath(result.path),
        filePath: result.path,
        savedSource: source,
      });
      setStatus(`Saved ${result.path}`);
    } catch (error) {
      setStatus(String(error));
    }
  }, [currentFilePath, fileName, source, updateActiveTab]);

  const openWithEditor = useCallback(async () => {
    try {
      const path =
        currentFilePath ??
        (await save({
          title: "Save D2 file before opening with $EDITOR",
          filters: [{ name: "D2", extensions: ["d2"] }],
          defaultPath: ensureD2FileName(fileName),
        }));
      if (!path) {
        setStatus("Open with editor canceled");
        return;
      }

      const result = await invoke<SavedD2File>("write_d2_file", {
        path,
        contents: source,
      });
      updateActiveTab({
        fileName: fileNameFromPath(result.path),
        filePath: result.path,
        savedSource: source,
      });
      await invoke("open_file_with_editor", { path: result.path });
      setStatus(`Opened with $EDITOR: ${result.path}`);
    } catch (error) {
      setStatus(String(error));
    }
  }, [currentFilePath, fileName, source, updateActiveTab]);

  const formatDocument = useCallback(async () => {
    try {
      const formatted = await invoke<string>("sidecar_call", {
        method: "format",
        params: { source },
      });
      updateActiveTab({ source: formatted });
      setStatus("Formatted");
    } catch (error) {
      setStatus(String(error));
    }
  }, [source, updateActiveTab]);

  const renameFocusedNode = useCallback(async () => {
    const editor = editorRef.current;
    const currentSource = latestCompileInputsRef.current.source;
    let targetId = activeIdRef.current;

    if (!targetId && editor) {
      const position = editor.getPosition();
      if (position) {
        try {
          const result = await invoke<{ id?: string }>("sidecar_call", {
            method: "nodeAt",
            params: {
              source: currentSource,
              line: position.lineNumber,
              column: position.column,
            },
          });
          targetId = result.id ?? null;
        } catch {
          targetId = null;
        }
      }
    }

    if (!targetId) {
      setStatus("Select a node to rename");
      return;
    }

    const selectedObject = compileResultRef.current.objects.find((object) => object.id === targetId);
    if (selectedObject?.kind === "connection") {
      setStatus("Select a node to rename");
      return;
    }

    const currentName = lastD2IdSegment(targetId);
    setRenameDialog({ id: targetId, value: currentName, error: null });
    setStatus(`Renaming ${targetId}`);
  }, []);

  const commitRenameNode = useCallback(async () => {
    if (!renameDialog) return;

    const targetId = renameDialog.id;
    const currentName = lastD2IdSegment(targetId);
    const newName = renameDialog.value.trim();
    if (newName === currentName) {
      setStatus("Rename unchanged");
      setRenameDialog(null);
      return;
    }
    if (!nodeRenamePattern.test(newName)) {
      setRenameDialog((current) =>
        current
          ? {
              ...current,
              error: "Use only letters, numbers, underscores, or hyphens.",
            }
          : current,
      );
      return;
    }

    try {
      const result = await invoke<RenameNodeResult>("sidecar_call", {
        method: "renameNode",
        params: { source: latestCompileInputsRef.current.source, id: targetId, newName },
      });
      updateActiveTab({ source: result.source });
      setActiveId(result.id);
      activeIdRef.current = result.id;
      setHoverId(null);
      setRenameDialog(null);
      setStatus(`Renamed ${targetId} to ${result.id}`);
      window.requestAnimationFrame(() => editorRef.current?.focus());
    } catch (error) {
      setRenameDialog((current) =>
        current ? { ...current, error: String(error).replace(/^Error: /, "") } : current,
      );
    }
  }, [renameDialog, updateActiveTab]);

  const closeTab = useCallback(async (tabId: string) => {
    if (closeTabInFlightRef.current) return;
    closeTabInFlightRef.current = true;

    try {
      const currentTabs =
        tabId === activeTabIdRef.current && tabsRef.current.length === 1
          ? persistActiveEditorViewState()
          : tabsRef.current;
      const targetTab = currentTabs.find((tab) => tab.id === tabId);
      if (!targetTab) return;

      if (hasTabPendingUserChanges(targetTab)) {
        const shouldClose = await confirm(
          `${targetTab.fileName} has unsaved changes. Close it anyway?`,
          {
            title: "Unsaved changes",
            kind: "warning",
            okLabel: "Close without saving",
            cancelLabel: "Cancel",
          },
        );
        if (!shouldClose) {
          setStatus("Close canceled");
          return;
        }
      }

      if (currentTabs.length === 1) {
        setStatus(`Closing ${targetTab.fileName}`);
        try {
          await invoke("close_current_window");
        } catch {
          window.close();
        }
        return;
      }

      const targetIndex = currentTabs.findIndex((tab) => tab.id === tabId);
      const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);
      if (tabId === activeTabIdRef.current) {
        const nextActiveTab = nextTabs[Math.min(targetIndex, nextTabs.length - 1)] ?? nextTabs[0];
        activeTabIdRef.current = nextActiveTab.id;
        invalidateCursorLookup();
        setActiveTabId(nextActiveTab.id);
        setActiveId(null);
        setHoverId(null);
      }
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      persistTabs(nextTabs, activeTabIdRef.current);
      setStatus(`Closed ${targetTab.fileName}`);
    } finally {
      closeTabInFlightRef.current = false;
    }
  }, [persistActiveEditorViewState, persistTabs]);

  const closeActiveTab = useCallback(() => {
    void closeTab(activeTabId);
  }, [activeTabId, closeTab]);

  const quitApplication = useCallback(async () => {
    if (quitInFlightRef.current) return;
    quitInFlightRef.current = true;

    try {
      const currentTabs = persistActiveEditorViewState();
      const unsavedTabs = currentTabs.filter(hasTabPendingUserChanges);
      if (unsavedTabs.length > 0) {
        const fileList = unsavedTabs.map((tab) => tab.fileName).join(", ");
        const shouldQuit = await confirm(
          `${fileList} ${unsavedTabs.length === 1 ? "has" : "have"} unsaved changes. Quit anyway?`,
          {
            title: "Unsaved changes",
            kind: "warning",
            okLabel: "Quit without saving",
            cancelLabel: "Cancel",
          },
        );
        if (!shouldQuit) {
          setStatus("Quit canceled");
          return;
        }
      }

      setStatus("Quitting");
      try {
        await invoke("quit_application");
      } catch {
        window.close();
      }
    } finally {
      quitInFlightRef.current = false;
    }
  }, [persistActiveEditorViewState]);

  const applyWorkspaceSelection = useCallback(
    (
      nextWorkspaceState: StoredWorkspaces,
      workspaceId: string | null,
      tabOverride?: { tabs: D2Tab[]; activeTabId: string },
    ) => {
      const workspace = workspaceId
        ? nextWorkspaceState.workspaces.find((item) => item.id === workspaceId)
        : null;
      const nextTabs = tabOverride?.tabs ?? (workspace ? loadWorkspaceTabs(workspace) : loadTabs());
      const nextActiveTabId =
        tabOverride?.activeTabId ??
        (workspace ? loadWorkspaceActiveTabId(workspace, nextTabs) : loadActiveTabId(nextTabs));

      workspaceStateRef.current = nextWorkspaceState;
      activeWorkspaceIdRef.current = workspaceId;
      tabsRef.current = nextTabs;
      activeTabIdRef.current = nextActiveTabId;
      editorTabIdRef.current = nextActiveTabId;
      invalidateCursorLookup();
      setWorkspaceState(nextWorkspaceState);
      setTabs(nextTabs);
      setActiveTabId(nextActiveTabId);
      setActiveId(null);
      setHoverId(null);
    },
    [],
  );

  const confirmLeavingCurrentWorkspace = useCallback(async () => {
    const currentTabs = persistActiveEditorViewState();
    const unsavedTabs = currentTabs.filter(hasTabPendingUserChanges);
    if (unsavedTabs.length === 0) return currentTabs;

    const fileList = unsavedTabs.map((tab) => tab.fileName).join(", ");
    const shouldSwitch = await confirm(
      `${fileList} ${unsavedTabs.length === 1 ? "has" : "have"} unsaved changes. Switch workspace anyway?`,
      {
        title: "Unsaved changes",
        kind: "warning",
        okLabel: "Switch without saving",
        cancelLabel: "Cancel",
      },
    );
    if (!shouldSwitch) {
      setStatus("Workspace switch canceled");
      return null;
    }
    return currentTabs;
  }, [persistActiveEditorViewState]);

  const switchWorkspace = useCallback(
    async (workspaceId: string | null) => {
      if (workspaceId === activeWorkspaceIdRef.current) return;
      if (
        workspaceId &&
        !workspaceStateRef.current.workspaces.some((workspace) => workspace.id === workspaceId)
      ) {
        setStatus("Workspace not found");
        return;
      }

      if (!(await confirmLeavingCurrentWorkspace())) return;

      const nextWorkspaceState = activateWorkspace(workspaceStateRef.current, workspaceId);
      applyWorkspaceSelection(nextWorkspaceState, workspaceId);
      const workspace = workspaceId
        ? nextWorkspaceState.workspaces.find((item) => item.id === workspaceId)
        : null;
      setStatus(workspace ? `Switched to ${workspace.name}` : "Switched to No Workspace");
    },
    [applyWorkspaceSelection, confirmLeavingCurrentWorkspace],
  );

  const openWorkspaceFolder = useCallback(async () => {
    try {
      const selected = await open({
        title: "Open Workspace Folder",
        directory: true,
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) {
        setStatus("Open workspace canceled");
        return;
      }

      if (!(await confirmLeavingCurrentWorkspace())) return;

      const result = addOrTouchWorkspace(workspaceStateRef.current, selected);
      applyWorkspaceSelection(result.state, result.workspaceId);
      const workspace = result.state.workspaces.find((item) => item.id === result.workspaceId);
      setStatus(
        workspace
          ? `${result.created ? "Registered" : "Switched to"} ${workspace.name}`
          : "Workspace updated",
      );
    } catch (error) {
      setStatus(String(error));
    }
  }, [applyWorkspaceSelection, confirmLeavingCurrentWorkspace]);

  const removeRegisteredWorkspace = useCallback(
    async (workspaceId: string) => {
      const workspace = workspaceStateRef.current.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) return;

      const shouldRemove = await confirm(
        `Remove ${workspace.name} from D2 Desk? Files in the folder will not be deleted.`,
        {
          title: "Remove workspace",
          kind: "warning",
          okLabel: "Remove",
          cancelLabel: "Cancel",
        },
      );
      if (!shouldRemove) {
        setStatus("Remove workspace canceled");
        return;
      }

      const wasActive = workspaceId === activeWorkspaceIdRef.current;
      const currentTabs = wasActive ? persistActiveEditorViewState() : tabsRef.current;
      const currentActiveTabId = activeTabIdRef.current;
      const nextWorkspaceState = removeWorkspace(workspaceStateRef.current, workspaceId);

      if (wasActive) {
        writeStoredTabs(currentTabs, currentActiveTabId);
        applyWorkspaceSelection(nextWorkspaceState, null, {
          tabs: currentTabs,
          activeTabId: currentActiveTabId,
        });
      } else {
        workspaceStateRef.current = nextWorkspaceState;
        setWorkspaceState(nextWorkspaceState);
      }
      setStatus(`Removed ${workspace.name}`);
    },
    [applyWorkspaceSelection, persistActiveEditorViewState],
  );

  useEffect(() => {
    openSourceFileRef.current = () => {
      void openSourceFile();
    };
    saveSourceRef.current = () => {
      void saveSource();
    };
    formatDocumentRef.current = () => {
      void formatDocument();
    };
    closeActiveTabRef.current = closeActiveTab;
    quitApplicationRef.current = () => {
      void quitApplication();
    };
  }, [closeActiveTab, formatDocument, openSourceFile, quitApplication, saveSource]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    void listen("d2-desk-open", () => openSourceFileRef.current()).then((unlisten) => {
      unlisteners.push(unlisten);
    });
    void listen("d2-desk-save", () => saveSourceRef.current()).then((unlisten) => {
      unlisteners.push(unlisten);
    });
    void listen("d2-desk-close-tab", () => closeActiveTabRef.current()).then((unlisten) => {
      unlisteners.push(unlisten);
    });
    void listen("d2-desk-request-quit", () => quitApplicationRef.current()).then((unlisten) => {
      unlisteners.push(unlisten);
    });

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F2" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        void renameFocusedNode();
        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();

      if (key === "o") {
        event.preventDefault();
        void openSourceFile();
      } else if (key === "s") {
        event.preventDefault();
        void saveSource();
      } else if (event.shiftKey && key === "i") {
        event.preventDefault();
        event.stopImmediatePropagation();
        void formatDocument();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
      } else if (event.key === "0") {
        event.preventDefault();
        resetView();
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        createNewTab();
      } else if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeActiveTab();
      } else if (event.key.toLowerCase() === "q") {
        event.preventDefault();
        event.stopImmediatePropagation();
        void quitApplication();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    closeActiveTab,
    createNewTab,
    formatDocument,
    openSourceFile,
    quitApplication,
    renameFocusedNode,
    saveSource,
  ]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editorTabIdRef.current = activeTab?.id ?? activeTabIdRef.current;
    let isAutoClosingD2Brace = false;
    const savedViewState = activeTab?.editorViewState;
    if (savedViewState) {
      window.requestAnimationFrame(() => {
        try {
          editor.restoreViewState(savedViewState);
          const position = editor.getPosition();
          if (position) {
            void updateFocusedObjectFromPosition(editor, position);
          }
        } catch {
          updateActiveTab({ editorViewState: null });
        }
      });
    }
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO, () => {
      openSourceFileRef.current();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveSourceRef.current();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI, () => {
      formatDocumentRef.current();
    });
    editor.addCommand(monaco.KeyCode.F2, () => {
      void renameFocusedNode();
    });
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyD,
      () => {
        editor.trigger("keyboard", "editor.action.copyLinesDownAction", null);
      },
    );
    const suggestController = editor.getContribution(
      "editor.contrib.suggestController",
    ) as InternalSuggestController | null;
    const suggestWidget = suggestController?.widget?.value;
    const suggestPreviewDisposables: Monaco.IDisposable[] = [];
    if (suggestWidget?.onDidFocus) {
      suggestPreviewDisposables.push(
        suggestWidget.onDidFocus((event) => {
          const model = editor.getModel();
          const completion = event.item?.completion;
          if (!model || !completion) {
            clearSuggestPreview();
            return;
          }

          const previewSource = completionPreviewSource(monaco, model, completion);
          if (!previewSource) {
            clearSuggestPreview();
            return;
          }
          scheduleSuggestPreview(previewSource, model.getVersionId());
        }),
      );
    }
    if (suggestWidget?.onDidHide) {
      suggestPreviewDisposables.push(suggestWidget.onDidHide(clearSuggestPreview));
    }
    editor.onDidDispose(() => {
      for (const disposable of suggestPreviewDisposables) {
        disposable.dispose();
      }
      clearSuggestPreview();
    });

    editor.onDidChangeModelContent((event) => {
      if (isAutoClosingD2Brace) {
        return;
      }

      const position = editor.getPosition();
      const model = editor.getModel();
      if (!position || !model) return;

      const openBraceChange = event.changes.find((change) => {
        if (change.text !== "{" || change.rangeLength !== 0) {
          return false;
        }

        const lineContent = model.getLineContent(change.range.startLineNumber);
        return !isD2LineCommentPosition(lineContent, change.range.startColumn);
      });

      if (openBraceChange) {
        const lineNumber = openBraceChange.range.startLineNumber;
        const nextColumn = openBraceChange.range.startColumn + 1;
        isAutoClosingD2Brace = true;
        try {
          editor.executeEdits("d2-auto-close-brace", [
            {
              range: new monaco.Range(lineNumber, nextColumn, lineNumber, nextColumn),
              text: "}",
              forceMoveMarkers: true,
            },
          ]);
          editor.setPosition({ lineNumber, column: nextColumn });
        } finally {
          isAutoClosingD2Brace = false;
        }
      }

      const currentPosition = editor.getPosition();
      if (!currentPosition) return;

      const lineContent = model.getLineContent(currentPosition.lineNumber);
      if (isD2LineCommentPosition(lineContent, currentPosition.column)) return;

      const completionContext = getD2CompletionContext(lineContent, currentPosition.column);
      if (!completionContext) return;

      const shouldTriggerD2Suggest = event.changes.some(
        (change) => change.text === ":" || change.text === " " || /^[\w-]$/.test(change.text),
      );
      if (shouldTriggerD2Suggest) {
        const triggerSource =
          completionContext.kind === "key" ? "d2-key-completion" : "d2-value-completion";
        window.setTimeout(() => {
          editor.trigger(triggerSource, "editor.action.triggerSuggest", {});
        }, 0);
      }
    });
    editor.onDidChangeCursorPosition((event) => {
      void updateFocusedObjectFromPosition(editor, event.position);
    });
  };

  async function updateFocusedObjectFromPosition(
    editor: Monaco.editor.IStandaloneCodeEditor,
    position: Monaco.IPosition,
  ) {
    const requestId = activeCursorLookupRequestId.current + 1;
    activeCursorLookupRequestId.current = requestId;
    const tabId = activeTabIdRef.current;
    const model = editor.getModel();
    const modelVersionId = model?.getVersionId() ?? null;
    const lookup = objectLookupRef.current;

    const nextActiveId =
      modelVersionId !== null && modelVersionId === lookup.modelVersionId
        ? objectIdAtPosition(lookup.objects, position.lineNumber, position.column)
        : await objectIdAtCurrentPosition(editor.getValue(), position);
    if (requestId !== activeCursorLookupRequestId.current) {
      return;
    }
    if (
      tabId !== activeTabIdRef.current ||
      model !== editor.getModel() ||
      modelVersionId !== (editor.getModel()?.getVersionId() ?? null)
    ) {
      return;
    }
    setActiveId((currentActiveId) =>
      currentActiveId === nextActiveId ? currentActiveId : nextActiveId,
    );
  }

  async function objectIdAtCurrentPosition(source: string, position: Monaco.IPosition) {
    try {
      const result = await invoke<{ id?: string }>("sidecar_call", {
        method: "nodeAt",
        params: {
          source,
          line: position.lineNumber,
          column: position.column,
        },
      });
      return result.id ?? null;
    } catch {
      return null;
    }
  }

  function highlightObject(id: string | null, reveal: boolean) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const object = compileResult.objects.find((item) => item.id === id);
    const sourceRanges = object?.sourceRanges ?? [];
    const decorations =
      sourceRanges.map((range) => ({
        range: new monaco.Range(
          range.startLine,
          range.startColumn,
          range.endLine,
          range.endColumn,
        ),
        options: {
          className: "source-highlight",
          overviewRuler: {
            color: "#0f766e",
            position: monaco.editor.OverviewRulerLane.Center,
          },
        },
      })) ?? [];
    decorationIds.current = editor.deltaDecorations(decorationIds.current, decorations);
    if (reveal && sourceRanges[0]) {
      editor.revealLineInCenter(sourceRanges[0].startLine);
      editor.setPosition({
        lineNumber: sourceRanges[0].startLine,
        column: sourceRanges[0].startColumn,
      });
      editor.focus();
    }
  }

  async function exportSVG() {
    try {
      const result = await invoke<ExportResult>("sidecar_call", {
        method: "export",
        params: { source, format: "svg", layout, theme },
      });
      downloadBytes(`${baseName(fileName)}.svg`, result.data, "image/svg+xml");
      setStatus("Exported SVG");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function exportPNG() {
    const image = new Image();
    const svgBlob = new Blob([exportRenderedSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(image.width, 1200);
      canvas.height = Math.max(image.height, 800);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      const pngUrl = canvas.toDataURL("image/png");
      downloadURL(`${baseName(fileName)}.png`, pngUrl);
      setStatus("Exported PNG");
    };
    image.onerror = () => setStatus("PNG export failed");
    image.src = url;
  }

  function resetView() {
    setEditorZoom(1);
    setPreviewZoom(1);
  }

  function zoomIn() {
    setEditorZoom((value) => clampZoom(value + zoomStep));
    setPreviewZoom((value) => clampZoom(value + zoomStep));
  }

  function zoomOut() {
    setEditorZoom((value) => clampZoom(value - zoomStep));
    setPreviewZoom((value) => clampZoom(value - zoomStep));
  }

  function resetEditorZoom() {
    setEditorZoom(1);
  }

  function zoomEditorIn() {
    setEditorZoom((value) => clampZoom(value + zoomStep));
  }

  function zoomEditorOut() {
    setEditorZoom((value) => clampZoom(value - zoomStep));
  }

  function resetPreviewZoom() {
    setPreviewZoom(1);
  }

  function zoomPreviewIn() {
    setPreviewZoom((value) => clampZoom(value + zoomStep));
  }

  function zoomPreviewOut() {
    setPreviewZoom((value) => clampZoom(value - zoomStep));
  }

  return (
    <main className="app-shell">
      <Toolbar
        workspaces={workspaceState.workspaces}
        activeWorkspaceId={workspaceState.activeWorkspaceId}
        theme={theme}
        layout={layout}
        onWorkspaceChange={(workspaceId) => {
          void switchWorkspace(workspaceId);
        }}
        onOpenWorkspace={() => {
          void openWorkspaceFolder();
        }}
        onManageWorkspaces={() => setWorkspaceManagerOpen(true)}
        onThemeChange={setTheme}
        onLayoutChange={setLayout}
        onOpen={openSourceFile}
        onSave={saveSource}
        onOpenWithEditor={openWithEditor}
        onFormat={formatDocument}
        onZoomOut={zoomOut}
        onResetView={resetView}
        onZoomIn={zoomIn}
        onExportSvg={exportSVG}
        onExportPng={exportPNG}
      />

      {workspaceManagerOpen ? (
        <WorkspaceManager
          workspaces={workspaceState.workspaces}
          activeWorkspaceId={workspaceState.activeWorkspaceId}
          onClose={() => setWorkspaceManagerOpen(false)}
          onRemoveWorkspace={(workspaceId) => {
            void removeRegisteredWorkspace(workspaceId);
          }}
        />
      ) : null}

      {renameDialog ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-dialog-title"
            onSubmit={(event) => {
              event.preventDefault();
              void commitRenameNode();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setRenameDialog(null);
                setStatus("Rename canceled");
                window.requestAnimationFrame(() => editorRef.current?.focus());
              }
            }}
          >
            <header className="rename-dialog-header">
              <h2 id="rename-dialog-title">Rename node</h2>
              <span>{renameDialog.id}</span>
            </header>
            <input
              ref={renameInputRef}
              aria-label="Node name"
              value={renameDialog.value}
              onChange={(event) =>
                setRenameDialog((current) =>
                  current ? { ...current, value: event.target.value, error: null } : current,
                )
              }
            />
            {renameDialog.error ? <p className="rename-dialog-error">{renameDialog.error}</p> : null}
            <footer className="rename-dialog-actions">
              <button
                className="dialog-button secondary"
                type="button"
                onClick={() => {
                  setRenameDialog(null);
                  setStatus("Rename canceled");
                  window.requestAnimationFrame(() => editorRef.current?.focus());
                }}
              >
                Cancel
              </button>
              <button className="dialog-button primary" type="submit">
                Rename
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivateTab={activateTab}
        onCloseTab={(tabId) => {
          void closeTab(tabId);
        }}
        onCreateTab={createNewTab}
      />

      <section className="workspace">
        <EditorPane
          activeTabId={activeTabId}
          fileName={fileName}
          source={source}
          zoom={editorZoom}
          editorFontSize={editorFontSize}
          editorLineHeight={editorLineHeight}
          beforeMount={configureD2Language}
          onMount={handleMount}
          onChange={(value) => updateActiveTab({ source: value })}
          onZoomOut={zoomEditorOut}
          onResetZoom={resetEditorZoom}
          onZoomIn={zoomEditorIn}
        />

        <PreviewPane
          objects={visibleCompileResult.objects}
          renderedSvg={renderedSvg}
          overlayViewBox={overlayViewBox}
          zoom={previewZoom}
          activeId={activeId}
          hoverId={hoverId}
          onHover={setHoverId}
          onSelect={(id) => {
            invalidateCursorLookup();
            setActiveId(id);
            highlightObject(id, true);
          }}
          onZoomOut={zoomPreviewOut}
          onResetZoom={resetPreviewZoom}
          onZoomIn={zoomPreviewIn}
        />
      </section>

      <BottomPanel
        status={status}
        activeObject={activeObject}
        diagnostics={compileResult.diagnostics}
      />
    </main>
  );
}

export default App;
