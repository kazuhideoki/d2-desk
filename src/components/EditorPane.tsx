import Editor, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { ZoomIn, ZoomOut } from "lucide-react";

type EditorPaneProps = {
  activeTabId: string;
  fileName: string;
  source: string;
  zoom: number;
  editorFontSize: number;
  editorLineHeight: number;
  beforeMount: (monaco: typeof Monaco) => void;
  onMount: OnMount;
  onChange: (source: string) => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onZoomIn: () => void;
};

export function EditorPane({
  activeTabId,
  fileName,
  source,
  zoom,
  editorFontSize,
  editorLineHeight,
  beforeMount,
  onMount,
  onChange,
  onZoomOut,
  onResetZoom,
  onZoomIn,
}: EditorPaneProps) {
  const handleMount: OnMount = (editor, monaco) => {
    onMount(editor, monaco);
    editor.onDidChangeModelContent((event) => {
      const typedText = event.changes[event.changes.length - 1]?.text ?? "";
      if (typedText !== "." && !/^[\w-]$/.test(typedText)) return;

      const position = editor.getPosition();
      const model = editor.getModel();
      if (!position || !model) return;

      const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      if (!/(^|[{\s;]|->|<-|--|<->)\s*[\w-]+$/.test(linePrefix) && !/\.[\w-]*$/.test(linePrefix)) {
        return;
      }

      window.setTimeout(() => {
        editor.trigger("d2-dot-suggest", "editor.action.triggerSuggest", {});
      }, 0);
    });
  };

  return (
    <section className="editor-pane">
      <div className="pane-title">
        <span>{fileName}</span>
        <div className="pane-title-actions">
          <span className="line-count">{source.split("\n").length} lines</span>
          <span className="pane-title-divider" />
          <div className="pane-zoom-controls" aria-label="Editor zoom controls">
            <button className="pane-zoom-button" title="Zoom editor out" onClick={onZoomOut}>
              <ZoomOut size={13} />
            </button>
            <button className="pane-zoom-value" title="Reset editor zoom" onClick={onResetZoom}>
              {Math.round(zoom * 100)}%
            </button>
            <button className="pane-zoom-button" title="Zoom editor in" onClick={onZoomIn}>
              <ZoomIn size={13} />
            </button>
          </div>
        </div>
      </div>
      <Editor
        key={activeTabId}
        height="100%"
        language="d2"
        theme="d2-dark"
        value={source}
        beforeMount={beforeMount}
        onMount={handleMount}
        onChange={(value) => onChange(value ?? "")}
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
  );
}
