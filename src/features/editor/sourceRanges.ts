import type { CompileResult, D2Object, SourceRange } from "../../types";

export function sourceRangeEquals(left: SourceRange, right: SourceRange) {
  return (
    left.startLine === right.startLine &&
    left.startColumn === right.startColumn &&
    left.endLine === right.endLine &&
    left.endColumn === right.endColumn
  );
}

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

export function sourceRangeContainsRange(outer: SourceRange, inner: SourceRange) {
  return (
    sourceRangeContains(outer, inner.startLine, inner.startColumn) &&
    sourceRangeContains(outer, inner.endLine, inner.endColumn)
  );
}

export function sourceRangeStartsBeforeOrAt(left: SourceRange, right: SourceRange) {
  return (
    left.startLine < right.startLine ||
    (left.startLine === right.startLine && left.startColumn <= right.startColumn)
  );
}

export function sourceRangeEndsAfterOrAt(left: SourceRange, right: SourceRange) {
  return (
    left.endLine > right.endLine ||
    (left.endLine === right.endLine && left.endColumn >= right.endColumn)
  );
}

export function sourceRangeIntersectsRange(left: SourceRange, right: SourceRange) {
  const leftStartsBeforeRightEnds =
    left.startLine < right.endLine ||
    (left.startLine === right.endLine && left.startColumn <= right.endColumn);
  const rightStartsBeforeLeftEnds =
    right.startLine < left.endLine ||
    (right.startLine === left.endLine && right.startColumn <= left.endColumn);
  return leftStartsBeforeRightEnds && rightStartsBeforeLeftEnds;
}

export function sourceRangeSize(range: SourceRange) {
  return range.startLine === range.endLine
    ? range.endColumn - range.startColumn
    : (range.endLine - range.startLine) * 10000 + range.endColumn - range.startColumn;
}

export function sortSourceRangesSmallestFirst(ranges: SourceRange[]) {
  return [...ranges].sort((left, right) => {
    const sizeDelta = sourceRangeSize(left) - sourceRangeSize(right);
    if (sizeDelta !== 0) return sizeDelta;
    return (
      left.startLine - right.startLine ||
      left.startColumn - right.startColumn ||
      left.endLine - right.endLine ||
      left.endColumn - right.endColumn
    );
  });
}

export function nextLargerSourceRange(ranges: SourceRange[], currentRange: SourceRange) {
  return sortSourceRangesSmallestFirst(ranges).find(
    (range) => sourceRangeContainsRange(range, currentRange) && !sourceRangeEquals(range, currentRange),
  ) ?? null;
}

export function nextSmallerSourceRange(ranges: SourceRange[], currentRange: SourceRange) {
  const sortedRanges = sortSourceRangesSmallestFirst(ranges);
  for (let index = sortedRanges.length - 1; index >= 0; index -= 1) {
    const range = sortedRanges[index];
    if (sourceRangeContainsRange(currentRange, range) && !sourceRangeEquals(range, currentRange)) {
      return range;
    }
  }
  return null;
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
        const size = sourceRangeSize(range);
        if (!bestMatch || size < bestMatch.size) {
          bestMatch = { id: object.id, size };
        }
      }
    }
  }
  return bestMatch?.id ?? null;
}

export function connectionIdAtPosition(
  objects: CompileResult["objects"],
  lineNumber: number,
  column: number,
) {
  let bestMatch: { id: string; size: number } | null = null;
  for (const object of objects) {
    if (object.kind !== "connection") continue;
    for (const range of object.sourceRanges ?? []) {
      if (sourceRangeContains(range, lineNumber, column)) {
        const size = sourceRangeSize(range);
        if (!bestMatch || size < bestMatch.size) {
          bestMatch = { id: object.id, size };
        }
      }
    }
  }
  return bestMatch?.id ?? null;
}

type ObjectSelectionMatch = {
  object: D2Object;
  range: SourceRange;
  size: number;
};

function shapeRangeMatches(objects: CompileResult["objects"], selectionRange: SourceRange) {
  const matches: ObjectSelectionMatch[] = [];
  for (const object of objects) {
    if (object.kind !== "shape") continue;
    for (const range of object.sourceRanges ?? []) {
      if (sourceRangeIntersectsRange(range, selectionRange)) {
        matches.push({ object, range, size: sourceRangeSize(range) });
      }
    }
  }
  return matches;
}

export function shapeIdForSelectionRange(
  objects: CompileResult["objects"],
  selectionRange: SourceRange,
) {
  const matches = shapeRangeMatches(objects, selectionRange);

  const containingSelection = matches
    .filter((match) => sourceRangeContainsRange(match.range, selectionRange))
    .sort((left, right) => left.size - right.size);
  if (containingSelection[0]) {
    return containingSelection[0].object.id;
  }

  const containedBySelection = matches
    .filter((match) => sourceRangeContainsRange(selectionRange, match.range))
    .sort((left, right) => right.size - left.size);
  if (containedBySelection[0]) {
    return containedBySelection[0].object.id;
  }

  return null;
}
