export type SourcePosition = { line: number; column: number };

export function stripCommentsKeepLines(src: string): string {
  return src
    .split("\n")
    .map((originalLine) => {
      let line = originalLine;
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] !== "%") continue;

        let backslashes = 0;
        for (let j = i - 1; j >= 0 && line[j] === "\\"; j -= 1) {
          backslashes += 1;
        }

        const isEscapedPercent = backslashes % 2 === 1;
        if (!isEscapedPercent) {
          return line.slice(0, i) + " ".repeat(line.length - i);
        }
      }
      return line;
    })
    .join("\n");
}

export function lineColAtOffset(src: string, offset: number): SourcePosition {
  const before = src.slice(0, Math.max(0, offset));
  const line = before.split("\n").length;
  const lastNewline = before.lastIndexOf("\n");
  const column = offset - lastNewline;
  return { line, column };
}

export function findMatchingBrace(src: string, openIndex: number): number | undefined {
  if (src[openIndex] !== "{") return undefined;

  let depth = 0;
  for (let i = openIndex; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return undefined;
}

export function extractBraceArgument(
  src: string,
  commandStart: number,
  command: string,
): { value: string; open: number; close: number } | undefined {
  let i = commandStart + command.length;
  while (i < src.length && /\s/.test(src[i])) i += 1;
  if (src[i] !== "{") return undefined;

  const close = findMatchingBrace(src, i);
  if (close === undefined) return undefined;
  return { value: src.slice(i + 1, close), open: i, close };
}

export function findCommand(src: string, command: string): RegExpMatchArray[] {
  const pattern = new RegExp(escapeRegExp(command) + "(?![A-Za-z])", "g");
  return [...src.matchAll(pattern)];
}

export function findCommandArgs(
  src: string,
  command: string,
): Array<{ match: RegExpMatchArray; value: string; open: number; close: number }> {
  return findCommand(src, command)
    .map((match) => {
      const arg = extractBraceArgument(src, match.index ?? 0, command);
      return arg ? { match, ...arg } : undefined;
    })
    .filter((x): x is { match: RegExpMatchArray; value: string; open: number; close: number } => Boolean(x));
}

export function parseTopLevelKeyValues(block: string): Array<{ key: string; value: string; valueOffset: number }> {
  const out: Array<{ key: string; value: string; valueOffset: number }> = [];
  let i = 0;

  while (i < block.length) {
    while (i < block.length && (block[i] === "," || /\s/.test(block[i]))) i += 1;

    const match = /^[A-Za-z_]+\s*=/.exec(block.slice(i));
    if (!match) {
      i += 1;
      continue;
    }

    const key = match[0].replace(/\s*=$/, "");
    i += match[0].length;
    while (i < block.length && /\s/.test(block[i])) i += 1;

    const valueOffset = i;
    let value = "";
    if (block[i] === "{") {
      const close = findMatchingBrace(block, i);
      if (close === undefined) break;
      value = block.slice(i + 1, close).trim();
      i = close + 1;
    } else {
      const start = i;
      while (i < block.length && block[i] !== ",") i += 1;
      value = block.slice(start, i).trim();
    }

    out.push({ key, value, valueOffset });
  }

  return out;
}

export function normalizeLatexText(src: string): string {
  return src
    .replace(/\\thanks\s*\{[^{}]*\}/g, "")
    .replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/[^A-Za-z, .'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function splitAuthorList(src: string): string[] {
  return src
    .replace(/\s+and\s+/gi, ",")
    .split(",")
    .map((s) => normalizeLatexText(s))
    .filter(Boolean);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
