import type { D2Object, Diagnostic } from "../types";

type BottomPanelProps = {
  status: string;
  activeObject?: D2Object;
  diagnostics: Diagnostic[];
};

function objectLabel(object: D2Object) {
  if (object.kind === "connection") {
    return `edge: ${object.src && object.dst ? `${object.src} -> ${object.dst}` : object.id}`;
  }
  return `node: ${object.id}`;
}

export function BottomPanel({ status, activeObject, diagnostics }: BottomPanelProps) {
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
    </footer>
  );
}
