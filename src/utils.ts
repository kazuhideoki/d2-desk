import { maxZoom, minZoom, zoomStep, zoomStepAbove200 } from "./constants";
import type { D2Object, D2Point } from "./types";

export type D2SymbolEntry = {
  id: string;
  kind: D2Object["kind"];
  name: string;
  detail: string;
  line: number;
  column: number;
};

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

export function fitWidthZoom(availableWidth: number, contentWidth: number) {
  if (!Number.isFinite(availableWidth) || !Number.isFinite(contentWidth) || contentWidth <= 0) {
    return 1;
  }

  return clampZoom(availableWidth / contentWidth);
}

export function moveSelectionIndex(currentIndex: number, delta: number, itemCount: number) {
  return Math.min(Math.max(currentIndex + delta, 0), Math.max(itemCount - 1, 0));
}

export function buildD2SymbolEntries(objects: D2Object[]) {
  return objects
    .map((object): D2SymbolEntry | null => {
      const sourceRange = object.sourceRanges?.[0];
      if (!sourceRange) return null;
      const name =
        object.kind === "connection"
          ? `${object.src ?? ""} -> ${object.dst ?? ""}`
          : object.id.split(".").pop() || object.id;
      const detailParts = [object.id];
      if (object.label && object.label !== name) {
        detailParts.push(object.label);
      }
      return {
        id: object.id,
        kind: object.kind,
        name,
        detail: detailParts.join(" - "),
        line: sourceRange.startLine,
        column: sourceRange.startColumn,
      };
    })
    .filter((symbol): symbol is D2SymbolEntry => symbol !== null)
    .sort((left, right) =>
      left.line === right.line
        ? left.column === right.column
          ? left.id.localeCompare(right.id)
          : left.column - right.column
        : left.line - right.line,
    );
}

export function filterD2Symbols(symbols: D2SymbolEntry[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return symbols;
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return symbols
    .map((symbol) => {
      const searchable = `${symbol.name} ${symbol.detail} ${symbol.kind}`.toLowerCase();
      if (tokens.some((token) => !searchable.includes(token))) {
        return { symbol, score: Number.POSITIVE_INFINITY };
      }
      let score = symbol.name.length + symbol.detail.length;
      if (symbol.name.toLowerCase() === normalizedQuery) score -= 1000;
      if (symbol.name.toLowerCase().startsWith(normalizedQuery)) score -= 700;
      if (symbol.detail.toLowerCase().startsWith(normalizedQuery)) score -= 400;
      score += tokens.reduce((total, token) => total + searchable.indexOf(token), 0);
      return { symbol, score };
    })
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) =>
      left.score === right.score
        ? left.symbol.line === right.symbol.line
          ? left.symbol.id.localeCompare(right.symbol.id)
          : left.symbol.line - right.symbol.line
        : left.score - right.score,
    )
    .map((item) => item.symbol);
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
