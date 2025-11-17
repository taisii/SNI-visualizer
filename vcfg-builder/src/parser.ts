import {
  type BinaryOp,
  type Expr,
  type Identifier,
  type Instruction,
  type LabelTable,
  type LabeledInstr,
  type Program,
  type Register,
} from "./types";

export class ParseError extends Error {
  detail?: unknown;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = "ParseError";
    this.detail = detail;
  }
}

export function parse(code: string): Program {
  const labels: LabelTable = new Map();
  const instructions: LabeledInstr[] = [];

  const lines = code.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const sourceLine = i + 1; // 1-based

    const withoutComment = stripLineComment(rawLine);
    const trimmed = withoutComment.trim();
    if (trimmed === "") continue;

    const { label, rest } = parseLabel(trimmed, sourceLine);
    if (label !== undefined) {
      if (labels.has(label)) {
        throw new ParseError(`ラベル '${label}' が重複しています`, { sourceLine });
      }
      // ラベルは次の命令 PC に紐づける
      labels.set(label, instructions.length);
      if (rest.length === 0) {
        throw new ParseError("ラベルの後に命令が必要です", { sourceLine });
      }
    }

    const instr = parseInstruction(rest, sourceLine);
    instructions.push({
      label,
      instr,
      sourceLine,
      pc: instructions.length,
    });
  }

  // 前方参照を解決
  for (const item of instructions) {
    if (item.instr.op === "beqz") {
      const targetPc = labels.get(item.instr.target);
      if (targetPc === undefined) {
        throw new ParseError(`未定義のラベル '${item.instr.target}'`, {
          sourceLine: item.sourceLine,
        });
      }
      item.instr.targetPc = targetPc;
    }
  }

  return { instructions, labels };
}

// --- 公開ヘルパ ---

export function tryResolveJump(expr: Expr, labels: LabelTable): number | undefined {
  if (expr.kind === "int") return expr.value;
  if (expr.kind === "reg") {
    return labels.get(expr.name);
  }
  return undefined;
}

// --- 内部実装 ---

type Token =
  | { kind: "identifier"; value: string }
  | { kind: "int"; value: string }
  | { kind: "symbol"; value: string };

type TokenCursor = {
  tokens: Token[];
  index: number;
};

function stripLineComment(line: string): string {
  const commentIndex = line.indexOf("//");
  return commentIndex >= 0 ? line.slice(0, commentIndex) : line;
}

function parseLabel(line: string, sourceLine: number): { label?: string; rest: string } {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
  if (!match) return { rest: line };

  const [, label, rest] = match;
  if (rest === undefined) {
    throw new ParseError("ラベルの後に命令が必要です", { sourceLine });
  }
  return { label, rest };
}

function parseInstruction(text: string, sourceLine: number): Instruction {
  const tokens = tokenize(text, sourceLine);
  if (tokens.length === 0) {
    throw new ParseError("空行または不完全な命令です", { sourceLine });
  }
  const cursor: TokenCursor = { tokens, index: 0 };

  const head = expectIdentifier(cursor, sourceLine);

  switch (head) {
    case "skip":
      ensureEof(cursor, sourceLine);
      return { op: "skip", text };
    case "spbarr":
      ensureEof(cursor, sourceLine);
      return { op: "spbarr", text };
    case "load": {
      const dest = expectIdentifier(cursor, sourceLine);
      expectSymbol(cursor, ",", sourceLine);
      const addr = parseExpr(cursor, sourceLine);
      ensureEof(cursor, sourceLine);
      return { op: "load", dest, addr, text };
    }
    case "store": {
      const src = expectIdentifier(cursor, sourceLine);
      expectSymbol(cursor, ",", sourceLine);
      const addr = parseExpr(cursor, sourceLine);
      ensureEof(cursor, sourceLine);
      return { op: "store", src, addr, text };
    }
    case "beqz": {
      const cond = expectIdentifier(cursor, sourceLine);
      expectSymbol(cursor, ",", sourceLine);
      const target = expectIdentifier(cursor, sourceLine);
      ensureEof(cursor, sourceLine);
      return { op: "beqz", cond, target, targetPc: -1, text };
    }
    case "jmp": {
      const target = parseExpr(cursor, sourceLine);
      ensureEof(cursor, sourceLine);
      return { op: "jmp", target, text };
    }
    default: {
      // 代入/条件付き代入の形を処理
      const dest = head;
      expectSymbol(cursor, "<-", sourceLine);
      const exprOrCond = parseExpr(cursor, sourceLine);
      if (maybeSymbol(cursor, "?")) {
        const value = parseExpr(cursor, sourceLine);
        ensureEof(cursor, sourceLine);
        return { op: "cmov", dest, cond: exprOrCond, value, text };
      }
      ensureEof(cursor, sourceLine);
      return { op: "assign", dest, expr: exprOrCond, text };
    }
  }
}

function tokenize(text: string, sourceLine: number): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const isWhitespace = (ch: string) => /\s/.test(ch);
  const isIdentStart = (ch: string) => /[A-Za-z_]/.test(ch);
  const isIdentBody = (ch: string) => /[A-Za-z0-9_]/.test(ch);
  const isDigit = (ch: string) => /[0-9]/.test(ch);

  while (i < text.length) {
    const ch = text[i];
    if (isWhitespace(ch)) {
      i += 1;
      continue;
    }

    if (ch === "<" && text[i + 1] === "-") {
      tokens.push({ kind: "symbol", value: "<-" });
      i += 2;
      continue;
    }

    if (",()+-*?&".includes(ch)) {
      tokens.push({ kind: "symbol", value: ch });
      i += 1;
      continue;
    }

    if (ch === "-" && isDigit(text[i + 1] ?? "")) {
      let j = i + 1;
      while (isDigit(text[j] ?? "")) j += 1;
      tokens.push({ kind: "int", value: text.slice(i, j) });
      i = j;
      continue;
    }

    if (isDigit(ch)) {
      let j = i + 1;
      while (isDigit(text[j] ?? "")) j += 1;
      tokens.push({ kind: "int", value: text.slice(i, j) });
      i = j;
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i + 1;
      while (isIdentBody(text[j] ?? "")) j += 1;
      tokens.push({ kind: "identifier", value: text.slice(i, j) });
      i = j;
      continue;
    }

    throw new ParseError(`無効なトークン '${ch}'`, { sourceLine, position: i });
  }

  return tokens;
}

function expectIdentifier(cursor: TokenCursor, sourceLine: number): string {
  const token = cursor.tokens[cursor.index];
  if (token?.kind === "identifier") {
    cursor.index += 1;
    return token.value;
  }
  throw new ParseError("識別子が必要です", { sourceLine, at: cursor.index });
}

function expectSymbol(cursor: TokenCursor, value: string, sourceLine: number): void {
  const token = cursor.tokens[cursor.index];
  if (token?.kind === "symbol" && token.value === value) {
    cursor.index += 1;
    return;
  }
  throw new ParseError(`記号 '${value}' が必要です`, { sourceLine, at: cursor.index });
}

function maybeSymbol(cursor: TokenCursor, value: string): boolean {
  const token = cursor.tokens[cursor.index];
  if (token?.kind === "symbol" && token.value === value) {
    cursor.index += 1;
    return true;
  }
  return false;
}

function ensureEof(cursor: TokenCursor, sourceLine: number): void {
  if (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    throw new ParseError(`予期しないトークン '${token.value}'`, { sourceLine, at: cursor.index });
  }
}

function parseExpr(cursor: TokenCursor, sourceLine: number): Expr {
  return parseAddSub(cursor, sourceLine);
}

function parseAddSub(cursor: TokenCursor, sourceLine: number): Expr {
  let node = parseMulAnd(cursor, sourceLine);
  // left-associative
  while (true) {
    const token = cursor.tokens[cursor.index];
    if (token?.kind === "symbol" && (token.value === "+" || token.value === "-")) {
      cursor.index += 1;
      const right = parseMulAnd(cursor, sourceLine);
      node = { kind: "binop", op: token.value as BinaryOp, left: node, right };
      continue;
    }
    break;
  }
  return node;
}

function parseMulAnd(cursor: TokenCursor, sourceLine: number): Expr {
  let node = parseFactor(cursor, sourceLine);
  while (true) {
    const token = cursor.tokens[cursor.index];
    if (token?.kind === "symbol" && (token.value === "*" || token.value === "&")) {
      cursor.index += 1;
      const right = parseFactor(cursor, sourceLine);
      node = { kind: "binop", op: token.value as BinaryOp, left: node, right };
      continue;
    }
    break;
  }
  return node;
}

function parseFactor(cursor: TokenCursor, sourceLine: number): Expr {
  const token = cursor.tokens[cursor.index];
  if (!token) {
    throw new ParseError("式が不完全です", { sourceLine, at: cursor.index });
  }

  if (token.kind === "identifier") {
    cursor.index += 1;
    return { kind: "reg", name: token.value };
  }

  if (token.kind === "int") {
    cursor.index += 1;
    return { kind: "int", value: Number.parseInt(token.value, 10) };
  }

  if (token.kind === "symbol" && token.value === "(") {
    cursor.index += 1;
    const inner = parseExpr(cursor, sourceLine);
    expectSymbol(cursor, ")", sourceLine);
    return inner;
  }

  throw new ParseError("式の構文が不正です", { sourceLine, at: cursor.index, token });
}
