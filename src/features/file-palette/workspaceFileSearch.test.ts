import { describe, expect, it } from "vitest";
import type { WorkspaceFileEntry } from "../../types";
import {
  filterWorkspaceFiles,
  normalizeWorkspaceFileQuery,
  workspaceFileMatchScore,
  workspaceFileResultLimit,
} from "./workspaceFileSearch";

const file = (relativePath: string): WorkspaceFileEntry => {
  const parts = relativePath.split("/");
  const fileName = parts[parts.length - 1] ?? relativePath;
  return {
    path: `/workspace/${relativePath}`,
    relativePath,
    fileName,
    directory: parts.slice(0, -1).join("/"),
  };
};

describe("workspaceFileSearch", () => {
  it("normalizes whitespace and case before matching", () => {
    expect(normalizeWorkspaceFileQuery("  Diagrams API  ")).toBe("diagrams api");
    expect(filterWorkspaceFiles([file("diagrams/api.d2")], "  DIAGRAMS API  ")).toEqual([
      file("diagrams/api.d2"),
    ]);
  });

  it("scores exact and filename prefix matches ahead of longer path matches", () => {
    const files = [
      file("docs/api-reference.d2"),
      file("nested/service/api.d2"),
      file("api.d2"),
      file("api-extra.d2"),
    ];

    expect(filterWorkspaceFiles(files, "api").map((entry) => entry.relativePath)).toEqual([
      "api.d2",
      "api-extra.d2",
      "docs/api-reference.d2",
      "nested/service/api.d2",
    ]);
    expect(workspaceFileMatchScore(file("api.d2"), "api.d2")).toBeLessThan(
      workspaceFileMatchScore(file("nested/api.d2"), "api.d2"),
    );
  });

  it("requires every query token and uses relative path as a stable tie-breaker", () => {
    const files = [
      file("z/service/api.d2"),
      file("a/service/api.d2"),
      file("a/service/db.d2"),
      file("service-api.d2"),
    ];

    expect(filterWorkspaceFiles(files, "service api").map((entry) => entry.relativePath)).toEqual([
      "service-api.d2",
      "a/service/api.d2",
      "z/service/api.d2",
    ]);
  });

  it("limits results to the workspace file palette cap", () => {
    const files = Array.from({ length: workspaceFileResultLimit + 5 }, (_, index) =>
      file(`diagram-${String(index).padStart(3, "0")}.d2`),
    );

    expect(filterWorkspaceFiles(files, "diagram")).toHaveLength(workspaceFileResultLimit);
  });
});
