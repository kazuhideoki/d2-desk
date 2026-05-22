import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { loadInitialSession, type InitialSession } from "./app/initialSession";
import { CommandPalette } from "./features/command-palette/CommandPalette";
import { isCommandEnabled, type AppCommand } from "./shared/commands";
import { EditorPane } from "./features/editor/EditorPane";
import { connectionIdAtPosition } from "./features/editor/sourceRanges";
import { findSwitchableEdge, switchEdgeDirectionInSource } from "./features/editor/switchEdge";
import {
  completionPreviewSource,
  isD2IconValueCompletionPosition,
  monacoCompletionLabelText,
  pickD2IconCompletion,
  pickD2IconCompletionByLabel,
  previewSourceWithInsertText,
  rememberSuggestPreview,
  suggestPreviewCacheKey,
} from "./features/editor/suggestPreview";
import { filterWorkspaceFiles } from "./features/file-palette/workspaceFileSearch";
import {
  WorkspaceFilePalette,
  type WorkspaceFilePaletteState,
} from "./features/file-palette/WorkspaceFilePalette";
import { PreviewPane, type PreviewZoomMode } from "./features/preview/PreviewPane";
import {
  nextPreviewViewMode,
  previewViewModeStatus,
  type PreviewViewMode,
} from "./features/preview/viewMode";
import { RenameNodeDialog, type RenameDialogState } from "./features/rename-node/RenameNodeDialog";
import { BottomPanel } from "./features/status/BottomPanel";
import { SymbolPalette, type SymbolPaletteState } from "./features/symbol-palette/SymbolPalette";
import {
  buildD2SymbolEntries,
  filterD2Symbols,
} from "./features/symbol-palette/symbolSearch";
import { TabBar } from "./features/tabs/TabBar";
import { baseEditorFontSize, baseEditorLineHeight } from "./constants";
import {
  configureD2Language,
  getD2CompletionContext,
  isD2LineCommentPosition,
  setD2ImportCompletionContextProvider,
} from "./d2Language";
import {
  createTab,
  createEmptyTab,
  hasTabPendingUserChanges,
  loadActiveTabId,
  loadTabs,
  reorderTabs,
  tabAbsolutePath,
  type TabDropPosition,
  writeStoredTabs,
} from "./features/tabs/tabs";
import { Toolbar } from "./features/toolbar/Toolbar";
import type {
  CompileResult,
  D2CompletionItem,
  D2Tab,
  ExportResult,
  OpenedD2File,
  PerfDebugOptions,
  RenamedD2File,
  SavedD2File,
  StoredWorkspaces,
  WorkspaceFileEntry,
} from "./types";
import {
  baseName,
  decreaseZoom,
  downloadBytes,
  downloadURL,
  ensureD2FileName,
  fileNameFromPath,
  getDiagramViewBox,
  increaseZoom,
  moveSelectionIndex,
  normalizeSvgSize,
} from "./utils";
import {
  activateWorkspace,
  addOrTouchWorkspace,
  loadWorkspaceActiveTabId,
  loadWorkspaceTabs,
  removeWorkspace,
  writeWorkspaceTabs,
} from "./features/workspaces/workspaces";
import { WorkspaceManager } from "./features/workspaces/WorkspaceManager";
import "./App.css";

type FocusedPane = "editor" | "preview";

type RenameNodeResult = {
  source: string;
  id: string;
};

type EditorCursorSnapshot = {
  viewState: Monaco.editor.ICodeEditorViewState | null;
  selections: Monaco.ISelection[] | null;
  position: Monaco.IPosition | null;
};

type CommandPaletteState = {
  query: string;
  selectedIndex: number;
};

type InternalSuggestCompletionItem = {
  completion: Monaco.languages.CompletionItem;
};

type InternalSuggestFocusEvent = {
  item?: InternalSuggestCompletionItem;
};

type InternalSuggestModelEvent = {
  completionModel?: {
    items?: InternalSuggestCompletionItem[];
  };
};

type InternalSuggestModel = {
  onDidSuggest?: (listener: (event: InternalSuggestModelEvent) => void) => Monaco.IDisposable;
};

type DetachedPreviewState = {
  objects: CompileResult["objects"];
  boards: NonNullable<CompileResult["boards"]>;
  selectedBoardPath: string[];
  renderedSvg: string;
  overlayViewBox: string;
  activeId: string | null;
  hoverId: string | null;
  fileName: string;
};

type SelectPreviewBoardEvent = string[];

type InternalSuggestWidget = {
  getFocusedItem?: () => InternalSuggestFocusEvent | undefined;
  onDidFocus?: (listener: (event: InternalSuggestFocusEvent) => void) => Monaco.IDisposable;
  onDidHide?: (listener: () => void) => Monaco.IDisposable;
};

type InternalSuggestController = {
  model?: InternalSuggestModel;
  widget?: {
    value?: InternalSuggestWidget;
  };
};

const nodeRenamePattern = /^[A-Za-z0-9_-]+$/;
const tabPersistenceDelayMs = 400;
const previewCompileDelayMs = 600;
const defaultPerfDebugOptions: PerfDebugOptions = {
  wordWrap: true,
  autoSuggest: true,
  suggestPreview: true,
  previewCompile: true,
  previewRender: true,
};

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textArea);
  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}

function lastD2IdSegment(id: string) {
  const parts = id.split(".");
  return parts[parts.length - 1] ?? id;
}

function boardPathKey(path: string[]) {
  return JSON.stringify(path);
}

function hasBoardPath(boards: CompileResult["boards"] | undefined, path: string[]) {
  const key = boardPathKey(path);
  return (boards ?? []).some((board) => boardPathKey(board.path) === key);
}

function compileResultKey(source: string, boardPath: string[]) {
  return `${boardPathKey(boardPath)}\n${source}`;
}

const emptyDetachedPreviewState: DetachedPreviewState = {
  objects: [],
  boards: [],
  selectedBoardPath: [],
  renderedSvg: "",
  overlayViewBox: "0 0 800 600",
  activeId: null,
  hoverId: null,
  fileName: "Preview",
};

function PreviewWindowApp() {
  const [previewState, setPreviewState] =
    useState<DetachedPreviewState>(emptyDetachedPreviewState);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewZoomMode, setPreviewZoomMode] = useState<PreviewZoomMode>("auto");

  useEffect(() => {
    let isMounted = true;
    let removeStateListener: (() => void) | null = null;
    void listen<DetachedPreviewState>("d2-desk-preview-state", (event) => {
      if (!isMounted) return;
      setPreviewState(event.payload);
      setActiveId(event.payload.activeId);
      setHoverId(event.payload.hoverId);
    }).then((unlisten) => {
      if (isMounted) {
        removeStateListener = unlisten;
        void emitTo("main", "d2-desk-preview-window-ready");
      } else {
        unlisten();
      }
    });

    return () => {
      isMounted = false;
      removeStateListener?.();
    };
  }, []);

  function zoomPreviewIn() {
    setPreviewZoomMode("manual");
    setPreviewZoom(increaseZoom);
  }

  function resetPreviewZoom() {
    setPreviewZoomMode("auto");
    setPreviewZoom(1);
  }

  function zoomPreviewOut() {
    setPreviewZoomMode("manual");
    setPreviewZoom(decreaseZoom);
  }

  const selectDetachedPreviewBoard = useCallback((boardPath: string[]) => {
    setPreviewZoomMode("auto");
    void emitTo("main", "d2-desk-select-preview-board", boardPath);
  }, []);

  return (
    <main className="app-shell detached-preview-shell">
      <PreviewPane
        objects={previewState.objects}
        boards={previewState.boards}
        selectedBoardPath={previewState.selectedBoardPath}
        renderedSvg={previewState.renderedSvg}
        overlayViewBox={previewState.overlayViewBox}
        zoom={previewZoom}
        zoomMode={previewZoomMode}
        activeId={activeId}
        hoverId={hoverId}
        onHover={setHoverId}
        onSelect={setActiveId}
        onZoomOut={zoomPreviewOut}
        onResetZoom={resetPreviewZoom}
        onZoomIn={zoomPreviewIn}
        onZoomModeChange={setPreviewZoomMode}
        onAutoZoomChange={setPreviewZoom}
        onBoardPathChange={selectDetachedPreviewBoard}
      />
    </main>
  );
}

function MainApp() {
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
    boards: [],
    diagnostics: [],
  });
  const [suggestPreviewResult, setSuggestPreviewResult] = useState<CompileResult | null>(null);
  const [status, setStatus] = useState("Ready");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);
  const [renameFileDialog, setRenameFileDialog] = useState<RenameDialogState | null>(null);
  const [filePalette, setFilePalette] = useState<WorkspaceFilePaletteState | null>(null);
  const [symbolPalette, setSymbolPalette] = useState<SymbolPaletteState | null>(null);
  const [commandPalette, setCommandPalette] = useState<CommandPaletteState | null>(null);
  const [editorZoom, setEditorZoom] = useState(1);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewZoomMode, setPreviewZoomMode] = useState<PreviewZoomMode>("auto");
  const [previewViewMode, setPreviewViewMode] = useState<PreviewViewMode>("split");
  const [previewDetached, setPreviewDetached] = useState(false);
  const [bottomPanelVisible, setBottomPanelVisible] = useState(true);
  const [perfDebugOptions, setPerfDebugOptions] =
    useState<PerfDebugOptions>(defaultPerfDebugOptions);
  const [selectedBoardPath, setSelectedBoardPath] = useState<string[]>([]);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorationIds = useRef<string[]>([]);
  const activeCompileRequestId = useRef(0);
  const activeSuggestPreviewRequestId = useRef(0);
  const previousCompileTabIdRef = useRef(activeTabId);
  const previousCompileBoardPathKeyRef = useRef(boardPathKey(selectedBoardPath));
  const suggestPreviewTimeoutRef = useRef<number | null>(null);
  const suggestPreviewCacheRef = useRef(new Map<string, CompileResult>());
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameFileInputRef = useRef<HTMLInputElement | null>(null);
  const filePaletteInputRef = useRef<HTMLInputElement | null>(null);
  const symbolPaletteInputRef = useRef<HTMLInputElement | null>(null);
  const openSourceFileRef = useRef<() => void>(() => undefined);
  const openWorkspaceFilePaletteRef = useRef<() => void>(() => undefined);
  const openSymbolPaletteRef = useRef<() => void>(() => undefined);
  const openCommandPaletteRef = useRef<() => void>(() => undefined);
  const saveSourceRef = useRef<() => void>(() => undefined);
  const formatDocumentRef = useRef<() => void>(() => undefined);
  const togglePreviewViewModeRef = useRef<() => void>(() => undefined);
  const detachPreviewRef = useRef<() => void>(() => undefined);
  const toggleBottomPanelRef = useRef<() => void>(() => undefined);
  const closeActiveTabRef = useRef<() => void>(() => undefined);
  const quitApplicationRef = useRef<() => void>(() => undefined);
  const pendingEditorViewStateRestoreRef = useRef<number | null>(null);
  const tabPersistenceTimeoutRef = useRef<number | null>(null);
  const renameEditorCursorSnapshotRef = useRef<EditorCursorSnapshot | null>(null);
  const workspaceStateRef = useRef(workspaceState);
  const activeWorkspaceIdRef = useRef(workspaceState.activeWorkspaceId);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const editorTabIdRef = useRef(activeTabId);
  const focusedPaneRef = useRef<FocusedPane>("editor");
  const closeTabInFlightRef = useRef(false);
  const quitInFlightRef = useRef(false);
  const suppressPreviewWindowClosedRef = useRef(false);
  const activeIdRef = useRef(activeId);
  const hoverIdRef = useRef(hoverId);
  const compileResultRef = useRef(compileResult);
  const compileResultSourceRef = useRef<string | null>(null);
  const selectedBoardPathRef = useRef(selectedBoardPath);
  const detachedPreviewStateRef = useRef<DetachedPreviewState>(emptyDetachedPreviewState);
  const perfDebugOptionsRef = useRef(perfDebugOptions);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );
  const source = activeTab?.source ?? "";
  const fileName = activeTab?.fileName ?? "untitled.d2";
  const currentFilePath = tabAbsolutePath(activeTab);
  const selectedBoardPathKey = useMemo(() => boardPathKey(selectedBoardPath), [selectedBoardPath]);
  const latestCompileInputsRef = useRef({ tabId: activeTabId, source });
  latestCompileInputsRef.current = { tabId: activeTabId, source };
  const visibleCompileResult = suggestPreviewResult ?? compileResult;
  const filteredWorkspaceFiles = useMemo(
    () => (filePalette ? filterWorkspaceFiles(filePalette.files, filePalette.query) : []),
    [filePalette],
  );
  const fileSymbols = useMemo(
    () => buildD2SymbolEntries(compileResult.objects),
    [compileResult.objects],
  );
  const filteredFileSymbols = useMemo(
    () => (symbolPalette ? filterD2Symbols(fileSymbols, symbolPalette.query) : []),
    [fileSymbols, symbolPalette],
  );

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
  const detachedPreviewState = useMemo<DetachedPreviewState>(
    () => ({
      objects: visibleCompileResult.objects,
      boards: visibleCompileResult.boards ?? [],
      selectedBoardPath,
      renderedSvg,
      overlayViewBox,
      activeId,
      hoverId,
      fileName,
    }),
    [
      activeId,
      fileName,
      hoverId,
      overlayViewBox,
      renderedSvg,
      selectedBoardPath,
      visibleCompileResult.boards,
      visibleCompileResult.objects,
    ],
  );

  useEffect(() => {
    detachedPreviewStateRef.current = detachedPreviewState;
  }, [detachedPreviewState]);

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

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      const pane = paneFromTarget(event.target);
      if (pane) {
        focusedPaneRef.current = pane;
      }
    };

    window.addEventListener("focusin", handleFocusIn);
    return () => window.removeEventListener("focusin", handleFocusIn);
  }, []);

  const setPerfDebugOption = useCallback((key: keyof PerfDebugOptions, enabled: boolean) => {
    setPerfDebugOptions((current) =>
      current[key] === enabled ? current : { ...current, [key]: enabled },
    );
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    hoverIdRef.current = hoverId;
  }, [hoverId]);

  useEffect(() => {
    compileResultRef.current = compileResult;
  }, [compileResult]);

  useEffect(() => {
    selectedBoardPathRef.current = selectedBoardPath;
  }, [selectedBoardPath]);

  function invalidateCursorLookup() {
    compileResultSourceRef.current = null;
  }

  useEffect(() => {
    if (selectedBoardPath.length === 0) return;
    if (compileResult.boards && hasBoardPath(compileResult.boards, selectedBoardPath)) return;
    setSelectedBoardPath([]);
    invalidateCursorLookup();
    setActiveId(null);
    setHoverId(null);
  }, [compileResult.boards, selectedBoardPath]);

  useEffect(() => {
    setD2ImportCompletionContextProvider(() => {
      const workspaceId = activeWorkspaceIdRef.current;
      const workspace = workspaceId
        ? workspaceStateRef.current.workspaces.find((item) => item.id === workspaceId)
        : null;
      const activeTabForCompletion =
        tabsRef.current.find((tab) => tab.id === activeTabIdRef.current) ?? null;

      return {
        workspaceRootPath: workspace?.rootPath ?? null,
        currentFilePath: activeTabForCompletion?.filePath ?? null,
        openTabs: tabsRef.current.map((tab) => ({
          filePath: tab.filePath,
          source: tab.source,
        })),
      };
    });

    return () => {
      setD2ImportCompletionContextProvider(null);
    };
  }, []);

  useEffect(() => {
    if (!renameDialog) return;
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renameDialog?.id]);

  useEffect(() => {
    if (!renameFileDialog) return;
    window.requestAnimationFrame(() => {
      renameFileInputRef.current?.focus();
      renameFileInputRef.current?.select();
    });
  }, [renameFileDialog?.id]);

  useEffect(() => {
    if (!filePalette) return;
    window.requestAnimationFrame(() => {
      filePaletteInputRef.current?.focus();
      filePaletteInputRef.current?.select();
    });
  }, [filePalette !== null]);

  useEffect(() => {
    if (!symbolPalette) return;
    window.requestAnimationFrame(() => {
      symbolPaletteInputRef.current?.focus();
      symbolPaletteInputRef.current?.select();
    });
  }, [symbolPalette !== null]);

  useEffect(() => {
    if (!symbolPalette) return;

    const handleSymbolPaletteKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === "Process") {
        return;
      }
      const shouldMoveDown =
        event.key === "ArrowDown" ||
        (event.key.toLowerCase() === "n" &&
          event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey);
      const shouldMoveUp =
        event.key === "ArrowUp" ||
        (event.key.toLowerCase() === "p" &&
          event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSymbolPalette(null);
        setStatus("Symbol search canceled");
        window.requestAnimationFrame(() => editorRef.current?.focus());
        return;
      }
      if (shouldMoveDown || shouldMoveUp) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSymbolPalette((current) =>
          current
            ? {
                ...current,
                selectedIndex: moveSelectionIndex(
                  current.selectedIndex,
                  shouldMoveDown ? 1 : -1,
                  filteredFileSymbols.length,
                ),
              }
            : current,
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const selectedSymbol =
          filteredFileSymbols[
            Math.min(symbolPalette.selectedIndex, filteredFileSymbols.length - 1)
          ];
        if (selectedSymbol) {
          setSymbolPalette(null);
          setActiveId(selectedSymbol.id);
          highlightObject(selectedSymbol.id, true);
          setStatus(`Focused ${selectedSymbol.id}`);
        }
      }
    };

    window.addEventListener("keydown", handleSymbolPaletteKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleSymbolPaletteKeyDown, { capture: true });
  }, [filteredFileSymbols, symbolPalette]);

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

  const focusEditorAfterTabActivation = useCallback(() => {
    window.requestAnimationFrame(() => {
      editorRef.current?.focus();
      window.setTimeout(() => editorRef.current?.focus(), 0);
    });
  }, []);

  const activateTab = useCallback(
    (tabId: string) => {
      const currentTabs = persistActiveEditorViewState();
      if (!currentTabs.some((tab) => tab.id === tabId)) return;

      activeTabIdRef.current = tabId;
      setActiveTabId(tabId);
      setActiveId(null);
      setHoverId(null);
      persistTabs(currentTabs, tabId);
      focusEditorAfterTabActivation();
    },
    [focusEditorAfterTabActivation, persistActiveEditorViewState, persistTabs],
  );

  const focusAdjacentTab = useCallback(
    (direction: -1 | 1) => {
      const currentTabs = persistActiveEditorViewState();
      if (currentTabs.length <= 1) return;

      const activeIndex = currentTabs.findIndex((tab) => tab.id === activeTabIdRef.current);
      if (activeIndex === -1) return;

      const nextIndex = (activeIndex + direction + currentTabs.length) % currentTabs.length;
      const nextTab = currentTabs[nextIndex];
      activateTab(nextTab.id);
      setStatus(`Focused ${nextTab.fileName}`);
    },
    [activateTab, persistActiveEditorViewState],
  );

  const moveTab = useCallback(
    (draggedTabId: string, targetTabId: string, position: TabDropPosition) => {
      const currentTabs = persistActiveEditorViewState();
      const nextTabs = reorderTabs(currentTabs, draggedTabId, targetTabId, position);
      if (nextTabs === currentTabs) return;

      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      persistTabs(nextTabs, activeTabIdRef.current);

      const movedTab = nextTabs.find((tab) => tab.id === draggedTabId);
      if (movedTab) {
        setStatus(`Moved ${movedTab.fileName}`);
      }
    },
    [persistActiveEditorViewState, persistTabs],
  );

  const updateActiveTab = useCallback((updates: Partial<D2Tab>) => {
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
      return nextTabs;
    });
  }, []);

  const restoreEditorViewStateAfterSourceUpdate = useCallback(
    (snapshot: EditorCursorSnapshot | null, expectedSource: string) => {
      if (!snapshot) {
        window.requestAnimationFrame(() => editorRef.current?.focus());
        return;
      }

      if (pendingEditorViewStateRestoreRef.current !== null) {
        window.cancelAnimationFrame(pendingEditorViewStateRestoreRef.current);
      }

      let attempts = 0;
      const restore = () => {
        const editor = editorRef.current;
        if (!editor) return;

        attempts += 1;
        if (editor.getValue() !== expectedSource && attempts < 5) {
          pendingEditorViewStateRestoreRef.current = window.requestAnimationFrame(restore);
          return;
        }

        pendingEditorViewStateRestoreRef.current = null;
        if (snapshot.viewState) {
          editor.restoreViewState(snapshot.viewState);
        }
        if (snapshot.selections?.length) {
          editor.setSelections(snapshot.selections, "restore-rename-cursor");
        } else if (snapshot.position) {
          editor.setPosition(snapshot.position, "restore-rename-cursor");
        }
        editor.focus();
      };

      pendingEditorViewStateRestoreRef.current = window.requestAnimationFrame(restore);
    },
    [],
  );

  const createNewTab = useCallback(() => {
    const nextTab = createEmptyTab(tabsRef.current);
    const nextTabs = [...tabsRef.current, nextTab];
    tabsRef.current = nextTabs;
    activeTabIdRef.current = nextTab.id;
    setTabs(nextTabs);
    setActiveTabId(nextTab.id);
    persistTabs(nextTabs, nextTab.id);
    setActiveId(null);
    setHoverId(null);
    setStatus(`Created ${nextTab.fileName}`);
  }, [persistTabs]);

  const openFileInNewTab = useCallback(
    (file: OpenedD2File) => {
      const currentTabs = persistActiveEditorViewState();
      const existingTab = currentTabs.find((tab) => tab.filePath === file.path);
      if (existingTab) {
        activeTabIdRef.current = existingTab.id;
        setActiveTabId(existingTab.id);
        setActiveId(null);
        setHoverId(null);
        persistTabs(currentTabs, existingTab.id);
        setStatus(`Opened ${file.path}`);
        return;
      }

      const nextTab = {
        ...createTab(fileNameFromPath(file.path), file.contents),
        filePath: file.path,
        editorViewState: null,
      };
      const nextTabs = [...currentTabs, nextTab];
      tabsRef.current = nextTabs;
      activeTabIdRef.current = nextTab.id;
      editorTabIdRef.current = nextTab.id;
      setTabs(nextTabs);
      setActiveTabId(nextTab.id);
      persistTabs(nextTabs, nextTab.id);
      setActiveId(null);
      setHoverId(null);
      setStatus(`Opened ${file.path}`);
    },
    [persistActiveEditorViewState, persistTabs],
  );

  const clearSuggestPreview = useCallback(() => {
    activeSuggestPreviewRequestId.current += 1;
    if (suggestPreviewTimeoutRef.current !== null) {
      window.clearTimeout(suggestPreviewTimeoutRef.current);
      suggestPreviewTimeoutRef.current = null;
    }
    setSuggestPreviewResult(null);
  }, []);

  useEffect(() => {
    perfDebugOptionsRef.current = perfDebugOptions;
    if (!perfDebugOptions.suggestPreview) {
      clearSuggestPreview();
    }
    if (!perfDebugOptions.previewCompile) {
      activeCompileRequestId.current += 1;
    }
  }, [clearSuggestPreview, perfDebugOptions]);

  const selectPreviewBoard = useCallback(
    (boardPath: string[]) => {
      clearSuggestPreview();
      invalidateCursorLookup();
      setActiveId(null);
      setHoverId(null);
      setSelectedBoardPath(boardPath);
      setPreviewZoomMode("auto");
      setStatus(boardPath.length === 0 ? "Previewing root board" : `Previewing ${boardPath.join(".")}`);
    },
    [clearSuggestPreview],
  );

  function sidecarSourceParams(nextSource: string) {
    const workspaceId = activeWorkspaceIdRef.current;
    const workspace = workspaceId
      ? workspaceStateRef.current.workspaces.find((item) => item.id === workspaceId)
      : null;
    const activeTabForCompile =
      tabsRef.current.find((tab) => tab.id === activeTabIdRef.current) ?? null;

    return {
      source: nextSource,
      workspaceRootPath: workspace?.rootPath ?? "",
      currentFilePath: activeTabForCompile?.filePath ?? "",
      boardPath: selectedBoardPathRef.current,
      openFiles: tabsRef.current
        .filter((tab) => tab.filePath)
        .map((tab) => ({
          path: tab.filePath!,
          source: tab.id === activeTabIdRef.current ? nextSource : tab.source,
        })),
    };
  }

  const scheduleSuggestPreview = useCallback(
    (previewSource: string, modelVersionId: number, delayMs = 100) => {
      if (!perfDebugOptionsRef.current.suggestPreview) {
        clearSuggestPreview();
        return;
      }

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
      const previewParams = sidecarSourceParams(previewSource);
      const cacheKey = suggestPreviewCacheKey(previewParams);
      const cachedResult = suggestPreviewCacheRef.current.get(cacheKey);
      if (cachedResult) {
        rememberSuggestPreview(suggestPreviewCacheRef.current, cacheKey, cachedResult);
        setSuggestPreviewResult(cachedResult);
        return;
      }
      suggestPreviewTimeoutRef.current = window.setTimeout(() => {
        suggestPreviewTimeoutRef.current = null;
        void (async () => {
          try {
            const result = await invoke<CompileResult>("sidecar_call", {
              method: "compile",
              params: previewParams,
            });
            const currentInputs = latestCompileInputsRef.current;
            const currentModelVersionId = editorRef.current?.getModel()?.getVersionId() ?? null;
            if (
              requestId !== activeSuggestPreviewRequestId.current ||
              tabId !== currentInputs.tabId ||
              modelVersionId !== currentModelVersionId
            ) {
              return;
            }
            if (result.diagnostics.length > 0) {
              return;
            }
            rememberSuggestPreview(suggestPreviewCacheRef.current, cacheKey, result);
            setSuggestPreviewResult(result);
          } catch {
            // Keep the current valid preview when a transient candidate cannot compile.
          }
        })();
      }, delayMs);
    },
    [clearSuggestPreview],
  );

  async function compileCurrentSourceForLookup(currentSource: string) {
    const currentCompileResultKey = compileResultKey(currentSource, selectedBoardPathRef.current);
    if (compileResultSourceRef.current === currentCompileResultKey) {
      return compileResultRef.current;
    }

    const result = await invoke<CompileResult>("sidecar_call", {
      method: "compile",
      params: sidecarSourceParams(currentSource),
    });
    if (result.diagnostics.length > 0) {
      return null;
    }

    compileResultRef.current = result;
    compileResultSourceRef.current = currentCompileResultKey;
    setCompileResult(result);
    return result;
  }

  const isEditingIconValueCompletion = useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const position = editor?.getPosition();
    if (!model || !position) return false;

    const lineContent = model.getLineContent(position.lineNumber);
    return (
      !isD2LineCommentPosition(lineContent, position.column) &&
      isD2IconValueCompletionPosition(lineContent, position.column)
    );
  }, []);

  const compile = useCallback(
    async (nextSource: string, tabId: string, requestId: number) => {
      try {
        const result = await invoke<CompileResult>("sidecar_call", {
          method: "compile",
          params: sidecarSourceParams(nextSource),
        });
        const latestInputs = latestCompileInputsRef.current;
        if (
          requestId !== activeCompileRequestId.current ||
          tabId !== latestInputs.tabId ||
          nextSource !== latestInputs.source
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
        compileResultSourceRef.current = compileResultKey(nextSource, selectedBoardPathRef.current);
        setCompileResult(result);
        setStatus("Compiled");
      } catch (error) {
        const latestInputs = latestCompileInputsRef.current;
        if (
          requestId !== activeCompileRequestId.current ||
          tabId !== latestInputs.tabId ||
          nextSource !== latestInputs.source
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
    [],
  );

  useEffect(() => {
    if (tabPersistenceTimeoutRef.current !== null) {
      window.clearTimeout(tabPersistenceTimeoutRef.current);
    }

    tabPersistenceTimeoutRef.current = window.setTimeout(() => {
      tabPersistenceTimeoutRef.current = null;
      persistTabs(tabsRef.current, activeTabIdRef.current);
    }, tabPersistenceDelayMs);
  }, [activeTabId, persistTabs, tabs]);

  useEffect(() => {
    return () => {
      if (tabPersistenceTimeoutRef.current !== null) {
        window.clearTimeout(tabPersistenceTimeoutRef.current);
        tabPersistenceTimeoutRef.current = null;
        persistTabs(tabsRef.current, activeTabIdRef.current);
      }
    };
  }, [persistTabs]);

  useEffect(() => {
    localStorage.setItem("d2-desk:last-source", source);
    if (!isEditingIconValueCompletion()) {
      clearSuggestPreview();
    }
    if (!perfDebugOptions.previewCompile) {
      activeCompileRequestId.current += 1;
      return;
    }
    const requestId = activeCompileRequestId.current + 1;
    activeCompileRequestId.current = requestId;
    const shouldCompileImmediately =
      previousCompileTabIdRef.current !== activeTabId ||
      previousCompileBoardPathKeyRef.current !== selectedBoardPathKey;
    previousCompileTabIdRef.current = activeTabId;
    previousCompileBoardPathKeyRef.current = selectedBoardPathKey;
    if (shouldCompileImmediately) {
      setStatus("Compiling");
      void compile(source, activeTabId, requestId);
      return;
    }
    const timeout = window.setTimeout(() => {
      setStatus("Compiling");
      void compile(source, activeTabId, requestId);
    }, previewCompileDelayMs);
    return () => window.clearTimeout(timeout);
  }, [
    activeTabId,
    clearSuggestPreview,
    compile,
    isEditingIconValueCompletion,
    perfDebugOptions.previewCompile,
    selectedBoardPathKey,
    source,
  ]);

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

  useEffect(() => {
    if (!symbolPalette) return;
    const selectedSymbol =
      filteredFileSymbols[
        Math.min(symbolPalette.selectedIndex, filteredFileSymbols.length - 1)
      ];
    const selectedId = selectedSymbol?.id ?? null;
    setActiveId((currentActiveId) => (currentActiveId === selectedId ? currentActiveId : selectedId));
    highlightObject(selectedId, Boolean(selectedSymbol), false);
  }, [filteredFileSymbols, symbolPalette]);

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

  const openWorkspaceFilePalette = useCallback(async () => {
    const workspaceId = activeWorkspaceIdRef.current;
    const workspace = workspaceId
      ? workspaceStateRef.current.workspaces.find((item) => item.id === workspaceId)
      : null;
    if (!workspace) {
      setStatus("Open a workspace folder first");
      return;
    }

    setSymbolPalette(null);
    setCommandPalette(null);
    setFilePalette({
      query: "",
      files: [],
      selectedIndex: 0,
      loading: true,
      error: null,
    });
    setStatus(`Indexing ${workspace.name}`);

    try {
      const files = await invoke<WorkspaceFileEntry[]>("list_workspace_files", {
        rootPath: workspace.rootPath,
      });
      setFilePalette((current) =>
        current
          ? {
              ...current,
              files,
              selectedIndex: 0,
              loading: false,
              error: null,
            }
          : current,
      );
      setStatus(`Indexed ${files.length} files in ${workspace.name}`);
    } catch (error) {
      setFilePalette((current) =>
        current
          ? {
              ...current,
              loading: false,
              error: String(error),
            }
          : current,
      );
      setStatus(String(error));
    }
  }, []);

  const openWorkspaceFile = useCallback(
    async (file: WorkspaceFileEntry) => {
      try {
        const result = await invoke<OpenedD2File>("read_d2_file", { path: file.path });
        openFileInNewTab(result);
        setFilePalette(null);
        window.requestAnimationFrame(() => editorRef.current?.focus());
      } catch (error) {
        setFilePalette((current) =>
          current
            ? {
                ...current,
                error: String(error),
              }
            : current,
        );
        setStatus(String(error));
      }
    },
    [openFileInNewTab],
  );

  const openSymbolPalette = useCallback(() => {
    setCommandPalette(null);
    setFilePalette(null);
    setSymbolPalette({
      query: "",
      selectedIndex: 0,
    });
  }, []);

  const openCommandPalette = useCallback(() => {
    setFilePalette(null);
    setSymbolPalette(null);
    setCommandPalette({
      query: "",
      selectedIndex: 0,
    });
  }, []);

  const closeCommandPalette = useCallback(() => {
    setCommandPalette(null);
    setStatus("Command palette canceled");
    window.requestAnimationFrame(() => editorRef.current?.focus());
  }, []);

  const toggleBottomPanel = useCallback(() => {
    setBottomPanelVisible((visible) => {
      setStatus(visible ? "Bottom panel hidden" : "Bottom panel shown");
      return !visible;
    });
  }, []);

  const focusPreviewViewMode = useCallback((mode: PreviewViewMode) => {
    window.requestAnimationFrame(() => {
      if (mode === "preview-only") {
        document.querySelector<HTMLElement>(".preview-viewport")?.focus();
      } else {
        editorRef.current?.focus();
      }
    });
  }, []);

  const togglePreviewViewMode = useCallback(async () => {
    const next = nextPreviewViewMode(previewViewMode);
    try {
      if (previewDetached && next !== "editor-only") {
        suppressPreviewWindowClosedRef.current = true;
        await invoke("close_preview_window");
        setPreviewDetached(false);
      }
      setPreviewViewMode(next);
      setStatus(previewViewModeStatus(next));
      focusPreviewViewMode(next);
    } catch (error) {
      suppressPreviewWindowClosedRef.current = false;
      setStatus(String(error));
    }
  }, [focusPreviewViewMode, previewDetached, previewViewMode]);

  const sendDetachedPreviewState = useCallback(() => {
    void emitTo("preview", "d2-desk-preview-state", detachedPreviewStateRef.current);
  }, []);

  const toggleDetachedPreview = useCallback(async () => {
    try {
      if (previewDetached) {
        suppressPreviewWindowClosedRef.current = true;
        await invoke("close_preview_window");
        setPreviewDetached(false);
        setPreviewViewMode("split");
        setStatus("Preview attached to main window");
        window.requestAnimationFrame(() => editorRef.current?.focus());
        return;
      }

      setPreviewViewMode("editor-only");
      setPreviewDetached(true);
      suppressPreviewWindowClosedRef.current = false;
      await invoke("open_preview_window");
      sendDetachedPreviewState();
      setStatus("Preview detached to separate window");
      window.requestAnimationFrame(() => editorRef.current?.focus());
    } catch (error) {
      suppressPreviewWindowClosedRef.current = false;
      setPreviewDetached(false);
      setPreviewViewMode("split");
      setStatus(String(error));
    }
  }, [previewDetached, sendDetachedPreviewState]);

  const goToSymbol = useCallback((symbolId: string) => {
    setSymbolPalette(null);
    setActiveId(symbolId);
    highlightObject(symbolId, true);
    setStatus(`Focused ${symbolId}`);
  }, []);

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

  const renameFocusedFile = useCallback(() => {
    if (!currentFilePath) {
      setStatus("Save the file before renaming");
      return;
    }

    setCommandPalette(null);
    setFilePalette(null);
    setSymbolPalette(null);
    setRenameDialog(null);
    setRenameFileDialog({ id: currentFilePath, value: fileName, error: null });
    setStatus(`Renaming ${fileName}`);
  }, [currentFilePath, fileName]);

  const copyFocusedTabAbsolutePath = useCallback(async () => {
    if (!currentFilePath) {
      setStatus("Save the file before copying path");
      return;
    }

    try {
      await copyTextToClipboard(currentFilePath);
      setStatus(`Copied absolute path: ${currentFilePath}`);
    } catch (error) {
      setStatus(String(error));
    }
  }, [currentFilePath]);

  const commitRenameFile = useCallback(async () => {
    if (!renameFileDialog || !currentFilePath) return;

    const nextFileName = renameFileDialog.value.trim();
    if (nextFileName === fileName) {
      setStatus("Rename unchanged");
      setRenameFileDialog(null);
      window.requestAnimationFrame(() => editorRef.current?.focus());
      return;
    }

    try {
      const workspaceId = activeWorkspaceIdRef.current;
      const workspace = workspaceId
        ? workspaceStateRef.current.workspaces.find((item) => item.id === workspaceId)
        : null;
      const result = await invoke<RenamedD2File>("rename_d2_file", {
        path: currentFilePath,
        fileName: nextFileName,
        workspaceRootPath: workspace?.rootPath ?? null,
        openFiles: tabsRef.current
          .filter((tab) => tab.filePath)
          .map((tab) => ({
            path: tab.filePath!,
            source: tab.source,
            hasUserChanges: tab.hasUserChanges,
          })),
      });
      const updatedReferencesByPath = new Map(
        result.updatedReferences.map((update) => [update.path, update]),
      );
      setTabs((currentTabs) => {
        const nextTabs = currentTabs.map((tab) => {
          const nextPath = tab.filePath === currentFilePath ? result.path : tab.filePath;
          const referenceUpdate = nextPath ? updatedReferencesByPath.get(nextPath) : undefined;
          const nextTab = {
            ...tab,
            filePath: nextPath,
            fileName: nextPath === result.path ? fileNameFromPath(result.path) : tab.fileName,
          };
          if (referenceUpdate) {
            nextTab.source = referenceUpdate.contents;
            if (referenceUpdate.saved) {
              nextTab.savedSource = referenceUpdate.contents;
            }
            nextTab.hasUserChanges = nextTab.source !== nextTab.savedSource;
          }
          return nextTab;
        });
        tabsRef.current = nextTabs;
        return nextTabs;
      });
      setRenameFileDialog(null);
      const updatedCount = result.updatedReferences.length;
      setStatus(
        updatedCount === 0
          ? `Renamed ${fileName} to ${fileNameFromPath(result.path)}`
          : `Renamed ${fileName} to ${fileNameFromPath(result.path)}; updated ${updatedCount} import reference file${updatedCount === 1 ? "" : "s"}`,
      );
      window.requestAnimationFrame(() => editorRef.current?.focus());
    } catch (error) {
      setRenameFileDialog((current) =>
        current ? { ...current, error: String(error).replace(/^Error: /, "") } : current,
      );
    }
  }, [currentFilePath, fileName, renameFileDialog]);

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
    const editorPosition = editor?.getPosition() ?? null;
    const shouldPreferEditorCursor = editor?.hasTextFocus() ?? false;
    let targetId = shouldPreferEditorCursor ? null : activeIdRef.current;

    if (!targetId && editorPosition) {
      try {
        const result = await invoke<{ id?: string }>("sidecar_call", {
          method: "nodeAt",
          params: {
            source: currentSource,
            line: editorPosition.lineNumber,
            column: editorPosition.column,
          },
        });
        targetId = result.id ?? null;
      } catch {
        targetId = null;
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

    renameEditorCursorSnapshotRef.current = editor
      ? {
          viewState: editor.saveViewState(),
          selections: editor.getSelections(),
          position: editor.getPosition(),
        }
      : null;
    const currentName = lastD2IdSegment(targetId);
    setRenameDialog({ id: targetId, value: currentName, error: null });
    setStatus(`Renaming ${targetId}`);
  }, []);

  const switchFocusedEdgeDirection = useCallback(async () => {
    const editor = editorRef.current;
    const currentSource = editor?.getValue() ?? latestCompileInputsRef.current.source;
    const currentCompileResult = await compileCurrentSourceForLookup(currentSource);
    if (!currentCompileResult) {
      setStatus("Switch Edge requires a valid diagram");
      window.requestAnimationFrame(() => editorRef.current?.focus());
      return;
    }
    const editorPosition = editor?.getPosition() ?? null;
    const shouldPreferEditorCursor = editor?.hasTextFocus() ?? false;
    const hoveredOrActiveId = hoverIdRef.current ?? activeIdRef.current;
    const hoveredOrActiveObject =
      currentCompileResult.objects.find((object) => object.id === hoveredOrActiveId) ?? null;
    let targetId =
      !shouldPreferEditorCursor && hoveredOrActiveObject?.kind === "connection"
        ? hoveredOrActiveObject.id
        : null;

    const cursorId = editorPosition
      ? (connectionIdAtPosition(
          currentCompileResult.objects,
          editorPosition.lineNumber,
          editorPosition.column,
        ) ?? (await connectionIdAtCurrentPosition(currentSource, editorPosition)))
      : null;
    if (!targetId) {
      targetId = cursorId;
    }

    const selectedObject = findSwitchableEdge(currentCompileResult.objects, targetId, cursorId);
    if (!selectedObject) {
      setStatus("Select an edge to switch");
      window.requestAnimationFrame(() => editorRef.current?.focus());
      return;
    }

    const editorCursorSnapshot = editor
      ? {
          viewState: editor.saveViewState(),
          selections: editor.getSelections(),
          position: editor.getPosition(),
        }
      : null;
    const result = switchEdgeDirectionInSource(currentSource, selectedObject);
    if (!result.ok) {
      setStatus(result.reason);
      window.requestAnimationFrame(() => editorRef.current?.focus());
      return;
    }

    const nextActiveId = await objectIdAtCurrentPosition(result.source, result.cursorPosition);
    const nextEditorCursorSnapshot = editorCursorSnapshot
      ? {
          ...editorCursorSnapshot,
          selections: null,
          position: result.cursorPosition,
        }
      : null;
    updateActiveTab({ source: result.source, editorViewState: nextEditorCursorSnapshot?.viewState });
    activeIdRef.current = nextActiveId ?? selectedObject.id;
    setActiveId(activeIdRef.current);
    setHoverId(null);
    hoverIdRef.current = null;
    setStatus(`Switched ${activeIdRef.current}`);
    restoreEditorViewStateAfterSourceUpdate(nextEditorCursorSnapshot, result.source);
  }, [restoreEditorViewStateAfterSourceUpdate, updateActiveTab]);

  const commitRenameNode = useCallback(async () => {
    if (!renameDialog) return;

    const targetId = renameDialog.id;
    const currentName = lastD2IdSegment(targetId);
    const newName = renameDialog.value.trim();
    const editorCursorSnapshot =
      renameEditorCursorSnapshotRef.current ??
      (editorRef.current
        ? {
            viewState: editorRef.current.saveViewState(),
            selections: editorRef.current.getSelections(),
            position: editorRef.current.getPosition(),
          }
        : null);
    if (newName === currentName) {
      setStatus("Rename unchanged");
      setRenameDialog(null);
      renameEditorCursorSnapshotRef.current = null;
      restoreEditorViewStateAfterSourceUpdate(
        editorCursorSnapshot,
        latestCompileInputsRef.current.source,
      );
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
      updateActiveTab({ source: result.source, editorViewState: editorCursorSnapshot?.viewState });
      setActiveId(result.id);
      activeIdRef.current = result.id;
      setHoverId(null);
      setRenameDialog(null);
      renameEditorCursorSnapshotRef.current = null;
      setStatus(`Renamed ${targetId} to ${result.id}`);
      restoreEditorViewStateAfterSourceUpdate(editorCursorSnapshot, result.source);
    } catch (error) {
      setRenameDialog((current) =>
        current ? { ...current, error: String(error).replace(/^Error: /, "") } : current,
      );
    }
  }, [renameDialog, restoreEditorViewStateAfterSourceUpdate, updateActiveTab]);

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
    openWorkspaceFilePaletteRef.current = () => {
      void openWorkspaceFilePalette();
    };
    openSymbolPaletteRef.current = openSymbolPalette;
    openCommandPaletteRef.current = openCommandPalette;
    saveSourceRef.current = () => {
      void saveSource();
    };
    formatDocumentRef.current = () => {
      void formatDocument();
    };
    togglePreviewViewModeRef.current = () => {
      void togglePreviewViewMode();
    };
    detachPreviewRef.current = () => {
      void toggleDetachedPreview();
    };
    toggleBottomPanelRef.current = toggleBottomPanel;
    closeActiveTabRef.current = closeActiveTab;
    quitApplicationRef.current = () => {
      void quitApplication();
    };
  }, [
    closeActiveTab,
    formatDocument,
    openCommandPalette,
    openSymbolPalette,
    openSourceFile,
    openWorkspaceFilePalette,
    quitApplication,
    saveSource,
    toggleBottomPanel,
    toggleDetachedPreview,
    togglePreviewViewMode,
  ]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    void listen("d2-desk-open", () => openSourceFileRef.current()).then((unlisten) => {
      unlisteners.push(unlisten);
    });
    void listen("d2-desk-open-workspace-file", () =>
      openWorkspaceFilePaletteRef.current(),
    ).then((unlisten) => {
      unlisteners.push(unlisten);
    });
    void listen("d2-desk-open-symbols", () => openSymbolPaletteRef.current()).then((unlisten) => {
      unlisteners.push(unlisten);
    });
    void listen("d2-desk-open-command-palette", () => openCommandPaletteRef.current()).then(
      (unlisten) => {
        unlisteners.push(unlisten);
      },
    );
    void listen("d2-desk-toggle-preview-fullscreen", () =>
      togglePreviewViewModeRef.current(),
    ).then((unlisten) => {
      unlisteners.push(unlisten);
    });
    void listen("d2-desk-toggle-detached-preview", () => detachPreviewRef.current()).then(
      (unlisten) => {
        unlisteners.push(unlisten);
      },
    );
    void listen("d2-desk-toggle-bottom-panel", () => toggleBottomPanelRef.current()).then(
      (unlisten) => {
        unlisteners.push(unlisten);
      },
    );
    void listen("d2-desk-preview-window-ready", () => sendDetachedPreviewState()).then(
      (unlisten) => {
        unlisteners.push(unlisten);
      },
    );
    void listen("d2-desk-preview-window-closed", () => {
      if (suppressPreviewWindowClosedRef.current) {
        suppressPreviewWindowClosedRef.current = false;
        return;
      }
      setPreviewDetached(false);
      setPreviewViewMode("editor-only");
      setStatus("Editor only shown");
      window.requestAnimationFrame(() => editorRef.current?.focus());
    }).then((unlisten) => {
      unlisteners.push(unlisten);
    });
    void listen<SelectPreviewBoardEvent>("d2-desk-select-preview-board", (event) => {
      selectPreviewBoard(event.payload);
    }).then((unlisten) => {
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
  }, [selectPreviewBoard, sendDetachedPreviewState]);

  useEffect(() => {
    if (!previewDetached || !perfDebugOptions.previewRender) return;
    sendDetachedPreviewState();
  }, [
    detachedPreviewState,
    perfDebugOptions.previewRender,
    previewDetached,
    sendDetachedPreviewState,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F2" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        void renameFocusedNode();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.altKey && event.shiftKey) {
        if (event.key.toLowerCase() === "p" || event.code === "KeyP") {
          event.preventDefault();
          event.stopImmediatePropagation();
          void toggleDetachedPreview();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey) {
        if (
          event.metaKey &&
          !event.ctrlKey &&
          (event.key.toLowerCase() === "p" || event.code === "KeyP")
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void togglePreviewViewMode();
        } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopImmediatePropagation();
          focusAdjacentTab(event.key === "ArrowRight" ? 1 : -1);
        }
        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();

      if (key === "o" && event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openSymbolPalette();
      } else if (key === "p" && event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openCommandPalette();
      } else if (key === "o") {
        event.preventDefault();
        void openSourceFile();
      } else if (key === "p" && event.metaKey && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void openWorkspaceFilePalette();
      } else if (key === "s") {
        event.preventDefault();
        void saveSource();
      } else if (!event.shiftKey && key === "j") {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleBottomPanel();
      } else if (event.shiftKey && key === "i") {
        event.preventDefault();
        event.stopImmediatePropagation();
        void formatDocument();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomFocusedPaneIn();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomFocusedPaneOut();
      } else if (event.key === "0") {
        event.preventDefault();
        resetFocusedView();
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
    focusAdjacentTab,
    formatDocument,
    openCommandPalette,
    openSymbolPalette,
    openSourceFile,
    openWorkspaceFilePalette,
    quitApplication,
    renameFocusedNode,
    resetFocusedView,
    saveSource,
    toggleBottomPanel,
    toggleDetachedPreview,
    togglePreviewViewMode,
    zoomFocusedPaneIn,
    zoomFocusedPaneOut,
  ]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editorTabIdRef.current = activeTab?.id ?? activeTabIdRef.current;
    editor.onDidFocusEditorWidget(() => {
      focusedPaneRef.current = "editor";
    });
    let isAutoClosingD2Brace = false;
    const savedViewState = activeTab?.editorViewState;
    if (savedViewState) {
      window.requestAnimationFrame(() => {
        try {
          editor.restoreViewState(savedViewState);
        } catch {
          updateActiveTab({ editorViewState: null });
        }
        if (editorRef.current === editor) {
          editor.focus();
        }
      });
    } else {
      window.requestAnimationFrame(() => {
        if (editorRef.current === editor) {
          editor.focus();
        }
      });
    }
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO, () => {
      openSourceFileRef.current();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO, () => {
      openSymbolPaletteRef.current();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => {
      openCommandPaletteRef.current();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveSourceRef.current();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyJ, () => {
      toggleBottomPanelRef.current();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI, () => {
      formatDocumentRef.current();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.LeftArrow, () => {
      focusAdjacentTab(-1);
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.RightArrow, () => {
      focusAdjacentTab(1);
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyP, () => {
      togglePreviewViewModeRef.current();
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
    const previewFocusedSuggestItem = (item?: InternalSuggestCompletionItem) => {
      if (!perfDebugOptionsRef.current.suggestPreview) {
        clearSuggestPreview();
        return;
      }

      const model = editor.getModel();
      const completion = item?.completion;
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
    };
    const previewCurrentFocusedSuggestItem = (fallbackItem?: InternalSuggestCompletionItem) => {
      const focusedItem = suggestWidget?.getFocusedItem?.()?.item;
      previewFocusedSuggestItem(focusedItem ?? fallbackItem);
    };
    const queuePreviewCurrentFocusedSuggestItem = (fallbackItem?: InternalSuggestCompletionItem) => {
      for (const delay of [0, 50, 150]) {
        window.setTimeout(() => {
          previewCurrentFocusedSuggestItem(fallbackItem);
        }, delay);
      }
    };
    const previewCurrentIconValueSuggestion = (preferredLabel?: string) => {
      if (!perfDebugOptionsRef.current.suggestPreview) {
        clearSuggestPreview();
        return;
      }

      const model = editor.getModel();
      const position = editor.getPosition();
      if (!model || !position) return;

      const lineContent = model.getLineContent(position.lineNumber);
      if (
        isD2LineCommentPosition(lineContent, position.column) ||
        !isD2IconValueCompletionPosition(lineContent, position.column)
      ) {
        return;
      }

      const completionContext = getD2CompletionContext(lineContent, position.column);
      if (!completionContext || completionContext.kind !== "value") return;

      const modelVersionId = model.getVersionId();
      const lineSuffix = lineContent.slice(position.column - 1);
      const remainingText = lineSuffix.match(/^[\w-]*/)?.[0] ?? "";
      const replacementRange = {
        startLineNumber: position.lineNumber,
        startColumn: position.column - completionContext.typedText.length,
        endLineNumber: position.lineNumber,
        endColumn: position.column + remainingText.length,
      };

      void (async () => {
        let completions: D2CompletionItem[] = [];
        try {
          completions = await invoke<D2CompletionItem[]>("sidecar_call", {
            method: "complete",
            params: {
              source: model.getValue(),
              line: position.lineNumber - 1,
              column: position.column - 1,
            },
          });
        } catch {
          return;
        }

        if (model.getVersionId() !== modelVersionId) return;
        const completion = preferredLabel
          ? pickD2IconCompletionByLabel(completions, preferredLabel.toLowerCase())
          : pickD2IconCompletion(completions, completionContext.typedText);
        if (!completion?.insertText) {
          clearSuggestPreview();
          return;
        }

        scheduleSuggestPreview(
          previewSourceWithInsertText(model, replacementRange, completion.insertText),
          modelVersionId,
          20,
        );
      })();
    };
    const queuePreviewCurrentIconValueSuggestion = () => {
      for (const delay of [0, 80, 180]) {
        window.setTimeout(previewCurrentIconValueSuggestion, delay);
      }
    };
    if (suggestWidget?.onDidFocus) {
      suggestPreviewDisposables.push(
        suggestWidget.onDidFocus((event) => {
          const focusedLabel = event.item?.completion
            ? monacoCompletionLabelText(event.item.completion)
            : null;
          if (focusedLabel && isEditingIconValueCompletion()) {
            previewCurrentIconValueSuggestion(focusedLabel);
            return;
          }
          previewFocusedSuggestItem(event.item);
        }),
      );
    }
    if (suggestController?.model?.onDidSuggest) {
      suggestPreviewDisposables.push(
        suggestController.model.onDidSuggest((event) => {
          queuePreviewCurrentFocusedSuggestItem(event.completionModel?.items?.[0]);
          queuePreviewCurrentIconValueSuggestion();
        }),
      );
    }
    suggestPreviewDisposables.push(
      editor.onDidChangeModelContent(() => {
        if (!perfDebugOptionsRef.current.suggestPreview) {
          clearSuggestPreview();
          return;
        }
        if (suggestWidget?.getFocusedItem) {
          queuePreviewCurrentFocusedSuggestItem();
        }
        queuePreviewCurrentIconValueSuggestion();
      }),
    );
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

      if (!perfDebugOptionsRef.current.autoSuggest) return;

      const lineContent = model.getLineContent(currentPosition.lineNumber);
      if (isD2LineCommentPosition(lineContent, currentPosition.column)) return;

      const completionContext = getD2CompletionContext(lineContent, currentPosition.column);
      if (!completionContext) return;

      const shouldTriggerD2Suggest = event.changes.some(
        (change) =>
          change.text === ":" ||
          change.text === " " ||
          change.text === "." ||
          change.text === "@" ||
          change.text === "/" ||
          /^[\w-]$/.test(change.text),
      );
      if (shouldTriggerD2Suggest) {
        const triggerSource =
          completionContext.kind === "key" ? "d2-key-completion" : "d2-value-completion";
        window.setTimeout(() => {
          editor.trigger(triggerSource, "editor.action.triggerSuggest", {});
        }, 0);
      }
    });
  };

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

  async function connectionIdAtCurrentPosition(source: string, position: Monaco.IPosition) {
    const targetId = await objectIdAtCurrentPosition(source, position);
    const targetObject =
      compileResultRef.current.objects.find((object) => object.id === targetId) ?? null;
    return targetObject?.kind === "connection" ? targetObject.id : null;
  }

  function highlightObject(id: string | null, reveal: boolean, focusEditor = true) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return false;
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
      if (focusEditor) {
        editor.focus();
      }
      return true;
    }
    return false;
  }

  async function exportSVG() {
    try {
      const result = await invoke<ExportResult>("sidecar_call", {
        method: "export",
        params: { ...sidecarSourceParams(source), format: "svg" },
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

  function paneFromTarget(target: EventTarget | null): FocusedPane | null {
    return target instanceof HTMLElement && target.closest(".preview-pane")
      ? "preview"
      : target instanceof HTMLElement && target.closest(".editor-pane")
        ? "editor"
        : null;
  }

  function focusedPane() {
    const focusedTargetPane = paneFromTarget(document.activeElement);
    if (focusedTargetPane) return focusedTargetPane;
    if (editorRef.current?.hasTextFocus()) return "editor";
    return focusedPaneRef.current;
  }

  function resetFocusedView() {
    if (focusedPane() === "preview") {
      setPreviewZoomMode("auto");
      return;
    }

    setEditorZoom(1);
  }

  function zoomFocusedPaneIn() {
    if (focusedPane() === "preview") {
      zoomPreviewIn();
      return;
    }

    zoomEditorIn();
  }

  function zoomFocusedPaneOut() {
    if (focusedPane() === "preview") {
      zoomPreviewOut();
      return;
    }

    zoomEditorOut();
  }

  function resetEditorZoom() {
    setEditorZoom(1);
  }

  function zoomEditorIn() {
    setEditorZoom(increaseZoom);
  }

  function zoomEditorOut() {
    setEditorZoom(decreaseZoom);
  }

  function resetPreviewZoom() {
    setPreviewZoomMode("auto");
  }

  function zoomPreviewIn() {
    setPreviewZoomMode("manual");
    setPreviewZoom(increaseZoom);
  }

  function zoomPreviewOut() {
    setPreviewZoomMode("manual");
    setPreviewZoom(decreaseZoom);
  }

  const paletteCommands = useMemo<AppCommand[]>(
    () => [
      {
        id: "workspace.openFolder",
        title: "Open Workspace Folder",
        category: "Workspace",
        keywords: ["folder", "directory", "project"],
        run: () => {
          void openWorkspaceFolder();
        },
      },
      {
        id: "workspace.manage",
        title: "Manage Workspaces",
        category: "Workspace",
        keywords: ["settings", "folders", "projects"],
        run: () => setWorkspaceManagerOpen(true),
      },
      {
        id: "file.openWorkspaceFile",
        title: "Open Workspace File",
        category: "File",
        keywords: ["workspace", "project", "quick open", "finder"],
        shortcut: "Command + P",
        run: () => {
          void openWorkspaceFilePalette();
        },
      },
      {
        id: "file.open",
        title: "Open D2 File",
        category: "File",
        keywords: ["load"],
        shortcut: "Command/Ctrl + O",
        run: openSourceFile,
      },
      {
        id: "file.newTab",
        title: "New Tab",
        category: "File",
        keywords: ["create", "blank"],
        shortcut: "Command/Ctrl + T",
        run: createNewTab,
      },
      {
        id: "file.save",
        title: "Save D2 Source",
        category: "File",
        keywords: ["write"],
        shortcut: "Command/Ctrl + S",
        run: saveSource,
      },
      {
        id: "file.openWithEditor",
        title: "Open Current D2 File with $EDITOR",
        category: "File",
        keywords: ["external", "editor"],
        run: openWithEditor,
      },
      {
        id: "file.renameFocused",
        title: "Rename Focused File",
        category: "File",
        keywords: ["current", "active", "tab", "filename"],
        enabled: Boolean(currentFilePath),
        run: renameFocusedFile,
      },
      {
        id: "file.copyFocusedAbsolutePath",
        title: "Copy Absolute Path",
        category: "File",
        keywords: ["current", "active", "tab", "filepath", "path", "clipboard"],
        enabled: Boolean(currentFilePath),
        run: () => {
          void copyFocusedTabAbsolutePath();
        },
      },
      {
        id: "file.closeTab",
        title: "Close Tab",
        category: "File",
        keywords: ["current", "active"],
        shortcut: "Command/Ctrl + W",
        run: closeActiveTab,
      },
      {
        id: "file.quit",
        title: "Quit D2 Desk",
        category: "File",
        keywords: ["exit", "close application"],
        shortcut: "Command/Ctrl + Q",
        run: () => {
          void quitApplication();
        },
      },
      {
        id: "editor.format",
        title: "Format Document",
        category: "Edit",
        keywords: ["source"],
        shortcut: "Command/Ctrl + Shift + I",
        run: formatDocument,
      },
      {
        id: "editor.goToSymbol",
        title: "Go to Symbol in File",
        category: "Edit",
        keywords: ["outline", "node", "jump", "navigate"],
        shortcut: "Command/Ctrl + Shift + O",
        run: openSymbolPalette,
      },
      {
        id: "editor.renameFocusedNode",
        title: "Rename Focused Node",
        category: "Edit",
        keywords: ["symbol", "node", "refactor"],
        shortcut: "F2",
        run: () => {
          void renameFocusedNode();
        },
      },
      {
        id: "editor.switchEdgeDirection",
        title: "Switch Edge Notation",
        category: "Edit",
        keywords: ["edge", "notation", "direction", "flip", "reverse", "connection"],
        run: () => {
          void switchFocusedEdgeDirection();
        },
      },
      {
        id: "view.openCommandPalette",
        title: "Command Palette",
        category: "View",
        keywords: ["commands", "actions"],
        shortcut: "Command/Ctrl + Shift + P",
        run: openCommandPalette,
      },
      {
        id: "view.togglePreviewViewMode",
        title: "Toggle Preview View",
        category: "View",
        keywords: ["layout", "fullscreen", "focus", "hide editor", "preview only", "editor only"],
        shortcut: "Command + Option + P",
        run: togglePreviewViewMode,
      },
      {
        id: "view.toggleDetachedPreview",
        title: previewDetached ? "Attach Preview to Main Window" : "Detach Preview to Window",
        category: "View",
        keywords: ["preview", "detach", "separate", "window", "attach"],
        shortcut: "Command + Option + Shift + P",
        run: toggleDetachedPreview,
      },
      {
        id: "view.toggleBottomPanel",
        title: bottomPanelVisible ? "Hide Bottom Panel" : "Show Bottom Panel",
        category: "View",
        keywords: ["bottom", "panel", "status", "diagnostics", "debug"],
        shortcut: "Command/Ctrl + J",
        run: toggleBottomPanel,
      },
      {
        id: "view.zoomOut",
        title: "Zoom Out",
        category: "View",
        keywords: ["decrease", "scale"],
        shortcut: "Command/Ctrl + -",
        run: zoomFocusedPaneOut,
      },
      {
        id: "view.resetZoom",
        title: "Reset Zoom",
        category: "View",
        keywords: ["scale", "fit"],
        shortcut: "Command/Ctrl + 0",
        run: resetFocusedView,
      },
      {
        id: "view.zoomIn",
        title: "Zoom In",
        category: "View",
        keywords: ["increase", "scale"],
        shortcut: "Command/Ctrl + +",
        run: zoomFocusedPaneIn,
      },
      {
        id: "export.svg",
        title: "Export SVG",
        category: "Export",
        keywords: ["download", "diagram"],
        run: () => {
          void exportSVG();
        },
      },
      {
        id: "export.png",
        title: "Export PNG",
        category: "Export",
        keywords: ["download", "image", "diagram"],
        run: () => {
          void exportPNG();
        },
      },
    ],
    [
      bottomPanelVisible,
      closeActiveTab,
      copyFocusedTabAbsolutePath,
      createNewTab,
      currentFilePath,
      exportRenderedSvg,
      fileName,
      formatDocument,
      openCommandPalette,
      openSourceFile,
      openSymbolPalette,
      openWithEditor,
      openWorkspaceFilePalette,
      openWorkspaceFolder,
      previewDetached,
      quitApplication,
      renameFocusedNode,
      renameFocusedFile,
      saveSource,
      source,
      switchFocusedEdgeDirection,
      toggleBottomPanel,
      toggleDetachedPreview,
      togglePreviewViewMode,
    ],
  );
  const runAppCommand = useCallback((command: AppCommand) => {
    if (!isCommandEnabled(command)) return;
    setCommandPalette(null);
    void command.run();
  }, []);

  const setAutoPreviewZoom = useCallback((zoom: number) => {
    setPreviewZoom((currentZoom) => (currentZoom === zoom ? currentZoom : zoom));
  }, []);

  const mainPreviewVisible =
    perfDebugOptions.previewRender && !previewDetached && previewViewMode !== "editor-only";
  const workspaceClassName = !mainPreviewVisible
    ? "workspace preview-detached"
    : previewViewMode === "preview-only"
      ? "workspace preview-fullscreen"
      : "workspace";

  return (
    <main className={bottomPanelVisible ? "app-shell" : "app-shell bottom-panel-hidden"}>
      <Toolbar
        workspaces={workspaceState.workspaces}
        activeWorkspaceId={workspaceState.activeWorkspaceId}
        onWorkspaceChange={(workspaceId) => {
          void switchWorkspace(workspaceId);
        }}
      />

      {commandPalette ? (
        <CommandPalette
          commands={paletteCommands}
          query={commandPalette.query}
          selectedIndex={commandPalette.selectedIndex}
          onQueryChange={(query) =>
            setCommandPalette((current) => (current ? { ...current, query } : current))
          }
          onSelectedIndexChange={(selectedIndex) =>
            setCommandPalette((current) => (current ? { ...current, selectedIndex } : current))
          }
          onClose={closeCommandPalette}
          onRunCommand={runAppCommand}
        />
      ) : null}

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
        <RenameNodeDialog
          state={renameDialog}
          inputRef={renameInputRef}
          onSubmit={() => {
            void commitRenameNode();
          }}
          onCancel={() => {
            setRenameDialog(null);
            renameEditorCursorSnapshotRef.current = null;
            setStatus("Rename canceled");
            window.requestAnimationFrame(() => editorRef.current?.focus());
          }}
          onValueChange={(value) =>
            setRenameDialog((current) =>
              current ? { ...current, value, error: null } : current,
            )
          }
        />
      ) : null}

      {renameFileDialog ? (
        <RenameNodeDialog
          state={renameFileDialog}
          inputRef={renameFileInputRef}
          title="Rename file"
          inputLabel="File name"
          onSubmit={() => {
            void commitRenameFile();
          }}
          onCancel={() => {
            setRenameFileDialog(null);
            setStatus("Rename file canceled");
            window.requestAnimationFrame(() => editorRef.current?.focus());
          }}
          onValueChange={(value) =>
            setRenameFileDialog((current) =>
              current ? { ...current, value, error: null } : current,
            )
          }
        />
      ) : null}

      {filePalette ? (
        <WorkspaceFilePalette
          state={filePalette}
          filteredFiles={filteredWorkspaceFiles}
          inputRef={filePaletteInputRef}
          onCancel={() => {
            setFilePalette(null);
            setStatus("Open workspace file canceled");
            window.requestAnimationFrame(() => editorRef.current?.focus());
          }}
          onQueryChange={(query) =>
            setFilePalette((current) =>
              current
                ? {
                    ...current,
                    query,
                    selectedIndex: 0,
                  }
                : current,
            )
          }
          onSelectedIndexChange={(selectedIndex) =>
            setFilePalette((current) => (current ? { ...current, selectedIndex } : current))
          }
          onOpenFile={(file) => {
            void openWorkspaceFile(file);
          }}
        />
      ) : null}

      {symbolPalette ? (
        <SymbolPalette
          state={symbolPalette}
          symbols={fileSymbols}
          filteredSymbols={filteredFileSymbols}
          inputRef={symbolPaletteInputRef}
          onCancel={() => {
            setSymbolPalette(null);
            setStatus("Symbol search canceled");
            window.requestAnimationFrame(() => editorRef.current?.focus());
          }}
          onQueryChange={(query) =>
            setSymbolPalette((current) =>
              current
                ? {
                    ...current,
                    query,
                    selectedIndex: 0,
                  }
                : current,
            )
          }
          onSelectedIndexChange={(selectedIndex) =>
            setSymbolPalette((current) => (current ? { ...current, selectedIndex } : current))
          }
          onGoToSymbol={goToSymbol}
        />
      ) : null}

      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivateTab={activateTab}
        onCloseTab={(tabId) => {
          void closeTab(tabId);
        }}
        onCreateTab={createNewTab}
        onReorderTabs={moveTab}
      />

      <section className={workspaceClassName}>
        <EditorPane
          activeTabId={activeTabId}
          fileName={fileName}
          source={source}
          zoom={editorZoom}
          editorFontSize={editorFontSize}
          editorLineHeight={editorLineHeight}
          perfDebugOptions={perfDebugOptions}
          beforeMount={configureD2Language}
          onMount={handleMount}
          onChange={(value) => updateActiveTab({ source: value })}
          onZoomOut={zoomEditorOut}
          onResetZoom={resetEditorZoom}
          onZoomIn={zoomEditorIn}
        />

        {mainPreviewVisible ? (
          <PreviewPane
            objects={visibleCompileResult.objects}
            boards={compileResult.boards ?? []}
            selectedBoardPath={selectedBoardPath}
            renderedSvg={renderedSvg}
            overlayViewBox={overlayViewBox}
            zoom={previewZoom}
            zoomMode={previewZoomMode}
            activeId={activeId}
            hoverId={hoverId}
            onHover={(id) => {
              hoverIdRef.current = id;
              setHoverId(id);
            }}
            onSelect={(id) => {
              hoverIdRef.current = null;
              setHoverId(null);
              setActiveId(id);
              highlightObject(id, true);
            }}
            onZoomOut={zoomPreviewOut}
            onResetZoom={resetPreviewZoom}
            onZoomIn={zoomPreviewIn}
            onZoomModeChange={setPreviewZoomMode}
            onAutoZoomChange={setAutoPreviewZoom}
            onBoardPathChange={selectPreviewBoard}
          />
        ) : null}
      </section>

      {bottomPanelVisible ? (
        <BottomPanel
          status={status}
          activeObject={activeObject}
          diagnostics={compileResult.diagnostics}
          perfDebugOptions={perfDebugOptions}
          onPerfDebugOptionChange={setPerfDebugOption}
        />
      ) : null}
    </main>
  );
}

function App() {
  const [windowLabel] = useState(() => getCurrentWindow().label);
  return windowLabel === "preview" ? <PreviewWindowApp /> : <MainApp />;
}

export default App;
