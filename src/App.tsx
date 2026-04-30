import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import {
  Download,
  FileDown,
  FileInput,
  FileText,
  Focus,
  Maximize2,
  Plus,
  Save,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import "./App.css";

type SourceRange = {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

type D2Object = {
  id: string;
  kind: "shape" | "connection";
  label?: string;
  sourceRanges: SourceRange[];
  preview: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    route?: { x: number; y: number }[];
  };
};

type Diagnostic = {
  message: string;
  severity: "error" | "warning" | "info";
  sourceRange: SourceRange;
};

type CompileResult = {
  svg: string;
  objects: D2Object[];
  diagnostics: Diagnostic[];
};

type ExportResult = {
  format: string;
  data: string;
};

type D2Tab = {
  id: string;
  fileName: string;
  source: string;
};

type StoredTabs = {
  activeTabId: string;
  tabs: D2Tab[];
};

const sampleSource = `direction: right

user: User {
  shape: person
}

api: API Server {
  shape: hexagon
}

db: Database {
  shape: cylinder
}

queue: Queue {
  shape: queue
}

user -> api: request
api -> db: query
api -> queue: enqueue
queue -> db: persist`;

const themes = [
  { id: 4, label: "Grape" },
  { id: 0, label: "Neutral" },
  { id: 100, label: "Terminal" },
  { id: 101, label: "Origami" },
];

const baseEditorFontSize = 14;
const baseEditorLineHeight = 20;
const minZoom = 0.4;
const maxZoom = 2.2;
const zoomStep = 0.1;
const tabsStorageKey = "d2-desk:tabs";

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );
  const source = activeTab?.source ?? "";
  const fileName = activeTab?.fileName ?? "untitled.d2";

  const activeObject = useMemo(
    () => compileResult.objects.find((object) => object.id === (hoverId ?? activeId)),
    [activeId, compileResult.objects, hoverId],
  );

  const renderedSvg = useMemo(() => normalizeSvgSize(compileResult.svg), [compileResult.svg]);

  const overlayViewBox = useMemo(() => getDiagramViewBox(renderedSvg), [renderedSvg]);

  const editorFontSize = Math.round(baseEditorFontSize * zoom);
  const editorLineHeight = Math.round(baseEditorLineHeight * zoom);

  const updateActiveTab = useCallback((updates: Partial<D2Tab>) => {
    setTabs((currentTabs) =>
      currentTabs.map((tab) => (tab.id === activeTabId ? { ...tab, ...updates } : tab)),
    );
  }, [activeTabId]);

  const createNewTab = useCallback(() => {
    const nextTab = createEmptyTab(tabs);
    setTabs((currentTabs) => [...currentTabs, nextTab]);
    setActiveTabId(nextTab.id);
    setActiveId(null);
    setHoverId(null);
    setStatus(`Created ${nextTab.fileName}`);
  }, [tabs]);

  const compile = useCallback(
    async (nextSource: string) => {
      setStatus("Compiling");
      try {
        const result = await invoke<CompileResult>("sidecar_call", {
          method: "compile",
          params: { source: nextSource, layout, theme },
        });
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
    localStorage.setItem(tabsStorageKey, JSON.stringify({ activeTabId, tabs }));
  }, [activeTabId, tabs]);

  useEffect(() => {
    localStorage.setItem("d2-desk:last-source", source);
    const timeout = window.setTimeout(() => {
      void compile(source);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [compile, source]);

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;

      if (event.key === "+" || event.key === "=") {
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
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [createNewTab]);

  const beforeMount = (monaco: typeof Monaco) => {
    monaco.languages.register({ id: "d2" });
    monaco.languages.setMonarchTokensProvider("d2", {
      tokenizer: {
        root: [
          [/#.*$/, "comment"],
          [/".*?"/, "string"],
          [/'.*?'/, "string"],
          [/(->|--)/, "keyword"],
          [/\b(direction|shape|style|fill|stroke|icon|label|tooltip|near)\b/, "type"],
          [/[{}:]/, "delimiter"],
        ],
      },
    });
    monaco.editor.defineTheme("d2-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "", foreground: "d4d4d4" },
        { token: "comment", foreground: "6a9955" },
        { token: "keyword", foreground: "4fc1ff" },
        { token: "type", foreground: "4ec9b0" },
        { token: "string", foreground: "ce9178" },
        { token: "delimiter", foreground: "d4d4d4" },
      ],
      colors: {
        "editor.background": "#1e1e1e",
        "editor.foreground": "#d4d4d4",
        "editorLineNumber.foreground": "#858585",
        "editorCursor.foreground": "#f8fafc",
      },
    });
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.onDidChangeCursorPosition(async (event) => {
      try {
        const result = await invoke<{ id?: string }>("sidecar_call", {
          method: "nodeAt",
          params: {
            source: editor.getValue(),
            line: event.position.lineNumber,
            column: event.position.column,
          },
        });
        setActiveId(result.id ?? null);
      } catch {
        setActiveId(null);
      }
    });
  };

  function highlightObject(id: string | null, reveal: boolean) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const object = compileResult.objects.find((item) => item.id === id);
    const decorations =
      object?.sourceRanges.map((range) => ({
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
    if (reveal && object?.sourceRanges[0]) {
      editor.revealLineInCenter(object.sourceRanges[0].startLine);
      editor.setPosition({
        lineNumber: object.sourceRanges[0].startLine,
        column: object.sourceRanges[0].startColumn,
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

  function printPDF() {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<html><head><title>${baseName(fileName)}</title></head><body>${renderedSvg}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  function openFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      updateActiveTab({ source: String(reader.result ?? ""), fileName: file.name });
      setStatus(`Opened ${file.name}`);
    };
    reader.readAsText(file);
  }

  function saveSource() {
    const blob = new Blob([source], { type: "text/plain;charset=utf-8" });
    downloadURL(fileName.endsWith(".d2") ? fileName : `${fileName}.d2`, URL.createObjectURL(blob));
    setStatus("Saved D2 source");
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
      <header className="topbar">
        <div className="brand">
          <FileText size={20} />
          <span>D2 Desk</span>
        </div>
        <div className="toolbar" role="toolbar">
          <button title="Open D2 file" onClick={() => fileInputRef.current?.click()}>
            <FileInput size={16} />
          </button>
          <button title="Save D2 source" onClick={saveSource}>
            <Save size={16} />
          </button>
          <button title="Format document" onClick={formatDocument}>
            <Wand2 size={16} />
          </button>
          <button title="New tab (Command/Ctrl + T)" onClick={createNewTab}>
            <Plus size={16} />
          </button>
          <span className="divider" />
          <select value={theme} onChange={(event) => setTheme(Number(event.target.value))}>
            {themes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <select value={layout} onChange={(event) => setLayout(event.target.value)}>
            <option value="dagre">dagre</option>
          </select>
          <span className="divider" />
          <button title="Zoom out (Command/Ctrl + -)" onClick={zoomOut}>
            <ZoomOut size={16} />
          </button>
          <button title="Reset zoom (Command/Ctrl + 0)" onClick={resetView}>
            <Focus size={16} />
          </button>
          <button title="Zoom in (Command/Ctrl + +)" onClick={zoomIn}>
            <ZoomIn size={16} />
          </button>
          <span className="divider" />
          <button title="Export SVG" onClick={exportSVG}>
            <Download size={16} />
          </button>
          <button title="Export PNG" onClick={exportPNG}>
            <FileDown size={16} />
          </button>
          <button title="Print or save as PDF" onClick={printPDF}>
            <Maximize2 size={16} />
          </button>
        </div>
        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          accept=".d2,text/plain"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) openFile(file);
            event.currentTarget.value = "";
          }}
        />
      </header>

      <nav className="tabbar" aria-label="Open D2 files">
        <div className="tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={tab.id === activeTabId ? "tab active" : "tab"}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              title={tab.fileName}
              onClick={() => {
                setActiveTabId(tab.id);
                setActiveId(null);
                setHoverId(null);
              }}
            >
              <FileText size={14} />
              <span>{tab.fileName}</span>
            </button>
          ))}
        </div>
        <button className="tab-add" title="New tab (Command/Ctrl + T)" onClick={createNewTab}>
          <Plus size={16} />
        </button>
      </nav>

      <section className="workspace">
        <section className="editor-pane">
          <div className="pane-title">
            <span>{fileName}</span>
            <span>{source.split("\n").length} lines</span>
          </div>
          <Editor
            key={activeTabId}
            height="100%"
            language="d2"
            theme="d2-dark"
            value={source}
            beforeMount={beforeMount}
            onMount={handleMount}
            onChange={(value) => updateActiveTab({ source: value ?? "" })}
            options={{
              fontSize: editorFontSize,
              lineHeight: editorLineHeight,
              fontLigatures: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
              automaticLayout: true,
            }}
          />
        </section>

        <section className="preview-pane">
          <div className="pane-title">
            <span>Preview</span>
            <span>{Math.round(zoom * 100)}%</span>
          </div>
          <div className="preview-viewport">
            <div className="preview-canvas" style={{ transform: `scale(${zoom})` }}>
              <div className="svg-output" dangerouslySetInnerHTML={{ __html: renderedSvg }} />
              <svg className="overlay" viewBox={overlayViewBox}>
                {compileResult.objects.map((object) =>
                  object.kind === "shape" ? (
                    <rect
                      key={object.id}
                      className={overlayClass(object.id)}
                      x={object.preview.x}
                      y={object.preview.y}
                      width={object.preview.width}
                      height={object.preview.height}
                      rx={8}
                      onMouseEnter={() => setHoverId(object.id)}
                      onMouseLeave={() => setHoverId(null)}
                      onClick={() => {
                        setActiveId(object.id);
                        highlightObject(object.id, true);
                      }}
                    />
                  ) : (
                    <path
                      key={object.id}
                      className={overlayClass(object.id)}
                      d={routePath(object.preview.route ?? [])}
                      onMouseEnter={() => setHoverId(object.id)}
                      onMouseLeave={() => setHoverId(null)}
                      onClick={() => {
                        setActiveId(object.id);
                        highlightObject(object.id, true);
                      }}
                    />
                  ),
                )}
              </svg>
            </div>
          </div>
        </section>
      </section>

      <footer className="bottom-panel">
        <div>
          <strong>{status}</strong>
          {activeObject ? <span className="object-chip">{activeObject.kind}: {activeObject.id}</span> : null}
        </div>
        <div className="diagnostics">
          {compileResult.diagnostics.length === 0
            ? "No diagnostics"
            : compileResult.diagnostics.map((diagnostic) => diagnostic.message).join(" | ")}
        </div>
      </footer>
    </main>
  );

  function overlayClass(id: string) {
    return id === (hoverId ?? activeId) ? "hit-target active" : "hit-target";
  }
}

function routePath(route: { x: number; y: number }[]) {
  if (route.length === 0) return "";
  return route.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

function clampZoom(value: number) {
  return Number(Math.min(maxZoom, Math.max(minZoom, value)).toFixed(2));
}

function loadTabs(): D2Tab[] {
  const fallbackTab = createTab("untitled.d2", localStorage.getItem("d2-desk:last-source") ?? sampleSource);
  const stored = localStorage.getItem(tabsStorageKey);
  if (!stored) return [fallbackTab];

  try {
    const parsed = JSON.parse(stored) as Partial<StoredTabs>;
    const storedTabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
    const tabs = storedTabs
      .filter(
        (tab): tab is D2Tab =>
          typeof tab.id === "string" &&
          typeof tab.fileName === "string" &&
          typeof tab.source === "string",
      )
      .map((tab) => ({
        id: tab.id,
        fileName: tab.fileName,
        source: tab.source,
      }));
    return tabs.length > 0 ? tabs : [fallbackTab];
  } catch {
    return [fallbackTab];
  }
}

function loadActiveTabId(tabs: D2Tab[]) {
  const fallbackId = tabs[0]?.id ?? createTabId();
  const stored = localStorage.getItem(tabsStorageKey);
  if (!stored) return fallbackId;

  try {
    const parsed = JSON.parse(stored) as Partial<StoredTabs>;
    return tabs.some((tab) => tab.id === parsed.activeTabId) ? parsed.activeTabId : fallbackId;
  } catch {
    return fallbackId;
  }
}

function createEmptyTab(existingTabs: D2Tab[]) {
  const usedNames = new Set(existingTabs.map((tab) => tab.fileName));
  let index = existingTabs.length + 1;
  let fileName = `untitled-${index}.d2`;
  while (usedNames.has(fileName)) {
    index += 1;
    fileName = `untitled-${index}.d2`;
  }
  return createTab(fileName, "");
}

function createTab(fileName: string, source: string): D2Tab {
  return {
    id: createTabId(),
    fileName,
    source,
  };
}

function createTabId() {
  return globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeSvgSize(svg: string) {
  if (!svg || /<svg[^>]*\swidth=/.test(svg)) return svg;
  const match = svg.match(/<svg([^>]*)viewBox="([^"]+)"([^>]*)>/);
  if (!match) return svg;
  const [, before, viewBox, after] = match;
  const parts = viewBox.split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return svg;
  const [, , width, height] = parts;
  return svg.replace(
    match[0],
    `<svg${before}viewBox="${viewBox}" width="${Math.ceil(width)}" height="${Math.ceil(height)}"${after}>`,
  );
}

function getDiagramViewBox(svg: string) {
  const innerSvgMatch = svg.match(/<svg[^>]*\bd2-svg\b[^>]*\sviewBox="([^"]+)"/);
  if (innerSvgMatch?.[1]) return innerSvgMatch[1];
  const outerSvgMatch = svg.match(/<svg[^>]*\sviewBox="([^"]+)"/);
  return outerSvgMatch?.[1] ?? "0 0 800 600";
}

function downloadBytes(name: string, base64Data: string, type: string) {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  downloadURL(name, URL.createObjectURL(new Blob([bytes], { type })));
}

function downloadURL(name: string, url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default App;
