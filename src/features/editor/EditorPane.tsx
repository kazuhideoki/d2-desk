import Editor, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { ZoomIn, ZoomOut } from "lucide-react";
import { RepeatButton } from "../../shared/components/RepeatButton";
import type { PerfDebugOptions } from "../../types";

type EditorPaneProps = {
  activeTabId: string;
  fileName: string;
  source: string;
  zoom: number;
  editorFontSize: number;
  editorLineHeight: number;
  editorAutoWidth: boolean;
  perfDebugOptions: PerfDebugOptions;
  beforeMount: (monaco: typeof Monaco) => void;
  onMount: OnMount;
  onChange: (source: string) => void;
  onEditorAutoWidthChange: (enabled: boolean) => void;
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
  editorAutoWidth,
  perfDebugOptions,
  beforeMount,
  onMount,
  onChange,
  onEditorAutoWidthChange,
  onZoomOut,
  onResetZoom,
  onZoomIn,
}: EditorPaneProps) {
  return (
    <section className="editor-pane">
      <div className="pane-title">
        <span>{fileName}</span>
        <div className="pane-title-actions">
          <span className="line-count">{source.split("\n").length} lines</span>
          <span className="pane-title-divider" />
          <label className="pane-auto-toggle editor-auto-width-toggle">
            <input
              type="checkbox"
              checked={editorAutoWidth}
              onChange={(event) => onEditorAutoWidthChange(event.target.checked)}
            />
            <span>Auto width</span>
          </label>
          <span className="pane-title-divider" />
          <div className="pane-zoom-controls" aria-label="Editor zoom controls">
            <RepeatButton className="pane-zoom-button" title="Zoom editor out" onPress={onZoomOut}>
              <ZoomOut size={13} />
            </RepeatButton>
            <button className="pane-zoom-value" title="Reset editor zoom" onClick={onResetZoom}>
              {Math.round(zoom * 100)}%
            </button>
            <RepeatButton className="pane-zoom-button" title="Zoom editor in" onPress={onZoomIn}>
              <ZoomIn size={13} />
            </RepeatButton>
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
        onMount={onMount}
        onChange={(value) => onChange(value ?? "")}
        options={{
          fontSize: editorFontSize,
          lineHeight: editorLineHeight,
          fontLigatures: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          scrollBeyondLastColumn: 0,
          revealHorizontalRightPadding: 0,
          wordWrap: perfDebugOptions.wordWrap ? "on" : "off",
          quickSuggestions: perfDebugOptions.autoSuggest,
          suggestOnTriggerCharacters: perfDebugOptions.autoSuggest,
          "semanticHighlighting.enabled": true,
          tabSize: 2,
          automaticLayout: true,
        }}
      />
    </section>
  );
}
