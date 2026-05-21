import type { WorkspaceFileEntry } from "../types";

export const workspaceFileResultLimit = 120;

export function normalizeWorkspaceFileQuery(value: string) {
  return value.trim().toLowerCase();
}

export function workspaceFileMatchScore(file: WorkspaceFileEntry, query: string) {
  if (!query) return file.relativePath.length;

  const relativePath = file.relativePath.toLowerCase();
  const fileName = file.fileName.toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.some((token) => !relativePath.includes(token))) {
    return Number.POSITIVE_INFINITY;
  }

  let score = relativePath.length;
  if (relativePath === query) score -= 1000;
  if (fileName === query) score -= 900;
  if (fileName.startsWith(query)) score -= 700;
  if (relativePath.startsWith(query)) score -= 500;
  score += tokens.reduce((total, token) => total + relativePath.indexOf(token), 0);
  return score;
}

export function filterWorkspaceFiles(files: WorkspaceFileEntry[], query: string) {
  const normalizedQuery = normalizeWorkspaceFileQuery(query);
  return files
    .map((file) => ({ file, score: workspaceFileMatchScore(file, normalizedQuery) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) =>
      left.score === right.score
        ? left.file.relativePath.localeCompare(right.file.relativePath)
        : left.score - right.score,
    )
    .slice(0, workspaceFileResultLimit)
    .map((item) => item.file);
}
