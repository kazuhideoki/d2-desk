import { describe, expect, it } from "vitest";
import type { D2Object, SourceRange } from "../../types";
import { toggleNestingNotationInSource } from "./toggleNestingNotation";

const range = (
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): SourceRange => ({
  file: "main.d2",
  startLine,
  startColumn,
  endLine,
  endColumn,
});

const shape = (id: string, sourceRanges: SourceRange[]): D2Object => ({
  id,
  kind: "shape",
  sourceRanges,
  preview: {},
});

describe("toggleNestingNotationInSource", () => {
  it("collapses a single child block into dot notation", () => {
    const source = "hoge: {\n  fuga\n}\n";
    const parent = shape("hoge", [range(1, 1, 1, 5), range(1, 1, 3, 2)]);
    const child = shape("hoge.fuga", [range(2, 3, 2, 7)]);

    expect(toggleNestingNotationInSource(source, child, [parent, child])).toEqual({
      ok: true,
      source: "hoge.fuga\n",
      cursorPosition: { lineNumber: 1, column: 10 },
    });
  });

  it("expands dot notation into a nested block", () => {
    const source = "hoge.fuga\n";
    const child = shape("hoge.fuga", [range(1, 1, 1, 10)]);

    expect(toggleNestingNotationInSource(source, child, [child])).toEqual({
      ok: true,
      source: "hoge: {\n  fuga\n}\n",
      cursorPosition: { lineNumber: 1, column: 6 },
    });
  });

  it("expands dot notation when the virtual parent is selected in the preview", () => {
    const source = "hoge.fuga\n";
    const parent = shape("hoge", []);
    const child = shape("hoge.fuga", [range(1, 1, 1, 10)]);

    expect(toggleNestingNotationInSource(source, parent, [parent, child])).toEqual({
      ok: true,
      source: "hoge: {\n  fuga\n}\n",
      cursorPosition: { lineNumber: 1, column: 6 },
    });
  });

  it("does not expand a virtual parent with multiple direct dot children", () => {
    const source = "hoge.fuga\nhoge.piyo\n";
    const parent = shape("hoge", []);
    const firstChild = shape("hoge.fuga", [range(1, 1, 1, 10)]);
    const secondChild = shape("hoge.piyo", [range(2, 1, 2, 10)]);

    expect(toggleNestingNotationInSource(source, parent, [parent, firstChild, secondChild])).toEqual(
      {
        ok: false,
        reason: "Select a nested node to toggle notation",
      },
    );
  });

  it("collapses a parent selection when it has one direct child", () => {
    const source = "hoge: {\n  fuga\n}\n";
    const parent = shape("hoge", [range(1, 1, 1, 5), range(1, 1, 3, 2)]);
    const child = shape("hoge.fuga", [range(2, 3, 2, 7)]);

    expect(toggleNestingNotationInSource(source, parent, [parent, child])).toEqual({
      ok: true,
      source: "hoge.fuga\n",
      cursorPosition: { lineNumber: 1, column: 10 },
    });
  });

  it("preserves labels while toggling both ways", () => {
    const nestedSource = "hoge: {\n  fuga: Fuga\n}\n";
    const parent = shape("hoge", [range(1, 1, 1, 5), range(1, 1, 3, 2)]);
    const nestedChild = shape("hoge.fuga", [range(2, 3, 2, 7), range(2, 3, 2, 13)]);

    expect(toggleNestingNotationInSource(nestedSource, nestedChild, [parent, nestedChild])).toEqual(
      {
        ok: true,
        source: "hoge.fuga: Fuga\n",
        cursorPosition: { lineNumber: 1, column: 10 },
      },
    );

    const dotSource = "hoge.fuga: Fuga\n";
    const dotChild = shape("hoge.fuga", [range(1, 1, 1, 10), range(1, 1, 1, 16)]);
    expect(toggleNestingNotationInSource(dotSource, dotChild, [dotChild])).toEqual({
      ok: true,
      source: "hoge: {\n  fuga: Fuga\n}\n",
      cursorPosition: { lineNumber: 1, column: 6 },
    });
  });

  it("deindents nested block contents when collapsing to dot notation", () => {
    const source = "hoge: {\n  fuga: {\n    style.fill: red\n  }\n}\n";
    const parent = shape("hoge", [range(1, 1, 1, 5), range(1, 1, 5, 2)]);
    const child = shape("hoge.fuga", [range(2, 3, 2, 7), range(2, 3, 4, 4)]);

    expect(toggleNestingNotationInSource(source, child, [parent, child])).toEqual({
      ok: true,
      source: "hoge.fuga: {\n  style.fill: red\n}\n",
      cursorPosition: { lineNumber: 1, column: 10 },
    });
  });

  it("indents block contents when expanding dot notation", () => {
    const source = "hoge.fuga: {\n  style.fill: red\n}\n";
    const child = shape("hoge.fuga", [range(1, 1, 1, 10), range(1, 1, 3, 2)]);

    expect(toggleNestingNotationInSource(source, child, [child])).toEqual({
      ok: true,
      source: "hoge: {\n  fuga: {\n    style.fill: red\n  }\n}\n",
      cursorPosition: { lineNumber: 1, column: 6 },
    });
  });

  it("merges dot notation back into an existing parent block", () => {
    const source = "s.i\ns: {\n  style: {\n    font-color: red\n  }\n}\n";
    const parent = shape("s", [range(2, 1, 2, 2), range(2, 1, 6, 2)]);
    const child = shape("s.i", [range(1, 1, 1, 4)]);

    expect(toggleNestingNotationInSource(source, child, [parent, child])).toEqual({
      ok: true,
      source: "s: {\n  i\n  style: {\n    font-color: red\n  }\n}\n",
      cursorPosition: { lineNumber: 1, column: 3 },
    });
  });

  it("moves the selected child out when the parent block has siblings", () => {
    const source = "hoge: {\n  fuga\n  piyo\n}\n";
    const parent = shape("hoge", [range(1, 1, 1, 5), range(1, 1, 4, 2)]);
    const child = shape("hoge.fuga", [range(2, 3, 2, 7)]);

    expect(toggleNestingNotationInSource(source, child, [parent, child])).toEqual({
      ok: true,
      source: "hoge.fuga\nhoge: {\n  piyo\n}\n",
      cursorPosition: { lineNumber: 1, column: 10 },
    });
  });
});
