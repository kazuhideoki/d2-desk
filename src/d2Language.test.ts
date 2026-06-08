import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  configureD2Language,
  encodeD2SemanticTokens,
  getD2CompletionContext,
  getD2CompletionReplacementRanges,
  isD2LineCommentPosition,
  sourceRangeToMonacoRange,
} from "./d2Language";

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

  it("keeps connection label delimiters outside node completion replacement ranges", () => {
    const lineContent = "con -> cloud.: 測地系モード変換";
    const column = "con -> cloud.".length + 1;
    const completionContext = getD2CompletionContext(lineContent, column);

    expect(completionContext).toEqual({ kind: "key", typedText: "" });
    expect(getD2CompletionReplacementRanges(lineContent, 1, column, completionContext!)).toEqual({
      token: {
        startLineNumber: 1,
        startColumn: column,
        endLineNumber: 1,
        endColumn: column,
      },
      keyWithExistingDelimiter: {
        startLineNumber: 1,
        startColumn: column,
        endLineNumber: 1,
        endColumn: column + ": ".length,
      },
    });
  });

  it("preserves local fallback child node completion insert text and label delimiters", async () => {
    const providers: Array<{
      provideCompletionItems: (model: unknown, position: { lineNumber: number; column: number }) => Promise<{
        suggestions: Array<{ insertText: string; label: string | { label: string } }>;
      }>;
    }> = [];
    const monaco = {
      languages: {
        CompletionItemKind: { Color: 1, File: 2, EnumMember: 3, Property: 4 },
        register: vi.fn(),
        setLanguageConfiguration: vi.fn(),
        setMonarchTokensProvider: vi.fn(),
        registerDocumentSemanticTokensProvider: vi.fn(),
        registerSelectionRangeProvider: vi.fn(),
        registerCompletionItemProvider: vi.fn((_language: string, provider) => {
          providers.push(provider);
        }),
      },
      editor: {
        defineTheme: vi.fn(),
      },
    };
    const source = `status: {
  hoge tnse
}
status.`;
    vi.mocked(invoke).mockRejectedValue(new Error("sidecar unavailable"));

    configureD2Language(monaco as never);
    const result = await providers[0].provideCompletionItems(
      {
        getLineContent: (lineNumber: number) => source.split("\n")[lineNumber - 1],
        getValue: () => source,
      },
      { lineNumber: 4, column: "status.".length + 1 },
    );

    expect(result.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ insertText: "hoge tnse" }),
      ]),
    );
    expect(result.suggestions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ insertText: "tnse" }),
      ]),
    );

    const connectionSource = `cloud: {
  iot
}
con -> cloud.: 測地系モード変換`;
    const connectionColumn = "con -> cloud.".length + 1;
    const connectionResult = await providers[0].provideCompletionItems(
      {
        getLineContent: (lineNumber: number) => connectionSource.split("\n")[lineNumber - 1],
        getValue: () => connectionSource,
      },
      { lineNumber: 4, column: connectionColumn },
    );

    expect(connectionResult.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          insertText: "iot",
          range: {
            startLineNumber: 4,
            startColumn: connectionColumn,
            endLineNumber: 4,
            endColumn: connectionColumn,
          },
        }),
      ]),
    );
  });

  it("encodes D2 semantic tokens using Monaco delta positions", () => {
    const encoded = encodeD2SemanticTokens([
      {
        tokenType: "boolean",
        sourceRange: { file: "main.d2", startLine: 3, startColumn: 5, endLine: 3, endColumn: 10 },
      },
      {
        tokenType: "boolean",
        sourceRange: { file: "main.d2", startLine: 1, startColumn: 8, endLine: 1, endColumn: 12 },
      },
    ]);

    expect([...encoded]).toEqual([
      0, 7, 4, 0, 0,
      2, 4, 5, 0, 0,
    ]);
  });

  it("maps D2 source ranges to Monaco ranges", () => {
    expect(
      sourceRangeToMonacoRange({
        file: "main.d2",
        startLine: 2,
        startColumn: 3,
        endLine: 4,
        endColumn: 5,
      }),
    ).toEqual({
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 4,
      endColumn: 5,
    });
  });
});
