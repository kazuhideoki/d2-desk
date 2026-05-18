import { invoke } from "@tauri-apps/api/core";
import type * as Monaco from "monaco-editor";
import type { D2CompletionItem } from "./types";

const d2ValueCompletionPattern =
  /(?:^|[{\s;])(?:[\w"'-]+(?:\.[\w-]+)*\.)?[\w-]+(?:\.[\w-]+)*\s*:\s*([\w-]*)$/;

let didRegisterD2Completions = false;

type D2CompletionContext = {
  kind: "key" | "value";
  typedText: string;
};

export function configureD2Language(monaco: typeof Monaco) {
  monaco.languages.register({ id: "d2" });
  monaco.languages.setLanguageConfiguration("d2", {
    comments: {
      lineComment: "#",
    },
    brackets: [["{", "}"]],
    autoClosingPairs: [{ open: "{", close: "}", notIn: ["string", "comment"] }],
    surroundingPairs: [{ open: "{", close: "}" }],
  });
  monaco.languages.setMonarchTokensProvider("d2", {
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/".*?"/, "string"],
        [/'.*?'/, "string"],
        [/(->|--)/, "keyword"],
        [/\b(direction|shape|style|fill|stroke|icon|label|tooltip|near)\b/, "type"],
        [/[{}:]/, "delimiter"],
      ],
    },
  });
  if (!didRegisterD2Completions) {
    didRegisterD2Completions = true;
    monaco.languages.registerCompletionItemProvider("d2", {
      triggerCharacters: [":", " ", ".", "d", "s"],
      async provideCompletionItems(model, position) {
        const lineContent = model.getLineContent(position.lineNumber);
        if (isD2LineCommentPosition(lineContent, position.column)) {
          return { suggestions: [] };
        }

        const completionContext = getD2CompletionContext(lineContent, position.column);
        if (!completionContext) {
          return { suggestions: [] };
        }

        const lineSuffix = lineContent.slice(position.column - 1);
        const remainingTextMatch =
          completionContext.kind === "key"
            ? lineSuffix.match(/^[\w-]*(?:\s*:\s*)?/)
            : lineSuffix.match(/^[\w-]*/);
        const remainingText = remainingTextMatch ? remainingTextMatch[0] : "";
        const replacementRange = {
          startLineNumber: position.lineNumber,
          startColumn: position.column - completionContext.typedText.length,
          endLineNumber: position.lineNumber,
          endColumn: position.column + remainingText.length,
        };

        let completions: D2CompletionItem[];
        try {
          completions = await invoke<D2CompletionItem[]>("sidecar_call", {
            method: "complete",
            params: {
              source: model.getValue(),
              line: position.lineNumber - 1,
              column: position.column - 1,
            },
          });
        } catch {
          completions = [];
        }

        return {
          suggestions: completions.map((completion) => ({
            label: completion.label,
            kind: d2CompletionKindToMonaco(monaco, completion.kind),
            insertText: completion.insertText || completion.label,
            detail: completion.detail ? `D2 ${completion.detail}` : "D2 completion",
            range: replacementRange,
            ...(completionContext.kind === "key"
              ? {
                  command: {
                    id: "editor.action.triggerSuggest",
                    title: "Trigger value suggestions",
                  },
                }
              : {}),
          })),
        };
      },
    });
  }
  monaco.editor.defineTheme("d2-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "d4d4d4" },
      { token: "comment", foreground: "6a9955" },
      { token: "keyword", foreground: "4fc1ff" },
      { token: "type", foreground: "4ec9b0" },
      { token: "string", foreground: "ce9178" },
      { token: "delimiter", foreground: "d4d4d4" },
    ],
    colors: {
      "editor.background": "#1e1e1e",
      "editor.foreground": "#d4d4d4",
      "editorLineNumber.foreground": "#858585",
      "editorCursor.foreground": "#f8fafc",
    },
  });
}

export function isD2LineCommentPosition(lineContent: string, column: number) {
  let quote: '"' | "'" | null = null;
  const linePrefix = lineContent.slice(0, Math.max(0, column - 1));

  for (let index = 0; index < linePrefix.length; index += 1) {
    const character = linePrefix[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "#") {
      return true;
    }
    if (character === '"' || character === "'") {
      quote = character;
    }
  }

  return false;
}

export function getD2CompletionContext(
  lineContent: string,
  column: number,
): D2CompletionContext | null {
  const linePrefix = lineContent.slice(0, Math.max(0, column - 1));
  const valueMatch = linePrefix.match(d2ValueCompletionPattern);
  if (valueMatch) {
    const typedValue = valueMatch[1];
    if (typedValue === undefined) return null;
    return { kind: "value", typedText: typedValue };
  }

  const keyMatch = linePrefix.match(/[\w-]*$/);
  if (!keyMatch) return null;

  const typedKey = keyMatch[0];
  const isDotKeyCompletion = linePrefix.trimEnd().endsWith(".");
  if (!typedKey && !isDotKeyCompletion) return null;

  const tokenStart = linePrefix.length - typedKey.length;
  const tokenPrefix = linePrefix.slice(0, tokenStart);
  if (!isD2KeyCompletionBoundary(tokenPrefix)) return null;

  return { kind: "key", typedText: typedKey };
}

function d2CompletionKindToMonaco(monaco: typeof Monaco, kind: D2CompletionItem["kind"]) {
  switch (kind) {
    case "shape":
      return monaco.languages.CompletionItemKind.EnumMember;
    case "style":
      return monaco.languages.CompletionItemKind.Property;
    default:
      return monaco.languages.CompletionItemKind.EnumMember;
  }
}

function isD2KeyCompletionBoundary(prefix: string) {
  const trimmedPrefix = prefix.trimEnd();
  if (!trimmedPrefix) return true;
  if (trimmedPrefix.endsWith(":") || trimmedPrefix.endsWith("->")) return false;

  const lastCharacter = trimmedPrefix[trimmedPrefix.length - 1];
  return lastCharacter === "{" || lastCharacter === ";" || lastCharacter === ".";
}
