import { ZoomIn, ZoomOut } from "lucide-react";
import type { D2Object } from "../types";
import { connectionPath } from "../utils";
import { RepeatButton } from "./RepeatButton";

type PreviewPaneProps = {
  objects: D2Object[];
  renderedSvg: string;
  overlayViewBox: string;
  zoom: number;
  activeId: string | null;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onZoomIn: () => void;
};

export function PreviewPane({
  objects,
  renderedSvg,
  overlayViewBox,
  zoom,
  activeId,
  hoverId,
  onHover,
  onSelect,
  onZoomOut,
  onResetZoom,
  onZoomIn,
}: PreviewPaneProps) {
  return (
    <section className="preview-pane">
      <div className="pane-title">
        <span>Preview</span>
        <div className="pane-title-actions">
          <div className="pane-zoom-controls" aria-label="Preview zoom controls">
            <RepeatButton className="pane-zoom-button" title="Zoom preview out" onPress={onZoomOut}>
              <ZoomOut size={13} />
            </RepeatButton>
            <button className="pane-zoom-value" title="Reset preview zoom" onClick={onResetZoom}>
              {Math.round(zoom * 100)}%
            </button>
            <RepeatButton className="pane-zoom-button" title="Zoom preview in" onPress={onZoomIn}>
              <ZoomIn size={13} />
            </RepeatButton>
          </div>
        </div>
      </div>
      <div className="preview-viewport">
        <div className="preview-canvas" style={{ transform: `scale(${zoom})` }}>
          <div className="svg-output" dangerouslySetInnerHTML={{ __html: renderedSvg }} />
          <svg className="overlay" viewBox={overlayViewBox}>
            {objects.map((object) => {
              const isFocused = object.id === (hoverId ?? activeId);
              return object.kind === "shape" ? (
                <g key={object.id}>
                  {isFocused ? (
                    <rect
                      className="focus-indicator"
                      x={object.preview.x}
                      y={object.preview.y}
                      width={object.preview.width}
                      height={object.preview.height}
                      rx={8}
                    />
                  ) : null}
                  <rect
                    className="hit-target"
                    x={object.preview.x}
                    y={object.preview.y}
                    width={object.preview.width}
                    height={object.preview.height}
                    rx={8}
                    onMouseEnter={() => onHover(object.id)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onSelect(object.id)}
                  />
                </g>
              ) : (
                <g key={object.id}>
                  {isFocused ? (
                    <path
                      className="focus-indicator connection"
                      d={connectionPath(object.preview)}
                    />
                  ) : null}
                  <path
                    className="hit-target"
                    d={connectionPath(object.preview)}
                    onMouseEnter={() => onHover(object.id)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onSelect(object.id)}
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </section>
  );
}
