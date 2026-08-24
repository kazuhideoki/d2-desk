import { describe, expect, it } from "vitest";
import { parseD2DeskDeepLink } from "./deepLinks";

describe("parseD2DeskDeepLink", () => {
  it("reads the decoded file path from an open URL", () => {
    expect(
      parseD2DeskDeepLink(
        "d2desk://open?file=%2FUsers%2Foki%2Fdiagrams%2Fsystem%20overview.d2",
        "d2desk",
      ),
    ).toEqual({ filePath: "/Users/oki/diagrams/system overview.d2" });
  });

  it("accepts an isolated development app scheme", () => {
    expect(
      parseD2DeskDeepLink(
        "d2desk-d2-desk-a495e3://open?file=%2Ftmp%2Fdiagram.d2",
        "d2desk-d2-desk-a495e3",
      ),
    ).toEqual({ filePath: "/tmp/diagram.d2" });
  });

  it("rejects a URL for a different D2 Desk app scheme", () => {
    expect(() =>
      parseD2DeskDeepLink(
        "d2desk-other-worktree://open?file=%2Ftmp%2Fdiagram.d2",
        "d2desk-current-worktree",
      ),
    ).toThrow("Unsupported D2 Desk URL");
  });

  it.each([
    "https://open?file=%2Ftmp%2Fdiagram.d2",
    "d2desk://settings?file=%2Ftmp%2Fdiagram.d2",
    "d2desk://open/nested?file=%2Ftmp%2Fdiagram.d2",
    "d2desk://open",
    "d2desk://open?file=",
    "d2desk://open?file=%2Ftmp%2Fone.d2&file=%2Ftmp%2Ftwo.d2",
    "d2desk://open?file=%2Ftmp%2Fdiagram.d2&unexpected=true",
    "not a URL",
  ])("rejects unsupported or ambiguous URLs: %s", (url) => {
    expect(() => parseD2DeskDeepLink(url, "d2desk")).toThrow();
  });
});
