import type { D2Object } from "../../types";

export type D2SymbolEntry = {
  id: string;
  kind: D2Object["kind"];
  name: string;
  detail: string;
  line: number;
  column: number;
};

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
      const detail = detailParts.join(" - ");
      return {
        id: object.id,
        kind: object.kind,
        name,
        detail,
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
