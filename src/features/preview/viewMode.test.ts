import { describe, expect, it } from "vitest";
import { nextPreviewViewMode, previewViewModeStatus } from "./viewMode";

describe("preview view mode", () => {
  it("cycles split, preview-only, editor-only, then split", () => {
    expect(nextPreviewViewMode("split")).toBe("preview-only");
    expect(nextPreviewViewMode("preview-only")).toBe("editor-only");
    expect(nextPreviewViewMode("editor-only")).toBe("split");
  });

  it("describes each mode for status messages", () => {
    expect(previewViewModeStatus("split")).toBe("Editor and preview shown");
    expect(previewViewModeStatus("preview-only")).toBe("Preview only shown");
    expect(previewViewModeStatus("editor-only")).toBe("Editor only shown");
  });
});
