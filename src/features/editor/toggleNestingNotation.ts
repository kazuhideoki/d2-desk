import type { D2Object, SourceRange } from "../../types";
import { sourceRangeContainsRange } from "./sourceRanges";

type ToggleNestingNotationResult =
  | {
      ok: true;
      source: string;
      cursorPosition: {
        lineNumber: number;
        column: number;
      };
    }
  | {
      ok: false;
      reason: string;
    };

type SourceOffsets = {
  start: number;
  end: number;
};

function lineStartOffsets(source: string) {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function rangeToOffsets(source: string, range: SourceRange): SourceOffsets | null {
  const offsets = lineStartOffsets(source);
  const startLineOffset = offsets[range.startLine - 1];
  const endLineOffset = offsets[range.endLine - 1];
  if (startLineOffset === undefined || endLineOffset === undefined) return null;

  return {
    start: startLineOffset + range.startColumn - 1,
    end: endLineOffset + range.endColumn - 1,
  };
}

function offsetToPosition(source: string, offset: number) {
  const offsets = lineStartOffsets(source);
  let lineIndex = 0;
  for (let index = 0; index < offsets.length; index += 1) {
    if (offsets[index] > offset) break;
    lineIndex = index;
  }
  return {
    lineNumber: lineIndex + 1,
    column: offset - offsets[lineIndex] + 1,
  };
}

function unquotedLastDotIndex(text: string) {
  let quote: '"' | "'" | null = null;
  let lastDot = -1;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ".") {
      lastDot = index;
    }
  }
  return lastDot;
}

function firstUnquotedOpenBrace(text: string) {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      return index;
    }
  }
  return -1;
}

function linePrefixAtOffset(source: string, offset: number) {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  return source.slice(lineStart, offset);
}

function lineRangeAtOffsets(source: string, offsets: SourceOffsets) {
  const start = source.lastIndexOf("\n", Math.max(0, offsets.start - 1)) + 1;
  const nextLineBreak = source.indexOf("\n", offsets.end);
  return {
    start,
    end: nextLineBreak >= 0 ? nextLineBreak + 1 : offsets.end,
  };
}

function indentBlock(text: string, indentation: string) {
  return text
    .split("\n")
    .map((line) => `${indentation}${line}`)
    .join("\n");
}

function deindentContinuationLines(text: string, indentation: string) {
  if (!indentation) return text;

  const lines = text.split("\n");
  return lines
    .map((line, index) => {
      if (index === 0 || line === "") return line;
      return line.startsWith(indentation) ? line.slice(indentation.length) : line;
    })
    .join("\n");
}

function statementRangeForObject(object: D2Object) {
  const ranges = object.sourceRanges ?? [];
  return ranges.reduce<SourceRange | null>((largestRange, range) => {
    if (!largestRange) return range;
    const largestSize =
      (largestRange.endLine - largestRange.startLine) * 10000 +
      largestRange.endColumn -
      largestRange.startColumn;
    const rangeSize =
      (range.endLine - range.startLine) * 10000 + range.endColumn - range.startColumn;
    return rangeSize > largestSize ? range : largestRange;
  }, null);
}

function tokenRangeForObject(object: D2Object) {
  return object.sourceRanges?.[0] ?? null;
}

function findParentObject(objects: D2Object[], parentId: string, childRange: SourceRange) {
  return (
    objects.find(
      (object) =>
        object.kind === "shape" &&
        object.id === parentId &&
        (object.sourceRanges ?? []).some((range) => sourceRangeContainsRange(range, childRange)),
    ) ?? null
  );
}

function findObjectById(objects: D2Object[], id: string) {
  return objects.find((object) => object.kind === "shape" && object.id === id) ?? null;
}

function findOnlyDirectChild(objects: D2Object[], parent: D2Object) {
  const childPrefix = `${parent.id}.`;
  const children = objects.filter((object) => {
    if (object.kind !== "shape" || !object.id.startsWith(childPrefix)) return false;
    if (object.id.slice(childPrefix.length).includes(".")) return false;
    return true;
  });
  return children.length === 1 ? children[0] : null;
}

function applySourceEdits(
  source: string,
  edits: Array<SourceOffsets & { text: string }>,
) {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (currentSource, edit) =>
        currentSource.slice(0, edit.start) + edit.text + currentSource.slice(edit.end),
      source,
    );
}

function canCollapseOnlyChild(parentText: string, childRelativeRange: SourceOffsets) {
  const openBraceIndex = firstUnquotedOpenBrace(parentText);
  const closeBraceIndex = parentText.lastIndexOf("}");
  if (openBraceIndex < 0 || closeBraceIndex < 0 || closeBraceIndex <= openBraceIndex) return false;

  const beforeChild = parentText.slice(openBraceIndex + 1, childRelativeRange.start);
  const afterChild = parentText.slice(childRelativeRange.end, closeBraceIndex);
  return beforeChild.trim() === "" && afterChild.trim() === "";
}

function toggleDotToNested(
  source: string,
  object: D2Object,
  objects: D2Object[],
): ToggleNestingNotationResult {
  const tokenRange = tokenRangeForObject(object);
  const statementRange = statementRangeForObject(object);
  if (!tokenRange || !statementRange) {
    return { ok: false, reason: "Could not locate the selected node" };
  }

  const tokenOffsets = rangeToOffsets(source, tokenRange);
  const statementOffsets = rangeToOffsets(source, statementRange);
  if (!tokenOffsets || !statementOffsets) {
    return { ok: false, reason: "Could not locate the selected node" };
  }

  const pathText = source.slice(tokenOffsets.start, tokenOffsets.end);
  const splitIndex = unquotedLastDotIndex(pathText);
  if (splitIndex < 0) {
    return { ok: false, reason: "Select a nested node to toggle notation" };
  }

  const parentPath = pathText.slice(0, splitIndex);
  const childName = pathText.slice(splitIndex + 1);
  if (!parentPath || !childName) {
    return { ok: false, reason: "Select a nested node to toggle notation" };
  }

  const statementText = source.slice(statementOffsets.start, statementOffsets.end);
  const childStatement = `${childName}${statementText.slice(pathText.length)}`;
  const baseIndent = linePrefixAtOffset(source, statementOffsets.start);

  const existingParent = findObjectById(objects, parentPath);
  const existingParentRange = existingParent ? statementRangeForObject(existingParent) : null;
  const existingParentOffsets = existingParentRange
    ? rangeToOffsets(source, existingParentRange)
    : null;
  if (existingParentOffsets) {
    const parentText = source.slice(existingParentOffsets.start, existingParentOffsets.end);
    const openBraceIndex = firstUnquotedOpenBrace(parentText);
    const closeBraceIndex = parentText.lastIndexOf("}");
    if (openBraceIndex >= 0 && closeBraceIndex > openBraceIndex) {
      const parentIndent = linePrefixAtOffset(source, existingParentOffsets.start);
      const insertOffset = existingParentOffsets.start + openBraceIndex + 1;
      const removalRange = lineRangeAtOffsets(source, statementOffsets);
      const nextSource = applySourceEdits(source, [
        {
          start: removalRange.start,
          end: removalRange.end,
          text: "",
        },
        {
          start: insertOffset,
          end: insertOffset,
          text: `\n${indentBlock(childStatement, `${parentIndent}  `)}`,
        },
      ]);
      const cursorOffset = nextSource.indexOf(`${parentPath}:`);
      return {
        ok: true,
        source: nextSource,
        cursorPosition: offsetToPosition(
          nextSource,
          cursorOffset >= 0 ? cursorOffset + parentPath.length + 1 : 0,
        ),
      };
    }
  }

  const nestedStatement = `${parentPath}: {\n${indentBlock(childStatement, `${baseIndent}  `)}\n${baseIndent}}`;
  const nextSource =
    source.slice(0, statementOffsets.start) +
    nestedStatement +
    source.slice(statementOffsets.end);
  return {
    ok: true,
    source: nextSource,
    cursorPosition: offsetToPosition(nextSource, statementOffsets.start + parentPath.length + 1),
  };
}

function toggleNestedToDot(
  source: string,
  object: D2Object,
  objects: D2Object[],
): ToggleNestingNotationResult {
  const idSplitIndex = object.id.lastIndexOf(".");
  if (idSplitIndex < 0) {
    return { ok: false, reason: "Select a nested node to toggle notation" };
  }

  const parentId = object.id.slice(0, idSplitIndex);
  const statementRange = statementRangeForObject(object);
  const tokenRange = tokenRangeForObject(object);
  if (!statementRange || !tokenRange) {
    return { ok: false, reason: "Could not locate the selected node" };
  }

  const parentObject = findParentObject(objects, parentId, statementRange);
  const parentRange = parentObject ? statementRangeForObject(parentObject) : null;
  if (!parentRange) {
    return { ok: false, reason: "Could not locate the parent block" };
  }

  const parentOffsets = rangeToOffsets(source, parentRange);
  const statementOffsets = rangeToOffsets(source, statementRange);
  const tokenOffsets = rangeToOffsets(source, tokenRange);
  if (!parentOffsets || !statementOffsets || !tokenOffsets) {
    return { ok: false, reason: "Could not locate the selected node" };
  }
  if (statementOffsets.start < parentOffsets.start || statementOffsets.end > parentOffsets.end) {
    return { ok: false, reason: "Could not locate the parent block" };
  }

  const parentText = source.slice(parentOffsets.start, parentOffsets.end);
  const childRelativeRange = {
    start: statementOffsets.start - parentOffsets.start,
    end: statementOffsets.end - parentOffsets.start,
  };
  const childIndent = linePrefixAtOffset(source, statementOffsets.start);
  const tokenLength = tokenOffsets.end - tokenOffsets.start;
  const childStatement = deindentContinuationLines(
    source.slice(statementOffsets.start, statementOffsets.end),
    childIndent,
  );
  const dotStatement = `${object.id}${childStatement.slice(tokenLength)}`;
  if (!canCollapseOnlyChild(parentText, childRelativeRange)) {
    const parentIndent = linePrefixAtOffset(source, parentOffsets.start);
    const removalRange = lineRangeAtOffsets(source, statementOffsets);
    const nextSource =
      source.slice(0, parentOffsets.start) +
      dotStatement +
      "\n" +
      parentIndent +
      source.slice(parentOffsets.start, removalRange.start) +
      source.slice(removalRange.end);
    return {
      ok: true,
      source: nextSource,
      cursorPosition: offsetToPosition(nextSource, parentOffsets.start + object.id.length),
    };
  }

  const nextSource =
    source.slice(0, parentOffsets.start) + dotStatement + source.slice(parentOffsets.end);
  return {
    ok: true,
    source: nextSource,
    cursorPosition: offsetToPosition(nextSource, parentOffsets.start + object.id.length),
  };
}

export function toggleNestingNotationInSource(
  source: string,
  object: D2Object,
  objects: D2Object[],
): ToggleNestingNotationResult {
  if (object.kind !== "shape") {
    return { ok: false, reason: "Select a node to toggle notation" };
  }

  const tokenRange = tokenRangeForObject(object);
  const tokenOffsets = tokenRange ? rangeToOffsets(source, tokenRange) : null;
  const tokenText = tokenOffsets ? source.slice(tokenOffsets.start, tokenOffsets.end) : "";
  if (unquotedLastDotIndex(tokenText) >= 0) {
    return toggleDotToNested(source, object, objects);
  }
  if (!object.id.includes(".")) {
    const onlyChild = findOnlyDirectChild(objects, object);
    if (onlyChild) {
      return toggleNestingNotationInSource(source, onlyChild, objects);
    }
  }

  return toggleNestedToDot(source, object, objects);
}

export type { ToggleNestingNotationResult };
