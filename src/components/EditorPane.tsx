import Editor, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

type EditorPaneProps = {
  activeTabId: string;
  fileName: string;
  source: string;
  editorFontSize: number;
  editorLineHeight: number;
  beforeMount: (monaco: typeof Monaco) => void;
  onMount: OnMount;
  onChange: (source: string) => void;
};

export function EditorPane({
  activeTabId,
  fileName,
  source,
  editorFontSize,
  editorLineHeight,
  beforeMount,
  onMount,
  onChange,
}: EditorPaneProps) {
  return (
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
        onMount={onMount}
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
