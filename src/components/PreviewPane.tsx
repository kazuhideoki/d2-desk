import type { D2Object } from "../types";
import { routePath } from "../utils";

type PreviewPaneProps = {
  objects: D2Object[];
  renderedSvg: string;
  overlayViewBox: string;
  zoom: number;
  activeId: string | null;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
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
}: PreviewPaneProps) {
  return (
    <section className="preview-pane">
      <div className="pane-title">
        <span>Preview</span>
        <span>{Math.round(zoom * 100)}%</span>
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
                      d={routePath(object.preview.route ?? [])}
                    />
                  ) : null}
                  <path
                    className="hit-target"
                    d={routePath(object.preview.route ?? [])}
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
