import type { D2Object, Diagnostic, PerfDebugOptions } from "../../types";

type BottomPanelProps = {
  status: string;
  activeObject?: D2Object;
  diagnostics: Diagnostic[];
  perfDebugOptions: PerfDebugOptions;
  onPerfDebugOptionChange: (key: keyof PerfDebugOptions, enabled: boolean) => void;
};

const perfDebugOptionLabels: Array<{ key: keyof PerfDebugOptions; label: string }> = [
  { key: "wordWrap", label: "Word wrap" },
  { key: "autoSuggest", label: "Auto suggest" },
  { key: "suggestPreview", label: "Suggest preview" },
  { key: "previewCompile", label: "Preview compile" },
  { key: "previewRender", label: "Preview render" },
];

function objectLabel(object: D2Object) {
  if (object.kind === "connection") {
    return `edge: ${object.src && object.dst ? `${object.src} -> ${object.dst}` : object.id}`;
  }
  return `node: ${object.id}`;
}

export function BottomPanel({
  status,
  activeObject,
  diagnostics,
  perfDebugOptions,
  onPerfDebugOptionChange,
}: BottomPanelProps) {
  return (
    <footer className="bottom-panel">
      <div>
        <strong>{status}</strong>
        {activeObject ? (
          <span className="object-chip">{objectLabel(activeObject)}</span>
        ) : null}
      </div>
      <div className="diagnostics">
        {diagnostics.length === 0
          ? "No diagnostics"
          : diagnostics.map((diagnostic) => diagnostic.message).join(" | ")}
      </div>
      <div className="perf-debug-options" aria-label="Performance debug toggles">
        {perfDebugOptionLabels.map((option) => (
          <label key={option.key} className="perf-debug-option">
            <input
              type="checkbox"
              checked={perfDebugOptions[option.key]}
              onChange={(event) => onPerfDebugOptionChange(option.key, event.target.checked)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </footer>
  );
}
