import { Trash2, X } from "lucide-react";
import type { Workspace } from "../../types";

type WorkspaceManagerProps = {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onClose: () => void;
  onRemoveWorkspace: (workspaceId: string) => void;
};

export function WorkspaceManager({
  workspaces,
  activeWorkspaceId,
  onClose,
  onRemoveWorkspace,
}: WorkspaceManagerProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="workspace-manager" role="dialog" aria-modal="true" aria-labelledby="workspace-manager-title">
        <header className="workspace-manager-header">
          <h2 id="workspace-manager-title">Workspaces</h2>
          <button title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="workspace-list">
          {workspaces.length === 0 ? (
            <p className="workspace-empty">No workspace folders registered.</p>
          ) : (
            workspaces.map((workspace) => (
              <article className="workspace-row" key={workspace.id}>
                <div className="workspace-row-main">
                  <strong>
                    {workspace.name}
                    {workspace.id === activeWorkspaceId ? " (active)" : ""}
                  </strong>
                  <span title={workspace.rootPath}>{workspace.rootPath}</span>
                </div>
                <button
                  title={`Remove ${workspace.name}`}
                  aria-label={`Remove ${workspace.name}`}
                  onClick={() => onRemoveWorkspace(workspace.id)}
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
