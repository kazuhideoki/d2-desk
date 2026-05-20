import { describe, expect, it, vi } from "vitest";
import { getD2CompletionContext, isD2LineCommentPosition } from "./d2Language";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("d2Language", () => {
  it("detects comments only outside quoted strings", () => {
    expect(isD2LineCommentPosition("api: value # comment", 14)).toBe(true);
    expect(isD2LineCommentPosition('api: "not # comment"', 13)).toBe(false);
    expect(isD2LineCommentPosition("api: 'not # comment'", 13)).toBe(false);
    expect(isD2LineCommentPosition('api: "escaped \\" # still string"', 20)).toBe(false);
  });

  it("detects D2 value completion contexts", () => {
    expect(getD2CompletionContext("direction: ri", "direction: ri".length + 1)).toEqual({
      kind: "value",
      typedText: "ri",
    });
    expect(getD2CompletionContext("api.style.fill: ", "api.style.fill: ".length + 1)).toEqual({
      kind: "value",
      typedText: "",
    });
  });

  it("detects key completion contexts at valid D2 boundaries", () => {
    expect(getD2CompletionContext("api -> da", "api -> da".length + 1)).toEqual({
      kind: "key",
      typedText: "da",
    });
    expect(getD2CompletionContext("container.", "container.".length + 1)).toEqual({
      kind: "key",
      typedText: "",
    });
    expect(getD2CompletionContext("shape: rec", "shape: rec".length + 1)).toEqual({
      kind: "value",
      typedText: "rec",
    });
  });

  it("detects file and imported-node completion contexts", () => {
    expect(getD2CompletionContext("@diagrams/serv", "@diagrams/serv".length + 1)).toEqual({
      kind: "import-file",
      typedText: "diagrams/serv",
    });
    expect(getD2CompletionContext("@./shared/serv", "@./shared/serv".length + 1)).toEqual({
      kind: "import-file",
      typedText: "./shared/serv",
    });
    expect(getD2CompletionContext("@../shared/serv", "@../shared/serv".length + 1)).toEqual({
      kind: "import-file",
      typedText: "../shared/serv",
    });
    expect(getD2CompletionContext("@diagrams/service.ap", "@diagrams/service.ap".length + 1)).toEqual({
      kind: "import-node",
      typedText: "ap",
      importPath: "diagrams/service",
      parentPath: [],
    });
    expect(getD2CompletionContext("@../shared/service.api", "@../shared/service.api".length + 1)).toEqual({
      kind: "import-node",
      typedText: "api",
      importPath: "../shared/service",
      parentPath: [],
    });
    expect(
      getD2CompletionContext("@diagrams/service.api.h", "@diagrams/service.api.h".length + 1),
    ).toEqual({
      kind: "import-node",
      typedText: "h",
      importPath: "diagrams/service",
      parentPath: ["api"],
    });
  });

  it("ignores invalid import and key completion positions", () => {
    expect(getD2CompletionContext("email@example", "email@example".length + 1)).toBeNull();
    expect(getD2CompletionContext("shape rec", "shape rec".length + 1)).toBeNull();
    expect(getD2CompletionContext("", 1)).toBeNull();
  });
});
