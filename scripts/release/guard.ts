import { isRecord } from "./json.ts";

export type GuardViolation = {
  pattern: string;
  text: string;
  index: number;
  line: number;
  column: number;
};

type StringSpan = {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
};

type CommentSpan = {
  start: number;
  end: number;
};

type Spans = {
  strings: StringSpan[];
  comments: CommentSpan[];
};

const PATTERNS: readonly { pattern: string; expression: RegExp }[] = [
  { pattern: "Bun.", expression: /\bBun\./g },
  { pattern: "import.meta.dir", expression: /\bimport\.meta\.dir\b/g },
  { pattern: "import.meta.path", expression: /\bimport\.meta\.path\b/g },
  { pattern: "import.meta.main", expression: /\bimport\.meta\.main\b/g },
  { pattern: "bun:", expression: /\bbun:[A-Za-z0-9_-]+/g },
];

function lexicalSpans(code: string): Spans {
  const strings: StringSpan[] = [];
  const comments: CommentSpan[] = [];
  let i = 0;

  while (i < code.length) {
    const char = code[i];
    const next = code[i + 1];

    if (char === "/" && next === "/") {
      const start = i;
      i += 2;
      while (i < code.length && code[i] !== "\n") i += 1;
      comments.push({ start, end: i });
      continue;
    }

    if (char === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i += 1;
      i = Math.min(code.length, i + 2);
      comments.push({ start, end: i });
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      const start = i;
      i += 1;
      const contentStart = i;
      while (i < code.length) {
        if (code[i] === "\\") {
          i += 2;
          continue;
        }
        if (code[i] === quote) break;
        i += 1;
      }
      const contentEnd = Math.min(i, code.length);
      if (i < code.length) i += 1;
      strings.push({ start, end: i, contentStart, contentEnd });
      continue;
    }

    i += 1;
  }

  return { strings, comments };
}

function inside(span: { start: number; end: number }, index: number): boolean {
  return index >= span.start && index < span.end;
}

function enclosingString(strings: readonly StringSpan[], index: number): StringSpan | null {
  for (const span of strings) {
    if (inside(span, index)) return span;
  }
  return null;
}

function isModuleSpecifier(code: string, span: StringSpan): boolean {
  const before = code.slice(0, span.start);
  return /(?:^|[^\w$])(?:from|import|require)\s*(?:\(\s*)?$/.test(before);
}

function lineColumn(code: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index; i++) {
    if (code[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/**
 * Finds Bun-only API use outside comments and outside string literals that are
 * clearly data. A string that starts with `bun:` is a module specifier and is
 * reported; `"remember Bun.file()"` is data and is not.
 */
export function findNodeGuardViolations(code: string): GuardViolation[] {
  const { strings, comments } = lexicalSpans(code);
  const violations: GuardViolation[] = [];

  for (const { pattern, expression } of PATTERNS) {
    expression.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(code)) !== null) {
      const index = match.index;
      if (comments.some((span) => inside(span, index))) continue;
      const string = enclosingString(strings, index);
      if (string !== null) {
        if (pattern !== "bun:" || !isModuleSpecifier(code, string)) continue;
      }
      const at = lineColumn(code, index);
      violations.push({ pattern, text: match[0], index, ...at });
    }
  }

  return violations.sort((a, b) => a.index - b.index);
}

export function formatGuardFailure(file: string, violations: readonly GuardViolation[]): string {
  const details = violations
    .map((violation) => `${violation.pattern} at ${violation.line}:${violation.column}`)
    .join(", ");
  return `Node guard failed in ${file}: ${details}`;
}

/**
 * Reads an external source map and returns the first source whose content
 * contains the offending text. Bun writes sourcesContent, so this names the
 * original file even after bundling. When a pattern is given, the source must
 * actually violate that pattern, not merely mention the text in a comment.
 */
export function findSourceWithText(
  mapJson: string,
  text: string,
  pattern?: string,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(mapJson);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const sources = parsed.sources;
  if (!Array.isArray(sources)) return null;
  const contents = parsed.sourcesContent;
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (typeof source !== "string") continue;
    const content = Array.isArray(contents) ? contents[i] : undefined;
    if (typeof content !== "string") continue;
    if (!content.includes(text)) continue;
    if (pattern === undefined) return source;
    if (findNodeGuardViolations(content).some((violation) => violation.pattern === pattern)) {
      return source;
    }
  }
  return null;
}
