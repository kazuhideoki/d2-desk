import { describe, expect, it } from "vitest";
import { nextPreviewSearchIndex, previewTextMatches } from "./previewSearch";

describe("preview search", () => {
  it("matches preview text case-insensitively", () => {
    expect(previewTextMatches("Customer API", "api")).toBe(true);
    expect(previewTextMatches("Customer API", "worker")).toBe(false);
    expect(previewTextMatches(null, "api")).toBe(false);
    expect(previewTextMatches("Customer API", "")).toBe(false);
  });

  it("moves through matches and wraps in both directions", () => {
    expect(nextPreviewSearchIndex(0, 3, "next")).toBe(1);
    expect(nextPreviewSearchIndex(2, 3, "next")).toBe(0);
    expect(nextPreviewSearchIndex(0, 3, "previous")).toBe(2);
    expect(nextPreviewSearchIndex(2, 3, "previous")).toBe(1);
    expect(nextPreviewSearchIndex(0, 0, "next")).toBe(-1);
  });
});
