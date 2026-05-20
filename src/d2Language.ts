import { invoke } from "@tauri-apps/api/core";
import type * as Monaco from "monaco-editor";
import type { D2CompletionItem, WorkspaceFileEntry } from "./types";

const d2ValueCompletionPattern =
  /(?:^|[{\s;])(?:[\w"'-]+(?:\.[\w-]+)*\.)?[\w-]+(?:\.[\w-]+)*\s*:\s*([\w-]*)$/;

let didRegisterD2Completions = false;
const d2CompletionTriggerCharacters = [
  ":",
  " ",
  ".",
  "@",
  "/",
  ..."-_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
];

type D2CompletionContext =
  | {
      kind: "key" | "value";
      typedText: string;
    }
  | {
      kind: "import-file";
      typedText: string;
    }
  | {
      kind: "import-node";
      typedText: string;
      importPath: string;
      parentPath: string[];
    };

type D2ImportCompletionContext = {
  workspaceRootPath: string | null;
  currentFilePath: string | null;
  openTabs: {
    filePath: string | null;
    source: string;
  }[];
};

let d2ImportCompletionContextProvider: (() => D2ImportCompletionContext) | null = null;

export function setD2ImportCompletionContextProvider(
  provider: (() => D2ImportCompletionContext) | null,
) {
  d2ImportCompletionContextProvider = provider;
}

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
            : completionContext.kind === "import-file"
              ? lineSuffix.match(/^[\w./-]*/)
            : lineSuffix.match(/^[\w-]*/);
        const remainingText = remainingTextMatch ? remainingTextMatch[0] : "";
        const replacementRange = {
          startLineNumber: position.lineNumber,
          startColumn: position.column - completionContext.typedText.length,
          endLineNumber: position.lineNumber,
          endColumn: position.column + remainingText.length,
        };

        let completions: D2CompletionItem[];
        if (completionContext.kind === "import-file" || completionContext.kind === "import-node") {
          completions = await getD2ImportCompletions(completionContext);
        } else {
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
        }
        if (completions.length === 0 && completionContext.kind === "key") {
          completions = getD2ChildNodeCompletions(
            model.getValue(),
            position.lineNumber - 1,
            lineContent,
            position.column,
          );
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
            label: d2CompletionLabel(completion),
            kind: d2CompletionKindToMonaco(monaco, completion),
            insertText: completion.insertText || completion.label,
            filterText: completion.filterText || completion.label,
            sortText: completion.label,
            detail:
              completion.description ||
              (completion.detail ? `D2 ${completion.detail}` : "D2 completion"),
            documentation: d2CompletionDocumentation(completion),
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
  const importContext = getD2ImportCompletionContext(lineContent, column);
  if (importContext) return importContext;

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

function getD2ImportCompletionContext(
  lineContent: string,
  column: number,
): D2CompletionContext | null {
  const linePrefix = lineContent.slice(0, Math.max(0, column - 1));
  const atIndex = lastD2ImportAtIndex(linePrefix);
  if (atIndex < 0) return null;

  const importText = linePrefix.slice(atIndex + 1);
  if (!/^[\w./-]*$/.test(importText)) return null;

  const partialDotIndex = d2PartialImportDotIndex(importText);
  if (partialDotIndex < 0) {
    return {
      kind: "import-file",
      typedText: importText,
    };
  }

  const nodeText = importText.slice(partialDotIndex + 1);
  const parts = nodeText.split(".");
  const typedText = parts.pop() ?? "";
  return {
    kind: "import-node",
    typedText,
    importPath: importText.slice(0, partialDotIndex),
    parentPath: parts.filter(Boolean),
  };
}

function lastD2ImportAtIndex(linePrefix: string) {
  let quote: string | null = null;
  let atIndex = -1;
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
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "@") {
      const previous = linePrefix[index - 1] ?? "";
      if (!previous || !/[\w/-]/.test(previous)) {
        atIndex = index;
      }
    }
  }
  return atIndex;
}

function d2PartialImportDotIndex(importText: string) {
  for (let index = 0; index < importText.length; index += 1) {
    if (importText[index] !== ".") continue;

    const previous = importText[index - 1] ?? "";
    const next = importText[index + 1] ?? "";
    if (next === "/" || next === "." || (previous === "." && next === "/")) {
      continue;
    }
    if (index === 0) continue;
    return index;
  }
  return -1;
}

async function getD2ImportCompletions(
  completionContext:
    | Extract<D2CompletionContext, { kind: "import-file" }>
    | Extract<D2CompletionContext, { kind: "import-node" }>,
) {
  const context = d2ImportCompletionContextProvider?.();
  if (!context?.workspaceRootPath) return [];

  let files: WorkspaceFileEntry[];
  try {
    files = await invoke<WorkspaceFileEntry[]>("list_workspace_files", {
      rootPath: context.workspaceRootPath,
    });
  } catch {
    return [];
  }

  const currentDirectory = context.currentFilePath
    ? pathDirectory(context.currentFilePath)
    : context.workspaceRootPath;
  const candidates = files
    .filter((file) => file.relativePath.endsWith(".d2"))
    .filter((file) => file.path !== context.currentFilePath)
    .map((file) => ({
      ...file,
      importPath: d2ImportSpecifier(currentDirectory, file.path),
    }));

  if (completionContext.kind === "import-file") {
    return candidates
      .filter((file) => file.importPath.startsWith(completionContext.typedText))
      .map((file) => ({
        label: file.importPath,
        kind: "file" as const,
        detail: "D2 file",
        description: "D2ファイルをインポート",
        documentation: `${file.relativePath} をインポート`,
        insertText: file.importPath,
      }));
  }

  const target = candidates.find(
    (file) =>
      normalizeImportSpecifier(file.importPath) ===
      normalizeImportSpecifier(completionContext.importPath),
  );
  if (!target) return [];

  const source = await sourceForD2File(target.path, context.openTabs);
  if (source === null) return [];

  const children = collectD2ChildNodes(source);
  const labels = children.get(completionContext.parentPath.join("\0")) ?? [];
  return labels
    .filter((label) => label.startsWith(completionContext.typedText))
    .map((label) => ({
      label,
      kind: "shape" as const,
      detail: "imported node",
      description: "インポート先のノードを参照",
      documentation: `${target.importPath} のノードをドット記法で参照`,
      insertText: label,
    }));
}

async function sourceForD2File(path: string, openTabs: D2ImportCompletionContext["openTabs"]) {
  const opened = openTabs.find((tab) => tab.filePath === path);
  if (opened) return opened.source;

  try {
    const result = await invoke<{ path: string; contents: string }>("read_d2_file", { path });
    return result.contents;
  } catch {
    return null;
  }
}

function d2ImportSpecifier(fromDirectory: string, targetPath: string) {
  const relativePath = relativePathFromDirectory(fromDirectory, targetPath);
  return stripD2Extension(relativePath);
}

function normalizeImportSpecifier(specifier: string) {
  return specifier.replace(/^\.\//, "");
}

function stripD2Extension(path: string) {
  return path.endsWith(".d2") ? path.slice(0, -3) : path;
}

function pathDirectory(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : "";
}

function relativePathFromDirectory(fromDirectory: string, targetPath: string) {
  const fromParts = splitPath(fromDirectory);
  const targetParts = splitPath(targetPath);

  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < targetParts.length &&
    fromParts[commonLength] === targetParts[commonLength]
  ) {
    commonLength += 1;
  }

  const upParts = fromParts.slice(commonLength).map(() => "..");
  const downParts = targetParts.slice(commonLength);
  const relativeParts = [...upParts, ...downParts];
  return relativeParts.join("/") || (targetParts[targetParts.length - 1] ?? "");
}

function splitPath(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

function d2CompletionLabel(completion: D2CompletionItem): string | Monaco.languages.CompletionItemLabel {
  if (completion.colorSwatches?.length) {
    return {
      label: completion.label,
      detail: completion.description ? ` ${completion.description}` : undefined,
      description: completion.colorSwatches.join(" "),
    };
  }
  return completion.description
    ? { label: completion.label, description: completion.description }
    : completion.label;
}

function d2CompletionDocumentation(completion: D2CompletionItem) {
  const documentation = completion.documentation
    ? completion.documentation
    : completion.detail
      ? `D2 ${completion.detail}`
      : "";
  const palette = completion.colorSwatches?.length
    ? `${themePaletteMarkdown(completion.colorSwatches)}${documentation ? "\n\n" : ""}`
    : "";
  const value = `${palette}${documentation}`;
  return value ? { value } : undefined;
}

function themePaletteMarkdown(colors: string[]) {
  const width = colors.length * 34;
  const rects = colors
    .map(
      (color, index) =>
        `<rect x="${index * 34}" y="0" width="34" height="24" fill="${escapeSvgAttribute(color)}"/>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24">${rects}</svg>`;
  return `![theme palette](data:image/svg+xml;utf8,${encodeURIComponent(svg)})`;
}

function escapeSvgAttribute(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return char;
    }
  });
}

function d2CompletionKindToMonaco(monaco: typeof Monaco, completion: D2CompletionItem) {
  if (completion.colorSwatches?.length) {
    return monaco.languages.CompletionItemKind.Color;
  }
  switch (completion.kind) {
    case "file":
    case "icon":
      return monaco.languages.CompletionItemKind.File;
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
  lineIndex: number,
  lineContent: string,
  column: number,
): D2CompletionItem[] {
  const linePrefix = lineContent.slice(0, Math.max(0, column - 1));
  const typedChild = linePrefix.match(/[\w-]*$/)?.[0] ?? "";
  const parentPrefix = linePrefix.slice(0, linePrefix.length - typedChild.length).trimEnd();
  if (!parentPrefix.endsWith(".")) return [];

  const parentPath = extractD2Path(parentPrefix.slice(0, -1));
  if (parentPath.length === 0) return [];

  const children = collectD2ChildNodes(sourceWithoutCurrentDotCompletion(source, lineIndex, column));
  const labels = getD2CompletionChildNodeLabels(
    source,
    lineIndex,
    column,
    children,
    parentPath,
  );
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

function getD2CompletionChildNodeLabels(
  source: string,
  lineIndex: number,
  column: number,
  children: Map<string, string[]>,
  parentPath: string[],
) {
  const context = trimPathSuffix(getD2KeyContext(source, lineIndex, column), parentPath);
  if (context.length > 0 && !hasPathPrefix(parentPath, context)) {
    const relativePath = [...context, ...parentPath];
    const labels = children.get(relativePath.join("\0")) ?? [];
    if (labels.length > 0) return labels;
  }

  const labels = children.get(parentPath.join("\0")) ?? [];
  if (labels.length > 0) return labels;

  if (context.length === 0 || parentPath.length !== 1) return [];
  const contextLabels = children.get(context.join("\0")) ?? [];
  if (!contextLabels.includes(parentPath[0])) return [];
  return contextLabels.filter((label) => label !== parentPath[0]);
}

function sourceWithoutCurrentDotCompletion(source: string, lineIndex: number, column: number) {
  const lines = source.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return source;

  const lineText = lines[lineIndex];
  const clampedColumn = Math.min(Math.max(0, column - 1), lineText.length);
  let start = clampedColumn;
  while (start > 0 && /[\w-]/.test(lineText[start - 1])) start -= 1;
  let end = clampedColumn;
  while (end < lineText.length && /[\w-]/.test(lineText[end])) end += 1;

  const prefix = lineText.slice(0, start).trimEnd();
  if (!prefix.endsWith(".")) return source;

  let parentStart = prefix.length - 1;
  while (parentStart > 0 && /[\w-.]/.test(lineText[parentStart - 1])) parentStart -= 1;
  lines[lineIndex] = lineText.slice(0, parentStart) + lineText.slice(end);
  return lines.join("\n");
}

function trimPathSuffix(path: string[], suffix: string[]) {
  if (suffix.length === 0 || suffix.length > path.length) return path;
  const offset = path.length - suffix.length;
  return suffix.every((part, index) => path[offset + index] === part) ? path.slice(0, offset) : path;
}

function hasPathPrefix(path: string[], prefix: string[]) {
  if (prefix.length > path.length) return false;
  return prefix.every((part, index) => path[index] === part);
}

function getD2KeyContext(source: string, lineIndex: number, column: number) {
  const lines = source.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return [];

  const frames: string[][] = [];
  for (let index = 0; index <= lineIndex; index += 1) {
    const limit = index === lineIndex ? Math.max(0, column - 1) : lines[index].length;
    scanD2ContextLine(frames, lines[index], limit);
  }
  return frames.flat();
}

function scanD2ContextLine(frames: string[][], text: string, limit: number) {
  let quote: string | null = null;
  for (let index = 0; index < limit; index += 1) {
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
    if (character === "#" || (character === "/" && text[index + 1] === "/")) return;

    if (character === "{") {
      const prefix = text.slice(0, index);
      const colonIndex = prefix.lastIndexOf(":");
      if (colonIndex < 0) continue;
      const path = extractD2Path(prefix.slice(0, colonIndex));
      if (path.length > 0) frames.push(path);
    } else if (character === "}") {
      frames.pop();
    }
  }
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
