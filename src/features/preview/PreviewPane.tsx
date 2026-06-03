import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import type { D2Board, D2Object } from "../../types";
import { connectionPath, fitBoundsZoom, settleAutoZoom } from "../../utils";
import { RepeatButton } from "../../shared/components/RepeatButton";
import { boardOptionLabel, boardPathKey } from "./boards";
import { firstPreviewExternalUrl } from "./links";
import { previewZoomShortcutAction, previewZoomWheelAction } from "./zoomShortcuts";

export type PreviewZoomMode = "auto" | "manual";

type PreviewPaneProps = {
  objects: D2Object[];
  boards?: D2Board[];
  selectedBoardPath?: string[];
  renderedSvg: string;
  overlayViewBox: string;
  zoom: number;
  zoomMode: PreviewZoomMode;
  activeId: string | null;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onZoomIn: () => void;
  onFineZoomOut: () => void;
  onFineZoomIn: () => void;
  onZoomModeChange: (zoomMode: PreviewZoomMode) => void;
  onAutoZoomChange: (zoom: number) => void;
  onBoardPathChange?: (boardPath: string[]) => void;
  onOpenLink?: (href: string) => void;
};

type PreviewContentSize = {
  width: number;
  height: number;
};

function parsePositiveNumber(value: string | null) {
  if (!value) return null;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function sizeFromViewBox(viewBox: string): PreviewContentSize {
  const [, , width, height] = viewBox.split(/\s+/).map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 800, height: 600 };
  }

  return { width, height };
}

function measureSvgSize(
  svg: SVGSVGElement | null,
  fallback: PreviewContentSize,
  currentZoom: number,
) {
  if (!svg) return fallback;

  const viewBox = svg.getAttribute("viewBox")?.split(/\s+/).map(Number) ?? [];
  const viewBoxWidth =
    viewBox.length === 4 && Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? viewBox[2] : null;
  const viewBoxHeight =
    viewBox.length === 4 && Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? viewBox[3] : null;
  const attrWidth = parsePositiveNumber(svg.getAttribute("width"));
  const attrHeight = parsePositiveNumber(svg.getAttribute("height"));
  const rect = svg.getBoundingClientRect();
  const zoomScale = Number.isFinite(currentZoom) && currentZoom > 0 ? currentZoom : 1;
  const layoutWidth = rect.width > 0 ? rect.width / zoomScale : null;
  const layoutHeight = rect.height > 0 ? rect.height / zoomScale : null;
  const widthCandidates = [attrWidth, viewBoxWidth, layoutWidth].filter((value) => value !== null);
  const heightCandidates = [attrHeight, viewBoxHeight, layoutHeight].filter((value) => value !== null);

  return {
    width: widthCandidates.length > 0 ? Math.max(...widthCandidates) : fallback.width,
    height: heightCandidates.length > 0 ? Math.max(...heightCandidates) : fallback.height,
  };
}

function availableContentSize(viewport: HTMLElement): PreviewContentSize {
  const style = window.getComputedStyle(viewport);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const rectWidth = viewport.getBoundingClientRect().width;
  const rectHeight = viewport.getBoundingClientRect().height;
  const viewportWidth = rectWidth > 0 ? rectWidth : viewport.clientWidth;
  const viewportHeight = rectHeight > 0 ? rectHeight : viewport.clientHeight;
  return {
    width: Math.max(0, viewportWidth - paddingLeft - paddingRight),
    height: Math.max(0, viewportHeight - paddingTop - paddingBottom),
  };
}

function hrefFromAnchor(anchor: Element | null) {
  return anchor?.getAttribute("href") ?? anchor?.getAttribute("xlink:href") ?? null;
}

function anchorHrefFromTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  return hrefFromAnchor(element?.closest("a") ?? null);
}

function titleTextFromElement(element: Element) {
  return (
    Array.from(element.children).find((child) => child.tagName.toLowerCase() === "title")
      ?.textContent ?? null
  );
}

function titleUrlFromTarget(target: EventTarget | null, boundary: HTMLElement | null) {
  if (!boundary) return null;

  let element = target instanceof Element ? target : null;
  while (element) {
    const url = firstPreviewExternalUrl(titleTextFromElement(element));
    if (url) return url;
    if (element === boundary) break;
    element = element.parentElement;
  }
  return null;
}

function titleUrlAtPoint(container: HTMLElement | null, clientX: number, clientY: number) {
  if (!container) return null;

  const elementsWithTitles = Array.from(container.querySelectorAll("*")).filter((element) =>
    firstPreviewExternalUrl(titleTextFromElement(element)),
  );
  for (const element of elementsWithTitles.reverse()) {
    const rect = element.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return firstPreviewExternalUrl(titleTextFromElement(element));
    }
  }
  return null;
}

function d2ObjectClassName(id: string) {
  const bytes = new TextEncoder().encode(id);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function titleUrlForObject(container: HTMLElement | null, object: D2Object) {
  if (!container) return null;

  const className = d2ObjectClassName(object.id);
  const groups = Array.from(container.querySelectorAll("g"));
  for (const group of groups) {
    if (!group.classList.contains(className)) continue;
    const url = firstPreviewExternalUrl(titleTextFromElement(group));
    if (url) return url;
  }
  return null;
}

function isAppendixIconElement(element: Element | null, boundary: HTMLElement | null) {
  let current = element;
  while (current) {
    if (current.classList.contains("appendix-icon")) return true;
    if (current === boundary) break;
    current = current.parentElement;
  }
  return false;
}

function appendixAnchorHrefFromTarget(target: EventTarget | null, boundary: HTMLElement | null) {
  const element = target instanceof Element ? target : null;
  return isAppendixIconElement(element, boundary) ? anchorHrefFromTarget(target) : null;
}

function objectChipPreviewBounds(object: D2Object) {
  const { x, y, width, height } = object.preview;
  if (
    object.kind !== "shape" ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return null;
  }

  return {
    x: x + width - 16,
    y: y - 16,
    size: 32,
  };
}

export function PreviewPane({
  objects,
  boards = [],
  selectedBoardPath = [],
  renderedSvg,
  overlayViewBox,
  zoom,
  zoomMode,
  activeId,
  hoverId,
  onHover,
  onSelect,
  onZoomOut,
  onResetZoom,
  onZoomIn,
  onFineZoomOut,
  onFineZoomIn,
  onZoomModeChange,
  onAutoZoomChange,
  onBoardPathChange,
  onOpenLink,
}: PreviewPaneProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const svgOutputRef = useRef<HTMLDivElement | null>(null);
  const fallbackSize = useMemo(() => sizeFromViewBox(overlayViewBox), [overlayViewBox]);
  const [contentSize, setContentSize] = useState(fallbackSize);

  const updateMeasurements = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const svg = svgOutputRef.current?.querySelector("svg");
    const nextSize = measureSvgSize(svg instanceof SVGSVGElement ? svg : null, fallbackSize, zoom);
    setContentSize((current) =>
      current.width === nextSize.width && current.height === nextSize.height ? current : nextSize,
    );

    if (zoomMode === "auto") {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      const availableSize = availableContentSize(viewport);
      const nextZoom = fitBoundsZoom(
        availableSize.width,
        availableSize.height,
        nextSize.width,
        nextSize.height,
      );
      onAutoZoomChange(settleAutoZoom(zoom, nextZoom));
    }
  }, [fallbackSize, onAutoZoomChange, zoom, zoomMode]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(updateMeasurements);
    return () => window.cancelAnimationFrame(frameId);
  }, [renderedSvg, updateMeasurements]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const observer = new ResizeObserver(updateMeasurements);
    observer.observe(viewport);
    window.requestAnimationFrame(updateMeasurements);
    return () => observer.disconnect();
  }, [updateMeasurements]);

  useEffect(() => {
    if (zoomMode !== "auto") return;

    const resetScroll = () => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    };

    resetScroll();
    window.requestAnimationFrame(resetScroll);
  }, [contentSize.height, contentSize.width, zoom, zoomMode]);

  const handlePreviewKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;

      const action = previewZoomShortcutAction(event);
      if (!action) return;

      event.preventDefault();
      event.stopPropagation();

      if (action === "zoomIn") {
        onZoomIn();
      } else {
        onZoomOut();
      }
    },
    [onZoomIn, onZoomOut],
  );

  const openLink = useCallback(
    (href: string | null, event: MouseEvent) => {
      if (!href || !onOpenLink) return false;
      event.preventDefault();
      event.stopPropagation();
      onOpenLink(href);
      return true;
    },
    [onOpenLink],
  );

  const handleSvgClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      openLink(
        appendixAnchorHrefFromTarget(event.target, event.currentTarget) ??
          titleUrlFromTarget(event.target, event.currentTarget),
        event,
      );
    },
    [openLink],
  );

  const handleOverlaySelect = useCallback(
    (object: D2Object) => {
      onSelect(object.id);
    },
    [onSelect],
  );

  const handleChipOpen = useCallback(
    (object: D2Object, event: MouseEvent) => {
      if (
        openLink(
          object.link ??
            titleUrlForObject(svgOutputRef.current, object) ??
            titleUrlAtPoint(svgOutputRef.current, event.clientX, event.clientY),
          event,
        )
      ) {
        return;
      }
      onSelect(object.id);
    },
    [onSelect, openLink],
  );

  const handlePreviewWheel = useCallback(
    (event: WheelEvent) => {
      if (event.defaultPrevented) return;

      const viewport = viewportRef.current;
      if (!viewport) return;

      const action = previewZoomWheelAction(event);
      if (!action) return;

      event.preventDefault();
      event.stopPropagation();

      if (action === "zoomIn") {
        onFineZoomIn();
      } else {
        onFineZoomOut();
      }
    },
    [onFineZoomIn, onFineZoomOut],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    viewport.addEventListener("wheel", handlePreviewWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handlePreviewWheel);
  }, [handlePreviewWheel]);

  return (
    <section className="preview-pane">
      <div className="pane-title">
        <span>Preview</span>
        <div className="pane-title-actions">
          {boards.length > 1 ? (
            <select
              className="preview-board-select"
              title="Preview board"
              value={boardPathKey(selectedBoardPath)}
              disabled={!onBoardPathChange}
              onChange={(event) => {
                const nextPath = JSON.parse(event.target.value) as string[];
                onBoardPathChange?.(nextPath);
              }}
            >
              {boards.map((board) => (
                <option key={boardPathKey(board.path)} value={boardPathKey(board.path)}>
                  {boardOptionLabel(board)}
                </option>
              ))}
            </select>
          ) : null}
          <div className="pane-zoom-controls" aria-label="Preview zoom controls">
            <RepeatButton className="pane-zoom-button" title="Zoom preview out" onPress={onZoomOut}>
              <ZoomOut size={13} />
            </RepeatButton>
            <button className="pane-zoom-value" title="Fit preview" onClick={onResetZoom}>
              {Math.round(zoom * 100)}%
            </button>
            <RepeatButton className="pane-zoom-button" title="Zoom preview in" onPress={onZoomIn}>
              <ZoomIn size={13} />
            </RepeatButton>
          </div>
          <label className="preview-auto-zoom-toggle" title="Fit preview automatically">
            <input
              type="checkbox"
              checked={zoomMode === "auto"}
              onChange={(event) => onZoomModeChange(event.target.checked ? "auto" : "manual")}
            />
            <span>Auto</span>
          </label>
        </div>
      </div>
      <div
        ref={viewportRef}
        className="preview-viewport"
        tabIndex={0}
        onPointerDown={(event) => event.currentTarget.focus()}
        onKeyDown={handlePreviewKeyDown}
      >
        <div
          className="preview-canvas"
          style={{ width: contentSize.width * zoom, height: contentSize.height * zoom }}
        >
          <div className="preview-content" style={{ transform: `scale(${zoom})` }}>
            <div
              ref={svgOutputRef}
              className="svg-output"
              onClick={handleSvgClick}
              dangerouslySetInnerHTML={{ __html: renderedSvg }}
            />
            <svg className="overlay" viewBox={overlayViewBox}>
              {objects.map((object) => {
                const isFocused = object.id === (hoverId ?? activeId);
                const chipBounds = objectChipPreviewBounds(object);
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
                      onClick={() => handleOverlaySelect(object)}
                    />
                    {chipBounds ? (
                      <rect
                        className="hit-target chip-hit-target"
                        x={chipBounds.x}
                        y={chipBounds.y}
                        width={chipBounds.size}
                        height={chipBounds.size}
                        rx={16}
                        onMouseEnter={() => onHover(object.id)}
                        onMouseLeave={() => onHover(null)}
                        onClick={(event) => handleChipOpen(object, event)}
                      />
                    ) : null}
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
                      onClick={() => handleOverlaySelect(object)}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
