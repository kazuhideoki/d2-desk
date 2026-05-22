import type { D2Object } from "../../types";

type ParsedSide = {
  leading: string;
  core: string;
  trailing: string;
};

type SwitchEdgeResult =
  | {
      ok: true;
      source: string;
    }
  | {
      ok: false;
      reason: string;
    };

const connectionOperatorPattern = /<->|->|<-|--/g;

function splitLinesWithEndings(source: string) {
  return source.match(/[^\n]*(?:\n|$)/g)?.filter((line) => line.length > 0) ?? [""];
}

function unquoteAwareColonIndex(text: string) {
  let quote: '"' | "'" | null = null;
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
    } else if (character === ":") {
      return index;
    }
  }
  return -1;
}

function operatorIndexes(text: string) {
  const indexes: Array<{ index: number; operator: string }> = [];
  let quote: '"' | "'" | null = null;
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

    connectionOperatorPattern.lastIndex = index;
    const match = connectionOperatorPattern.exec(text);
    if (!match || match.index !== index) continue;

    indexes.push({ index, operator: match[0] });
    index += match[0].length - 1;
  }
  return indexes;
}

function parseSide(text: string): ParsedSide | null {
  const match = text.match(/^(\s*)(.*?)(\s*)$/);
  if (!match) return null;

  const core = match[2];
  if (!core.trim()) return null;

  return {
    leading: match[1],
    core: core.trim(),
    trailing: match[3],
  };
}

function switchOperator(operator: string) {
  if (operator === "->") return "<-";
  if (operator === "<-") return "->";
  return null;
}

export function switchEdgeDirectionInSource(
  source: string,
  connection: Pick<D2Object, "kind" | "sourceRanges">,
): SwitchEdgeResult {
  if (connection.kind !== "connection") {
    return { ok: false, reason: "Select an edge to switch" };
  }

  const operatorRange = connection.sourceRanges?.[0];
  const scopeRange = connection.sourceRanges?.[1] ?? operatorRange;
  if (!operatorRange || !scopeRange) {
    return { ok: false, reason: "Could not locate the selected edge" };
  }
  if (
    operatorRange.startLine !== operatorRange.endLine ||
    scopeRange.startLine !== scopeRange.endLine ||
    operatorRange.startLine !== scopeRange.startLine
  ) {
    return { ok: false, reason: "Switch Edge supports a single-line edge statement" };
  }

  const lines = splitLinesWithEndings(source);
  const line = lines[scopeRange.startLine - 1];
  if (line === undefined) {
    return { ok: false, reason: "Could not locate the selected edge" };
  }

  const scopeStart = scopeRange.startColumn - 1;
  const scopeEnd = scopeRange.endColumn - 1;
  const scopeText = line.slice(scopeStart, scopeEnd);
  const operatorStart = operatorRange.startColumn - scopeRange.startColumn;
  const operatorEnd = operatorRange.endColumn - scopeRange.startColumn;
  const operator = scopeText.slice(operatorStart, operatorEnd);
  const nextOperator = switchOperator(operator);
  if (!nextOperator) {
    return { ok: false, reason: "Switch Edge supports -> and <- edges only" };
  }

  const colonIndex = unquoteAwareColonIndex(scopeText);
  const head = colonIndex >= 0 ? scopeText.slice(0, colonIndex) : scopeText;
  const tail = colonIndex >= 0 ? scopeText.slice(colonIndex) : "";
  const operators = operatorIndexes(head);
  if (operators.length !== 1 || operators[0].index !== operatorStart) {
    return { ok: false, reason: "Switch Edge supports a single edge statement" };
  }

  const left = parseSide(head.slice(0, operatorStart));
  const right = parseSide(head.slice(operatorEnd));
  if (!left || !right) {
    return { ok: false, reason: "Could not identify both edge endpoints" };
  }

  const switchedHead = `${left.leading}${right.core}${right.leading}${nextOperator}${left.trailing}${left.core}${right.trailing}`;
  const nextLine = `${line.slice(0, scopeStart)}${switchedHead}${tail}${line.slice(scopeEnd)}`;
  lines[scopeRange.startLine - 1] = nextLine;
  return { ok: true, source: lines.join("") };
}

export type { SwitchEdgeResult };
