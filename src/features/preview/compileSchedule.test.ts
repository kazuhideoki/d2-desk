import { describe, expect, it } from "vitest";
import { getPreviewCompileDelayMs } from "./compileSchedule";

describe("getPreviewCompileDelayMs", () => {
  const delays = {
    editDelayMs: 600,
    tabSwitchDelayMs: 140,
  };

  it("uses the short deferred delay when the active tab changes", () => {
    expect(
      getPreviewCompileDelayMs({
        ...delays,
        tabChanged: true,
        boardChanged: false,
      }),
    ).toBe(140);
  });

  it("keeps explicit board changes immediate", () => {
    expect(
      getPreviewCompileDelayMs({
        ...delays,
        tabChanged: false,
        boardChanged: true,
      }),
    ).toBe(0);
  });

  it("uses the edit debounce when source changes inside the same tab and board", () => {
    expect(
      getPreviewCompileDelayMs({
        ...delays,
        tabChanged: false,
        boardChanged: false,
      }),
    ).toBe(600);
  });
});
