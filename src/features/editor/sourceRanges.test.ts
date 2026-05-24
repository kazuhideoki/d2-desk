import { describe, expect, it } from "vitest";
import type { CompileResult, SourceRange } from "../../types";
import {
  connectionIdAtPosition,
  nextLargerSourceRange,
  nextSmallerSourceRange,
  objectIdAtPosition,
  sourceRangeContains,
  sourceRangeContainsRange,
  sourceRangeEquals,
  sortSourceRangesSmallestFirst,
} from "./sourceRanges";

const range = (startLine: number, startColumn: number, endLine: number, endColumn: number) => ({
  file: "main.d2",
  startLine,
  startColumn,
  endLine,
  endColumn,
});

const object = (
  id: string,
  sourceRanges: SourceRange[] | null,
): CompileResult["objects"][number] => ({
  id,
  kind: "shape",
  sourceRanges,
  preview: {},
});

const connection = (
  id: string,
  sourceRanges: SourceRange[] | null,
): CompileResult["objects"][number] => ({
  id,
  kind: "connection",
  sourceRanges,
  preview: {},
});

describe("sourceRanges", () => {
  it("treats source range bounds as inclusive", () => {
    const sourceRange = range(2, 4, 3, 8);

    expect(sourceRangeContains(sourceRange, 2, 4)).toBe(true);
    expect(sourceRangeContains(sourceRange, 3, 8)).toBe(true);
    expect(sourceRangeContains(sourceRange, 2, 3)).toBe(false);
    expect(sourceRangeContains(sourceRange, 3, 9)).toBe(false);
    expect(sourceRangeContains(sourceRange, 1, 10)).toBe(false);
    expect(sourceRangeContains(sourceRange, 4, 1)).toBe(false);
  });

  it("compares and orders source ranges", () => {
    const token = range(2, 3, 2, 6);
    const statement = range(2, 3, 2, 18);
    const block = range(1, 1, 4, 2);

    expect(sourceRangeEquals(token, range(2, 3, 2, 6))).toBe(true);
    expect(sourceRangeContainsRange(statement, token)).toBe(true);
    expect(sourceRangeContainsRange(token, statement)).toBe(false);
    expect(sortSourceRangesSmallestFirst([block, statement, token])).toEqual([
      token,
      statement,
      block,
    ]);
  });

  it("finds adjacent larger and smaller syntax ranges", () => {
    const cursor = range(2, 4, 2, 4);
    const token = range(2, 3, 2, 6);
    const statement = range(2, 3, 2, 18);
    const block = range(1, 1, 4, 2);
    const ranges = [block, statement, token];

    expect(nextLargerSourceRange(ranges, cursor)).toEqual(token);
    expect(nextLargerSourceRange(ranges, token)).toEqual(statement);
    expect(nextSmallerSourceRange(ranges, block)).toEqual(statement);
    expect(nextSmallerSourceRange(ranges, statement)).toEqual(token);
    expect(nextSmallerSourceRange(ranges, token)).toBeNull();
  });

  it("returns the smallest object range containing a position", () => {
    const objects: CompileResult["objects"] = [
      object("container", [range(1, 1, 10, 1)]),
      object("container.api", [range(3, 3, 3, 12)]),
      object("container.api.label", [range(3, 8, 3, 12)]),
    ];

    expect(objectIdAtPosition(objects, 3, 9)).toBe("container.api.label");
    expect(objectIdAtPosition(objects, 3, 4)).toBe("container.api");
    expect(objectIdAtPosition(objects, 9, 1)).toBe("container");
  });

  it("ignores objects without source ranges and returns null outside all ranges", () => {
    const objects: CompileResult["objects"] = [
      object("missing", null),
      object("empty", []),
      object("api", [range(2, 1, 2, 4)]),
    ];

    expect(objectIdAtPosition(objects, 1, 1)).toBeNull();
    expect(objectIdAtPosition(objects, 2, 2)).toBe("api");
  });

  it("can prefer a connection over endpoint shapes at the same editor position", () => {
    const objects: CompileResult["objects"] = [
      object("api", [range(1, 1, 1, 4)]),
      object("db", [range(1, 8, 1, 10)]),
      connection("(api -> db)[0]", [range(1, 5, 1, 7), range(1, 1, 1, 10)]),
    ];

    expect(objectIdAtPosition(objects, 1, 2)).toBe("api");
    expect(connectionIdAtPosition(objects, 1, 2)).toBe("(api -> db)[0]");
    expect(connectionIdAtPosition(objects, 1, 6)).toBe("(api -> db)[0]");
    expect(connectionIdAtPosition(objects, 2, 1)).toBeNull();
  });
});
