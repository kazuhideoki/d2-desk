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

function App() {
  const [source, setSource] = useState(
    () => localStorage.getItem("d2-desk:last-source") ?? sampleSource,
  );
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
  const [fileName, setFileName] = useState("untitled.d2");
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorationIds = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeObject = useMemo(
    () => compileResult.objects.find((object) => object.id === (hoverId ?? activeId)),
    [activeId, compileResult.objects, hoverId],
  );

  const viewBox = useMemo(() => {
    const match = compileResult.svg.match(/viewBox="([^"]+)"/);
    return match?.[1] ?? "0 0 800 600";
  }, [compileResult.svg]);

  const compile = useCallback(
    async (nextSource: string) => {
      setStatus("Compiling");
      try {
        const result = await invoke<CompileResult>("sidecar_call", {
          method: "compile",
          params: { source: nextSource, layout, theme },
        });
        setCompileResult(result);
        setStatus(result.diagnostics.length > 0 ? "Compiled with diagnostics" : "Compiled");
      } catch (error) {
        setStatus(String(error));
      }
    },
    [layout, theme],
  );

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
      setSource(formatted);
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
    const svgBlob = new Blob([compileResult.svg], { type: "image/svg+xml" });
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
    win.document.write(`<html><head><title>${baseName(fileName)}</title></head><body>${compileResult.svg}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  function openFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setSource(String(reader.result ?? ""));
      setFileName(file.name);
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
          <button title="Zoom out" onClick={() => setZoom((value) => Math.max(0.4, value - 0.1))}>
            <ZoomOut size={16} />
          </button>
          <button title="Reset zoom" onClick={resetView}>
            <Focus size={16} />
          </button>
          <button title="Zoom in" onClick={() => setZoom((value) => Math.min(2.2, value + 0.1))}>
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

      <section className="workspace">
        <section className="editor-pane">
          <div className="pane-title">
            <span>{fileName}</span>
            <span>{source.split("\n").length} lines</span>
          </div>
          <Editor
            height="100%"
            language="d2"
            theme="vs-dark"
            value={source}
            beforeMount={beforeMount}
            onMount={handleMount}
            onChange={(value) => setSource(value ?? "")}
            options={{
              fontSize: 14,
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
              <div className="svg-output" dangerouslySetInnerHTML={{ __html: compileResult.svg }} />
              <svg className="overlay" viewBox={viewBox}>
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
