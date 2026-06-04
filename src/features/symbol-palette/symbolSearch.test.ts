import { describe, expect, it } from "vitest";
import { buildD2SymbolEntries, filterD2Symbols } from "./symbolSearch";

describe("symbolSearch", () => {
  it("builds and filters D2 symbol entries from object source ranges", () => {
    const symbols = buildD2SymbolEntries([
      {
        id: "container.api",
        kind: "shape",
        label: "API",
        sourceRanges: [{ file: "main.d2", startLine: 3, startColumn: 5, endLine: 3, endColumn: 8 }],
        preview: {},
      },
      {
        id: "api -> db",
        kind: "connection",
        src: "api",
        dst: "db",
        sourceRanges: [{ file: "main.d2", startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 }],
        preview: {},
      },
      {
        id: "external",
        kind: "shape",
        sourceRanges: [],
        preview: {},
      },
    ]);

    expect(symbols.map((symbol) => symbol.name)).toEqual(["api -> db", "api"]);
    expect(symbols[0]).toMatchObject({
      id: "api -> db",
      detail: "api -> db",
    });
    expect(symbols[1]).toMatchObject({
      id: "container.api",
      detail: "container.api - API",
      line: 3,
      column: 5,
    });
    expect(filterD2Symbols(symbols, "shape api").map((symbol) => symbol.id)).toEqual([
      "container.api",
    ]);
  });

  it("keeps connection labels searchable", () => {
    const symbols = buildD2SymbolEntries([
      {
        id: "device.runtime -> collect.api",
        kind: "connection",
        label: "Track + image upload",
        src: "device.runtime",
        dst: "collect.api",
        sourceRanges: [
          { file: "main.d2", startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        ],
        preview: {},
      },
    ]);

    expect(symbols[0]).toMatchObject({
      name: "device.runtime -> collect.api",
      detail: "device.runtime -> collect.api - Track + image upload",
    });
    expect(filterD2Symbols(symbols, "runtime upload").map((symbol) => symbol.id)).toEqual([
      "device.runtime -> collect.api",
    ]);
  });
});
