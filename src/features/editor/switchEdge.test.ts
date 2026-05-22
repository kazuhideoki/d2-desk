import { describe, expect, it } from "vitest";
import type { D2Object, SourceRange } from "../../types";
import { findSwitchableEdge, switchEdgeDirectionInSource } from "./switchEdge";

const range = (startColumn: number, endColumn: number): SourceRange => ({
  file: "main.d2",
  startLine: 1,
  startColumn,
  endLine: 1,
  endColumn,
});

function edge(operatorStartColumn: number, scopeEndColumn: number): D2Object {
  return {
    id: "api -> db",
    kind: "connection",
    src: "api",
    dst: "db",
    sourceRanges: [range(operatorStartColumn, operatorStartColumn + 2), range(1, scopeEndColumn)],
    preview: {},
  };
}

describe("switchEdgeDirectionInSource", () => {
  it("swaps endpoints and flips -> to <- without changing the edge meaning", () => {
    const result = switchEdgeDirectionInSource("api -> db\n", edge(5, 10));

    expect(result).toEqual({
      ok: true,
      source: "db <- api\n",
      cursorPosition: { lineNumber: 1, column: 4 },
    });
  });

  it("swaps endpoints and flips <- to ->", () => {
    const result = switchEdgeDirectionInSource("db <- api\n", edge(4, 10));

    expect(result).toEqual({
      ok: true,
      source: "api -> db\n",
      cursorPosition: { lineNumber: 1, column: 5 },
    });
  });

  it("can switch the same edge back when called with refreshed ranges", () => {
    const first = switchEdgeDirectionInSource("api -> db\n", edge(5, 10));
    expect(first).toEqual({
      ok: true,
      source: "db <- api\n",
      cursorPosition: { lineNumber: 1, column: 4 },
    });
    if (!first.ok) throw new Error(first.reason);

    const second = switchEdgeDirectionInSource(first.source, {
      ...edge(4, 10),
      sourceRanges: [range(4, 6), range(1, 10)],
    });
    expect(second).toEqual({
      ok: true,
      source: "api -> db\n",
      cursorPosition: { lineNumber: 1, column: 5 },
    });
  });

  it("keeps labels, indentation, trailing comments, and mirrored operator spacing", () => {
    const result = switchEdgeDirectionInSource("  api   ->    db: calls # comment\n", {
      ...edge(9, 27),
      sourceRanges: [range(9, 11), range(3, 25)],
    });

    expect(result).toEqual({
      ok: true,
      source: "  db    <-   api: calls # comment\n",
      cursorPosition: { lineNumber: 1, column: 9 },
    });
  });

  it("rejects undirected and bidirectional edges", () => {
    expect(switchEdgeDirectionInSource("api -- db\n", edge(5, 10))).toEqual({
      ok: false,
      reason: "Switch Edge supports -> and <- edges only",
    });
    expect(
      switchEdgeDirectionInSource("api <-> db\n", {
        ...edge(5, 11),
        sourceRanges: [range(5, 8), range(1, 11)],
      }),
    ).toEqual({
      ok: false,
      reason: "Switch Edge supports -> and <- edges only",
    });
  });

  it("rejects chained edge statements", () => {
    expect(switchEdgeDirectionInSource("api -> db -> cache\n", edge(5, 19))).toEqual({
      ok: false,
      reason: "Switch Edge supports a single edge statement",
    });
  });
});

describe("findSwitchableEdge", () => {
  it("falls back to the cursor edge when the preferred edge id is stale", () => {
    const stalePreferredEdge = {
      ...edge(5, 10),
      id: "(api -> db)[0]",
    };
    const currentEdge = {
      ...edge(4, 10),
      id: "(db <- api)[0]",
    };
    const api = {
      ...edge(1, 4),
      id: "api",
      kind: "shape" as const,
    };

    expect(findSwitchableEdge([currentEdge, api], stalePreferredEdge.id, currentEdge.id)).toBe(
      currentEdge,
    );
  });
});
