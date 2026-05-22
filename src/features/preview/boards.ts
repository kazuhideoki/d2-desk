import type { D2Board } from "../../types";

export function boardPathKey(path: string[]) {
  return JSON.stringify(path);
}

export function boardDisplayName(board: D2Board) {
  if (board.kind === "root") return "Root";
  const kindLabel = board.kind[0]?.toUpperCase() + board.kind.slice(1);
  return `${kindLabel} / ${board.label || board.name}`;
}

export function boardOptionLabel(board: D2Board) {
  if (board.kind === "root") return "Root";
  const indent = board.depth > 1 ? `${"  ".repeat(board.depth - 1)}` : "";
  return `${indent}${boardDisplayName(board)}`;
}

export function adjacentBoardPath(
  boards: D2Board[] | undefined,
  selectedBoardPath: string[],
  direction: -1 | 1,
) {
  if (!boards || boards.length <= 1) return null;

  const selectedKey = boardPathKey(selectedBoardPath);
  const selectedIndex = boards.findIndex((board) => boardPathKey(board.path) === selectedKey);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const nextIndex = (currentIndex + direction + boards.length) % boards.length;
  return boards[nextIndex]?.path ?? null;
}
