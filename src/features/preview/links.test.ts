import { describe, expect, it } from "vitest";
import { resolvePreviewFileLink } from "./links";

describe("preview links", () => {
  it("resolves relative links from the active file directory", () => {
    expect(
      resolvePreviewFileLink("components/api.d2", {
        workspaceRootPath: "/workspace",
        currentFilePath: "/workspace/diagrams/main.d2",
      }),
    ).toBe("/workspace/diagrams/components/api.d2");
  });

  it("normalizes fragments, queries, and parent segments", () => {
    expect(
      resolvePreviewFileLink("../shared.d2#service", {
        workspaceRootPath: "/workspace",
        currentFilePath: "/workspace/diagrams/main.d2",
      }),
    ).toBe("/workspace/shared.d2");
    expect(
      resolvePreviewFileLink("./next.d2?board=one", {
        workspaceRootPath: "/workspace",
        currentFilePath: "/workspace/diagrams/main.d2",
      }),
    ).toBe("/workspace/diagrams/next.d2");
  });

  it("rejects external links and workspace escapes", () => {
    const context = {
      workspaceRootPath: "/workspace",
      currentFilePath: "/workspace/diagrams/main.d2",
    };

    expect(resolvePreviewFileLink("https://example.com", context)).toBeNull();
    expect(resolvePreviewFileLink("mailto:test@example.com", context)).toBeNull();
    expect(resolvePreviewFileLink("../../outside.d2", context)).toBeNull();
  });

  it("accepts absolute file URLs", () => {
    expect(
      resolvePreviewFileLink("file:///workspace/diagrams/main.d2", {
        workspaceRootPath: "/workspace",
        currentFilePath: null,
      }),
    ).toBe("/workspace/diagrams/main.d2");
  });
});
