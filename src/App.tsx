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
import { baseEditorFontSize, baseEditorLineHeight, zoomStep } from "./constants";
import {
  configureD2Language,
  getD2CompletionContext,
  isD2LineCommentPosition,
} from "./d2Language";
import {
  createEmptyTab,
  isTabUnsaved,
  loadActiveTabId,
  loadTabs,
  writeStoredTabs,
} from "./tabs";
import type { CompileResult, D2Tab, ExportResult, OpenedD2File, SavedD2File } from "./types";
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
import "./App.css";

function App() {
  const [tabs, setTabs] = useState<D2Tab[]>(() => loadTabs());
  const [activeTabId, setActiveTabId] = useState(() => loadActiveTabId(tabs));
  const [compileResult, setCompileResult] = useState<CompileResult>({
    svg: "",
    objects: [],
    diagnostics: [],
  });
  const [status, setStatus] = useState("Ready");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [theme, setTheme] = useState(4);
  const [layout, setLayout] = useState("dagre");
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorationIds = useRef<string[]>([]);
  const activeCompileRequestId = useRef(0);
  const openSourceFileRef = useRef<() => void>(() => undefined);
  const saveSourceRef = useRef<() => void>(() => undefined);
  const closeActiveTabRef = useRef<() => void>(() => undefined);
  const quitApplicationRef = useRef<() => void>(() => undefined);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const editorTabIdRef = useRef(activeTabId);
  const closeTabInFlightRef = useRef(false);
  const quitInFlightRef = useRef(false);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );
  const source = activeTab?.source ?? "";
  const fileName = activeTab?.fileName ?? "untitled.d2";
  const currentFilePath = activeTab?.filePath ?? null;
  const latestCompileInputsRef = useRef({ tabId: activeTabId, source, layout, theme });
  latestCompileInputsRef.current = { tabId: activeTabId, source, layout, theme };

  const activeObject = useMemo(
    () => compileResult.objects.find((object) => object.id === (hoverId ?? activeId)),
    [activeId, compileResult.objects, hoverId],
  );

  const renderedSvg = useMemo(() => normalizeSvgSize(compileResult.svg), [compileResult.svg]);

  const overlayViewBox = useMemo(() => getDiagramViewBox(renderedSvg), [renderedSvg]);

  const editorFontSize = Math.round(baseEditorFontSize * zoom);
  const editorLineHeight = Math.round(baseEditorLineHeight * zoom);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

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
    writeStoredTabs(nextTabs, tabId);
    return nextTabs;
  }, []);

  const activateTab = useCallback((tabId: string) => {
    activeTabIdRef.current = tabId;
    setActiveTabId(tabId);
    setActiveId(null);
    setHoverId(null);
  }, []);

  const updateActiveTab = useCallback((updates: Partial<D2Tab>) => {
    setTabs((currentTabs) => {
      const tabId = activeTabIdRef.current;
      const nextTabs = currentTabs.map((tab) => (tab.id === tabId ? { ...tab, ...updates } : tab));
      tabsRef.current = nextTabs;
      writeStoredTabs(nextTabs, tabId);
      return nextTabs;
    });
  }, []);

  const createNewTab = useCallback(() => {
    const nextTab = createEmptyTab(tabsRef.current);
    const nextTabs = [...tabsRef.current, nextTab];
    tabsRef.current = nextTabs;
    activeTabIdRef.current = nextTab.id;
    setTabs(nextTabs);
    setActiveTabId(nextTab.id);
    writeStoredTabs(nextTabs, nextTab.id);
    setActiveId(null);
    setHoverId(null);
    setStatus(`Created ${nextTab.fileName}`);
  }, []);

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
    writeStoredTabs(tabs, activeTabId);
  }, [activeTabId, tabs]);

  useEffect(() => {
    localStorage.setItem("d2-desk:last-source", source);
    const requestId = activeCompileRequestId.current + 1;
    activeCompileRequestId.current = requestId;
    setStatus("Compiling");
    const timeout = window.setTimeout(() => {
      void compile(source, activeTabId, requestId);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [activeTabId, compile, source]);

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
  }, [activeId, hoverId, compileResult.objects]);

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

      if (isTabUnsaved(targetTab)) {
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
      writeStoredTabs(nextTabs, activeTabIdRef.current);
      setStatus(`Closed ${targetTab.fileName}`);
    } finally {
      closeTabInFlightRef.current = false;
    }
  }, [persistActiveEditorViewState]);

  const closeActiveTab = useCallback(() => {
    void closeTab(activeTabId);
  }, [activeTabId, closeTab]);

  const quitApplication = useCallback(async () => {
    if (quitInFlightRef.current) return;
    quitInFlightRef.current = true;

    try {
      const currentTabs = persistActiveEditorViewState();
      const unsavedTabs = currentTabs.filter(isTabUnsaved);
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

  useEffect(() => {
    openSourceFileRef.current = () => {
      void openSourceFile();
    };
    saveSourceRef.current = () => {
      void saveSource();
    };
    closeActiveTabRef.current = closeActiveTab;
    quitApplicationRef.current = () => {
      void quitApplication();
    };
  }, [closeActiveTab, openSourceFile, quitApplication, saveSource]);

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
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();

      if (key === "o") {
        event.preventDefault();
        void openSourceFile();
      } else if (key === "s") {
        event.preventDefault();
        void saveSource();
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
  }, [closeActiveTab, createNewTab, openSourceFile, quitApplication, saveSource]);

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
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyD,
      () => {
        editor.trigger("keyboard", "editor.action.copyLinesDownAction", null);
      },
    );
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
    editor.onDidChangeCursorPosition(async (event) => {
      await updateFocusedObjectFromPosition(editor, event.position);
    });
  };

  async function updateFocusedObjectFromPosition(
    editor: Monaco.editor.IStandaloneCodeEditor,
    position: Monaco.IPosition,
  ) {
    try {
      const result = await invoke<{ id?: string }>("sidecar_call", {
        method: "nodeAt",
        params: {
          source: editor.getValue(),
          line: position.lineNumber,
          column: position.column,
        },
      });
      setActiveId(result.id ?? null);
    } catch {
      setActiveId(null);
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

  async function formatDocument() {
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
    const svgBlob = new Blob([renderedSvg], { type: "image/svg+xml" });
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
    setZoom(1);
  }

  function zoomIn() {
    setZoom((value) => clampZoom(value + zoomStep));
  }

  function zoomOut() {
    setZoom((value) => clampZoom(value - zoomStep));
  }

  return (
    <main className="app-shell">
      <Toolbar
        theme={theme}
        layout={layout}
        onThemeChange={setTheme}
        onLayoutChange={setLayout}
        onOpen={openSourceFile}
        onSave={saveSource}
        onFormat={formatDocument}
        onZoomOut={zoomOut}
        onResetView={resetView}
        onZoomIn={zoomIn}
        onExportSvg={exportSVG}
        onExportPng={exportPNG}
      />

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
          editorFontSize={editorFontSize}
          editorLineHeight={editorLineHeight}
          beforeMount={configureD2Language}
          onMount={handleMount}
          onChange={(value) => updateActiveTab({ source: value })}
        />

        <PreviewPane
          objects={compileResult.objects}
          renderedSvg={renderedSvg}
          overlayViewBox={overlayViewBox}
          zoom={zoom}
          activeId={activeId}
          hoverId={hoverId}
          onHover={setHoverId}
          onSelect={(id) => {
            setActiveId(id);
            highlightObject(id, true);
          }}
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
