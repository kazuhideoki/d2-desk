import { invoke } from "@tauri-apps/api/core";
import type * as Monaco from "monaco-editor";
import type { D2CompletionItem } from "./types";

const d2ValueCompletionPattern =
  /(?:^|[{\s;])(?:[\w"'-]+(?:\.[\w-]+)*\.)?[\w-]+(?:\.[\w-]+)*\s*:\s*([\w-]*)$/;

let didRegisterD2Completions = false;
const d2CompletionTriggerCharacters = [
  ":",
  " ",
  ".",
  ..."-_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
];

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
        [/(<->|<-|->|--)/, "keyword"],
        [/\b(direction|shape|style|fill|stroke|icon|label|tooltip|near)\b/, "type"],
        [/[{}:]/, "delimiter"],
      ],
    },
  });
  if (!didRegisterD2Completions) {
    didRegisterD2Completions = true;
    monaco.languages.registerCompletionItemProvider("d2", {
      triggerCharacters: d2CompletionTriggerCharacters,
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
        if (completions.length === 0 && completionContext.kind === "key") {
          completions = getD2ChildNodeCompletions(model.getValue(), lineContent, position.column);
          if (completions.length === 0) {
            completions = getD2TopLevelNodeCompletions(
              model.getValue(),
              lineContent,
              position.column,
            );
          }
        }

        return {
          suggestions: completions.map((completion) => ({
            label: completion.description
              ? { label: completion.label, description: completion.description }
              : completion.label,
            kind: d2CompletionKindToMonaco(monaco, completion.kind),
            insertText: completion.insertText || completion.label,
            filterText: completion.label,
            sortText: completion.label,
            detail:
              completion.description ||
              (completion.detail ? `D2 ${completion.detail}` : "D2 completion"),
            documentation: completion.documentation
              ? { value: completion.documentation }
              : completion.detail
                ? { value: `D2 ${completion.detail}` }
                : undefined,
            range: replacementRange,
            ...(completionContext.kind === "key" && (completion.insertText || "").endsWith(": ")
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
  if (trimmedPrefix.endsWith(":")) return false;
  if (
    trimmedPrefix.endsWith("->") ||
    trimmedPrefix.endsWith("<-") ||
    trimmedPrefix.endsWith("--") ||
    trimmedPrefix.endsWith("<->")
  ) {
    return true;
  }

  const lastCharacter = trimmedPrefix[trimmedPrefix.length - 1];
  return lastCharacter === "{" || lastCharacter === ";" || lastCharacter === ".";
}

function getD2ChildNodeCompletions(
  source: string,
  lineContent: string,
  column: number,
): D2CompletionItem[] {
  const linePrefix = lineContent.slice(0, Math.max(0, column - 1));
  const typedChild = linePrefix.match(/[\w-]*$/)?.[0] ?? "";
  const parentPrefix = linePrefix.slice(0, linePrefix.length - typedChild.length).trimEnd();
  if (!parentPrefix.endsWith(".")) return [];

  const parentPath = extractD2Path(parentPrefix.slice(0, -1));
  if (parentPath.length === 0) return [];

  const children = collectD2ChildNodes(source);
  const labels = children.get(parentPath.join("\0")) ?? [];
  const completions: D2CompletionItem[] = labels
    .filter((label) => label.startsWith(typedChild))
    .map((label) => ({
      label,
      kind: "shape",
      detail: "child node",
      description: "子ノードを参照",
      documentation: "子ノードをドット記法で参照",
      insertText: label,
    }));
  return completions.length > 0 ? completions : [];
}

function getD2TopLevelNodeCompletions(
  source: string,
  lineContent: string,
  column: number,
): D2CompletionItem[] {
  const linePrefix = lineContent.slice(0, Math.max(0, column - 1));
  const typedKey = linePrefix.match(/[\w-]*$/)?.[0] ?? "";
  const tokenPrefix = linePrefix.slice(0, linePrefix.length - typedKey.length);
  if (!typedKey || tokenPrefix.trimEnd().endsWith(".")) return [];
  if (!isD2KeyCompletionBoundary(tokenPrefix)) return [];

  const children = collectD2ChildNodes(source);
  const labels = children.get("") ?? [];
  return labels
    .filter((label) => label.startsWith(typedKey))
    .map((label) => ({
      label,
      kind: "shape" as const,
      detail: "node",
      description: "既存ノードを参照",
      documentation: "既存ノードを参照",
      insertText: label,
    }));
}

function collectD2ChildNodes(source: string) {
  const children = new Map<string, Set<string>>();
  const context: string[] = [];
  let ignoredMapDepth = 0;

  const addPath = (path: string[]) => {
    for (let index = 0; index < path.length; index += 1) {
      const parentKey = path.slice(0, index).join("\0");
      const child = path[index];
      const existing = children.get(parentKey) ?? new Set<string>();
      existing.add(child);
      children.set(parentKey, existing);
    }
  };

  for (const rawLine of source.split("\n")) {
    const line = stripD2LineComment(rawLine);
    let quote: string | null = null;
    let statementStart = 0;

    const flushStatement = (end: number) => {
      if (ignoredMapDepth !== 0) return;
      for (const path of nodePathsFromStatement(line.slice(statementStart, end))) {
        if (isReservedD2NodePath(path)) continue;
        addPath([...context, ...path]);
      }
    };

    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (quote) {
        if (character === "\\") {
          index += 1;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }

      if (character === "{") {
        if (ignoredMapDepth > 0) {
          ignoredMapDepth += 1;
          statementStart = index + 1;
          continue;
        }

        const path = nodePathsFromStatement(line.slice(statementStart, index))[0] ?? [];
        if (path.length === 0 || isReservedD2NodePath(path)) {
          ignoredMapDepth = 1;
          statementStart = index + 1;
          continue;
        }
        const fullPath = [...context, ...path];
        addPath(fullPath);
        context.splice(0, context.length, ...fullPath);
        statementStart = index + 1;
      } else if (character === "}") {
        if (ignoredMapDepth > 0) {
          ignoredMapDepth -= 1;
          statementStart = index + 1;
          continue;
        }
        flushStatement(index);
        context.pop();
        statementStart = index + 1;
      } else if (character === ";") {
        flushStatement(index);
        statementStart = index + 1;
      }
    }
    flushStatement(line.length);
  }

  return new Map([...children].map(([key, values]) => [key, [...values].sort()]));
}

function nodePathsFromStatement(statement: string): string[][] {
  const keyText = statement.split(":", 1)[0].trim();
  if (!keyText) return [];
  return keyText
    .split("<->")
    .join("->")
    .split("<-")
    .join("->")
    .split("--")
    .join("->")
    .split("->")
    .map(extractD2Path)
    .filter((path) => path.length > 0);
}

function extractD2Path(text: string) {
  const match = text.trimEnd().match(/[\w-]+(?:\.[\w-]+)*\.?$/);
  return match ? match[0].replace(/\.$/, "").split(".").filter(Boolean) : [];
}

function stripD2LineComment(text: string) {
  let quote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#" || (character === "/" && text[index + 1] === "/")) {
      return text.slice(0, index);
    }
  }
  return text;
}

function isReservedD2NodePath(path: string[]) {
  const reserved = new Set([
    "label",
    "shape",
    "icon",
    "constraint",
    "tooltip",
    "link",
    "near",
    "width",
    "height",
    "direction",
    "top",
    "left",
    "grid-rows",
    "grid-columns",
    "grid-gap",
    "vertical-gap",
    "horizontal-gap",
    "class",
    "vars",
    "style",
    "source-arrowhead",
    "target-arrowhead",
    "classes",
    "layers",
    "scenarios",
    "steps",
    "theme-overrides",
    "dark-theme-overrides",
    "d2-config",
  ]);
  return path.length === 0 || reserved.has(path[0]);
}
