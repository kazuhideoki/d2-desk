import {
  Download,
  FileDown,
  FileInput,
  FileText,
  Focus,
  Save,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { themes } from "../constants";

type ToolbarProps = {
  theme: number;
  layout: string;
  onThemeChange: (theme: number) => void;
  onLayoutChange: (layout: string) => void;
  onOpen: () => void;
  onSave: () => void;
  onFormat: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onZoomIn: () => void;
  onExportSvg: () => void;
  onExportPng: () => void;
};

export function Toolbar({
  theme,
  layout,
  onThemeChange,
  onLayoutChange,
  onOpen,
  onSave,
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
      <div className="toolbar" role="toolbar">
        <button title="Open D2 file (Command/Ctrl + O)" onClick={onOpen}>
          <FileInput size={16} />
        </button>
        <button title="Save D2 source (Command/Ctrl + S)" onClick={onSave}>
          <Save size={16} />
        </button>
        <button title="Format document" onClick={onFormat}>
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
