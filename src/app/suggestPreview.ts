import type * as Monaco from "monaco-editor";
import type { CompileResult, D2CompletionItem } from "../types";

export const maxSuggestPreviewCacheEntries = 50;

export function completionPreviewSource(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  completion: Monaco.languages.CompletionItem,
) {
  if (
    completion.insertTextRules &&
    completion.insertTextRules & monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
  ) {
    return null;
  }
  if (completion.additionalTextEdits?.length) {
    return null;
  }

  const completionRange =
    "replace" in completion.range ? completion.range.replace : completion.range;
  const range = model.validateRange(completionRange);
  const source = model.getValue();
  const startOffset = model.getOffsetAt({
    lineNumber: range.startLineNumber,
    column: range.startColumn,
  });
  const endOffset = model.getOffsetAt({
    lineNumber: range.endLineNumber,
    column: range.endColumn,
  });

  return `${source.slice(0, startOffset)}${completion.insertText}${source.slice(endOffset)}`;
}

export function previewSourceWithInsertText(
  model: Monaco.editor.ITextModel,
  range: Monaco.IRange,
  insertText: string,
) {
  const validatedRange = model.validateRange(range);
  const source = model.getValue();
  const startOffset = model.getOffsetAt({
    lineNumber: validatedRange.startLineNumber,
    column: validatedRange.startColumn,
  });
  const endOffset = model.getOffsetAt({
    lineNumber: validatedRange.endLineNumber,
    column: validatedRange.endColumn,
  });
  return `${source.slice(0, startOffset)}${insertText}${source.slice(endOffset)}`;
}

export function isD2IconValueCompletionPosition(lineContent: string, column: number) {
  const linePrefix = lineContent.slice(0, Math.max(0, column - 1));
  return /(?:^|[{\s;])(?:[\w"'-]+(?:\.[\w-]+)*\.)?icon\s*:\s*[\w-]*$/.test(linePrefix);
}

export function pickD2IconCompletion(completions: D2CompletionItem[], typedText: string) {
  const typed = typedText.toLowerCase();
  const iconCompletions = completions
    .filter((completion) => completion.kind === "icon")
    .filter((completion) => {
      if (!typed) return true;
      const searchable = `${completion.label} ${completion.filterText ?? ""}`.toLowerCase();
      return searchable.includes(typed);
    })
    .sort((left, right) => left.label.localeCompare(right.label));
  return iconCompletions[0] ?? null;
}

export function pickD2IconCompletionByLabel(completions: D2CompletionItem[], label: string) {
  return (
    completions.find(
      (completion) => completion.kind === "icon" && completion.label.toLowerCase() === label,
    ) ?? null
  );
}

export function monacoCompletionLabelText(completion: Monaco.languages.CompletionItem) {
  return typeof completion.label === "string" ? completion.label : completion.label.label;
}

export function suggestPreviewCacheKey(params: unknown) {
  return JSON.stringify(params);
}

export function rememberSuggestPreview(
  cache: Map<string, CompileResult>,
  key: string,
  result: CompileResult,
) {
  cache.delete(key);
  cache.set(key, result);
  while (cache.size > maxSuggestPreviewCacheEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}
