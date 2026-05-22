import { maxZoom, minAutoZoom, minZoom, zoomStep, zoomStepAbove200 } from "./constants";
import type { D2Object, D2Point } from "./types";

export function routePath(route: D2Point[]) {
  if (route.length === 0) return "";
  return route.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

export function connectionPath(preview: D2Object["preview"]) {
  return preview.path || routePath(preview.route ?? []);
}

export function baseName(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

export function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || "untitled.d2";
}

export function ensureD2FileName(name: string) {
  return name.endsWith(".d2") ? name : `${name}.d2`;
}

export function clampZoom(value: number) {
  return Number(Math.min(maxZoom, Math.max(minZoom, value)).toFixed(2));
}

export function increaseZoom(value: number) {
  if (value < 2) return clampZoom(Math.min(2, value + zoomStep));
  return clampZoom(value + zoomStepAbove200);
}

export function decreaseZoom(value: number) {
  if (value > 2) return clampZoom(Math.max(2, value - zoomStepAbove200));
  return clampZoom(value - zoomStep);
}

export function fitBoundsZoom(
  availableWidth: number,
  availableHeight: number,
  contentWidth: number,
  contentHeight: number,
) {
  if (
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(availableHeight) ||
    !Number.isFinite(contentWidth) ||
    !Number.isFinite(contentHeight) ||
    contentWidth <= 0 ||
    contentHeight <= 0
  ) {
    return 1;
  }

  const boundsFitZoom = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
  return Number(Math.min(maxZoom, Math.max(minAutoZoom, boundsFitZoom)).toFixed(2));
}

export function settleAutoZoom(currentZoom: number, nextZoom: number) {
  if (!Number.isFinite(currentZoom) || currentZoom <= 0) return nextZoom;
  const threshold = nextZoom < minZoom ? 0.005 : 0.02;
  return Math.abs(nextZoom - currentZoom) <= threshold + Number.EPSILON ? currentZoom : nextZoom;
}

export function moveSelectionIndex(currentIndex: number, delta: number, itemCount: number) {
  return Math.min(Math.max(currentIndex + delta, 0), Math.max(itemCount - 1, 0));
}

export function normalizeSvgSize(svg: string) {
  const match = svg.match(/<svg([^>]*)viewBox="([^"]+)"([^>]*)>/);
  if (!match) return svg;
  const [, before, viewBox, after] = match;
  if (/\swidth=/.test(`${before}${after}`)) return svg;
  const parts = viewBox.split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return svg;
  const [, , width, height] = parts;
  return svg.replace(
    match[0],
    `<svg${before}viewBox="${viewBox}" width="${Math.ceil(width)}" height="${Math.ceil(height)}"${after}>`,
  );
}

export function getDiagramViewBox(svg: string) {
  const innerSvgMatch = svg.match(/<svg[^>]*\bd2-svg\b[^>]*\sviewBox="([^"]+)"/);
  if (innerSvgMatch?.[1]) return innerSvgMatch[1];
  const outerSvgMatch = svg.match(/<svg[^>]*\sviewBox="([^"]+)"/);
  return outerSvgMatch?.[1] ?? "0 0 800 600";
}

export function downloadBytes(name: string, base64Data: string, type: string) {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  downloadURL(name, URL.createObjectURL(new Blob([bytes], { type })));
}

export function downloadURL(name: string, url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
