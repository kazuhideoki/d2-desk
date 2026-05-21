import { describe, expect, it } from "vitest";
import type * as Monaco from "monaco-editor";
import type { CompileResult, D2CompletionItem } from "../../types";
import {
  completionPreviewSource,
  isD2IconValueCompletionPosition,
  maxSuggestPreviewCacheEntries,
  monacoCompletionLabelText,
  pickD2IconCompletion,
  pickD2IconCompletionByLabel,
  previewSourceWithInsertText,
  rememberSuggestPreview,
  suggestPreviewCacheKey,
} from "./suggestPreview";

const monaco = {
  languages: {
    CompletionItemInsertTextRule: {
      InsertAsSnippet: 4,
    },
  },
} as typeof Monaco;

function textModel(source: string) {
  const lines = source.split("\n");
  const lineStartOffsets = lines.reduce<number[]>((offsets, _line, index) => {
    const previous = offsets[index - 1] ?? 0;
    offsets.push(index === 0 ? 0 : previous + lines[index - 1].length + 1);
    return offsets;
  }, []);

  return {
    getValue: () => source,
    validateRange: (range: Monaco.IRange) => range,
    getOffsetAt: (position: Monaco.IPosition) =>
      lineStartOffsets[position.lineNumber - 1] + position.column - 1,
  } as Monaco.editor.ITextModel;
}

function completion(label: string, kind: D2CompletionItem["kind"], filterText?: string) {
  return {
    label,
    kind,
    detail: "",
    description: "",
    documentation: "",
    insertText: label,
    filterText,
  };
}

const compileResult = (svg: string): CompileResult => ({ svg, objects: [], diagnostics: [] });

describe("suggestPreview", () => {
  it("builds preview source from completion ranges and direct insert ranges", () => {
    const model = textModel("api: rect\n");
    const range = {
      startLineNumber: 1,
      startColumn: 6,
      endLineNumber: 1,
      endColumn: 10,
    };

    expect(
      completionPreviewSource(monaco, model, {
        label: "rectangle",
        kind: 1,
        insertText: "rectangle",
        range,
      } as Monaco.languages.CompletionItem),
    ).toBe("api: rectangle\n");
    expect(previewSourceWithInsertText(model, range, "hexagon")).toBe("api: hexagon\n");
  });

  it("skips snippet and additional-edit completions", () => {
    const model = textModel("api: rec");
    const range = {
      startLineNumber: 1,
      startColumn: 6,
      endLineNumber: 1,
      endColumn: 9,
    };

    expect(
      completionPreviewSource(monaco, model, {
        label: "snippet",
        kind: 1,
        insertText: "${1:value}",
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
      } as Monaco.languages.CompletionItem),
    ).toBeNull();
    expect(
      completionPreviewSource(monaco, model, {
        label: "edit",
        kind: 1,
        insertText: "value",
        additionalTextEdits: [{ range, text: "value" }],
        range,
      } as unknown as Monaco.languages.CompletionItem),
    ).toBeNull();
  });

  it("detects D2 icon value completion positions", () => {
    expect(isD2IconValueCompletionPosition("api.icon: aws-", "api.icon: aws-".length + 1)).toBe(
      true,
    );
    expect(isD2IconValueCompletionPosition("icon: ", "icon: ".length + 1)).toBe(true);
    expect(isD2IconValueCompletionPosition("api.shape: rec", "api.shape: rec".length + 1)).toBe(
      false,
    );
  });

  it("picks icon completions by typed text and exact label", () => {
    const completions: D2CompletionItem[] = [
      completion("aws.ec2", "icon", "compute"),
      completion("azure.vm", "icon", "compute"),
      completion("shape", "keyword"),
    ];

    expect(pickD2IconCompletion(completions, "compute")?.label).toBe("aws.ec2");
    expect(pickD2IconCompletion(completions, "azure")?.label).toBe("azure.vm");
    expect(pickD2IconCompletionByLabel(completions, "aws.ec2")?.label).toBe("aws.ec2");
    expect(pickD2IconCompletionByLabel(completions, "missing")).toBeNull();
  });

  it("normalizes Monaco completion labels", () => {
    expect(monacoCompletionLabelText({ label: "shape" } as Monaco.languages.CompletionItem)).toBe(
      "shape",
    );
    expect(
      monacoCompletionLabelText({
        label: { label: "rectangle", detail: "shape" },
      } as Monaco.languages.CompletionItem),
    ).toBe("rectangle");
  });

  it("uses JSON cache keys and keeps the suggest preview cache bounded as LRU", () => {
    expect(suggestPreviewCacheKey({ source: "a -> b" })).toBe('{"source":"a -> b"}');

    const cache = new Map<string, CompileResult>();
    for (let index = 0; index < maxSuggestPreviewCacheEntries + 2; index += 1) {
      rememberSuggestPreview(cache, `key-${index}`, compileResult(`<svg>${index}</svg>`));
    }
    rememberSuggestPreview(cache, "key-2", compileResult("<svg>refreshed</svg>"));

    expect(cache.size).toBe(maxSuggestPreviewCacheEntries);
    expect(cache.has("key-0")).toBe(false);
    expect(cache.has("key-1")).toBe(false);
    const keys = Array.from(cache.keys());
    expect(keys[keys.length - 1]).toBe("key-2");
  });
});
