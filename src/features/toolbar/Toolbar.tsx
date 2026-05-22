import { Briefcase, FileText } from "lucide-react";
import type { Workspace } from "../../types";

type ToolbarProps = {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string | null) => void;
};

export function Toolbar({
  workspaces,
  activeWorkspaceId,
  onWorkspaceChange,
}: ToolbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <FileText size={20} />
        <span>D2 Desk</span>
      </div>
      <div className="workspace-switcher">
        <Briefcase size={16} />
        <select
          aria-label="Workspace"
          value={activeWorkspaceId ?? ""}
          onChange={(event) => onWorkspaceChange(event.target.value || null)}
        >
          <option value="">No Workspace</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}
