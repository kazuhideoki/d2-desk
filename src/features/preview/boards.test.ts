import { describe, expect, it } from "vitest";
import type { D2Board } from "../../types";
import { adjacentBoardPath, boardDisplayName, boardOptionLabel } from "./boards";

const boards: D2Board[] = [
  { path: [], kind: "root", name: "root", label: "", depth: 0 },
  { path: ["layers", "one"], kind: "layers", name: "one", label: "Layer One", depth: 1 },
  { path: ["layers", "one", "steps", "two"], kind: "steps", name: "two", label: "", depth: 2 },
];

describe("preview boards", () => {
  it("moves between board paths with wraparound", () => {
    expect(adjacentBoardPath(boards, [], 1)).toEqual(["layers", "one"]);
    expect(adjacentBoardPath(boards, ["layers", "one"], -1)).toEqual([]);
    expect(adjacentBoardPath(boards, ["layers", "one", "steps", "two"], 1)).toEqual([]);
  });

  it("falls back to root when the selected board is missing", () => {
    expect(adjacentBoardPath(boards, ["missing"], 1)).toEqual(["layers", "one"]);
  });

  it("does not move when there is no alternate board", () => {
    expect(adjacentBoardPath([boards[0]], [], 1)).toBeNull();
    expect(adjacentBoardPath(undefined, [], -1)).toBeNull();
  });

  it("formats board names for commands and select options", () => {
    expect(boardDisplayName(boards[0])).toBe("Root");
    expect(boardDisplayName(boards[1])).toBe("Layers / Layer One");
    expect(boardOptionLabel(boards[2])).toBe("  Steps / two");
  });
});
