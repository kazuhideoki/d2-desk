import { describe, expect, it } from "vitest";
import type { CompileResult, SourceRange } from "../../types";
import { objectIdAtPosition, sourceRangeContains } from "./sourceRanges";

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
});
