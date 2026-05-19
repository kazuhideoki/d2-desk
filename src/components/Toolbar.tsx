import {
  Briefcase,
  Download,
  FileDown,
  FileInput,
  FileText,
  FolderPlus,
  Focus,
  SquareArrowOutUpRight,
  Settings,
  Save,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { themes } from "../constants";
import type { Workspace } from "../types";

type ToolbarProps = {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  theme: number;
  layout: string;
  onWorkspaceChange: (workspaceId: string | null) => void;
  onOpenWorkspace: () => void;
  onManageWorkspaces: () => void;
  onThemeChange: (theme: number) => void;
  onLayoutChange: (layout: string) => void;
  onOpen: () => void;
  onSave: () => void;
  onOpenWithEditor: () => void;
  onFormat: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onZoomIn: () => void;
  onExportSvg: () => void;
  onExportPng: () => void;
};

export function Toolbar({
  workspaces,
  activeWorkspaceId,
  theme,
  layout,
  onWorkspaceChange,
  onOpenWorkspace,
  onManageWorkspaces,
  onThemeChange,
  onLayoutChange,
  onOpen,
  onSave,
  onOpenWithEditor,
  onFormat,
  onZoomOut,
  onResetView,
  onZoomIn,
  onExportSvg,
  onExportPng,
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
        <button title="Open workspace folder" onClick={onOpenWorkspace}>
          <FolderPlus size={16} />
        </button>
        <button title="Manage workspaces" onClick={onManageWorkspaces}>
          <Settings size={16} />
        </button>
      </div>
      <div className="toolbar" role="toolbar">
        <button title="Open D2 file (Command/Ctrl + O)" onClick={onOpen}>
          <FileInput size={16} />
        </button>
        <button title="Save D2 source (Command/Ctrl + S)" onClick={onSave}>
          <Save size={16} />
        </button>
        <button title="Open current D2 file with $EDITOR" onClick={onOpenWithEditor}>
          <SquareArrowOutUpRight size={16} />
        </button>
        <button title="Format document (Command/Ctrl + Shift + I)" onClick={onFormat}>
          <Wand2 size={16} />
        </button>
        <span className="divider" />
        <select value={theme} onChange={(event) => onThemeChange(Number(event.target.value))}>
          {themes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select value={layout} onChange={(event) => onLayoutChange(event.target.value)}>
          <option value="dagre">dagre</option>
        </select>
        <span className="divider" />
        <button title="Zoom out (Command/Ctrl + -)" onClick={onZoomOut}>
          <ZoomOut size={16} />
        </button>
        <button title="Reset zoom (Command/Ctrl + 0)" onClick={onResetView}>
          <Focus size={16} />
        </button>
        <button title="Zoom in (Command/Ctrl + +)" onClick={onZoomIn}>
          <ZoomIn size={16} />
        </button>
        <span className="divider" />
        <button title="Export SVG" onClick={onExportSvg}>
          <Download size={16} />
        </button>
        <button title="Export PNG" onClick={onExportPng}>
          <FileDown size={16} />
        </button>
      </div>
    </header>
  );
}
