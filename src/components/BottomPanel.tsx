import type { D2Object, Diagnostic } from "../types";

type BottomPanelProps = {
  status: string;
  activeObject?: D2Object;
  diagnostics: Diagnostic[];
};

export function BottomPanel({ status, activeObject, diagnostics }: BottomPanelProps) {
  return (
    <footer className="bottom-panel">
      <div>
        <strong>{status}</strong>
        {activeObject ? (
          <span className="object-chip">
            {activeObject.kind}: {activeObject.id}
          </span>
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
