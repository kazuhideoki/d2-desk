import type { CompileResult, SourceRange } from "../types";

export function sourceRangeContains(range: SourceRange, lineNumber: number, column: number) {
  if (lineNumber < range.startLine || lineNumber > range.endLine) {
    return false;
  }
  if (lineNumber === range.startLine && column < range.startColumn) {
    return false;
  }
  if (lineNumber === range.endLine && column > range.endColumn) {
    return false;
  }
  return true;
}

export function objectIdAtPosition(
  objects: CompileResult["objects"],
  lineNumber: number,
  column: number,
) {
  let bestMatch: { id: string; size: number } | null = null;
  for (const object of objects) {
    for (const range of object.sourceRanges ?? []) {
      if (sourceRangeContains(range, lineNumber, column)) {
        const size =
          range.startLine === range.endLine
            ? range.endColumn - range.startColumn
            : (range.endLine - range.startLine) * 10000 + range.endColumn - range.startColumn;
        if (!bestMatch || size < bestMatch.size) {
          bestMatch = { id: object.id, size };
        }
      }
    }
  }
  return bestMatch?.id ?? null;
}
