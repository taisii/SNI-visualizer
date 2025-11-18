import type { LabelTable, LabeledInstr, Program } from "../types/program";
import type { BinaryOp, Expr } from "../types/expr";
import type { Instruction } from "../types/instruction";
import type { JumpResolution } from "../types/jump";

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
        throw new ParseError(`ラベル '${label}' が重複しています`, {
          sourceLine,
        });
      }
      // ラベルは次の命令 PC に紐づける（ラベル単独行も許容）
      labels.set(label, instructions.length);
      if (rest.length === 0) {
        // ラベルのみの行の場合、同じ PC に続く命令を紐づけるためスキップ
        continue;
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

    if (item.instr.op === "jmp") {
      item.instr.resolution = resolveJump(item.instr.target, labels);
    }
  }

  return { instructions, labels };
}

// --- 公開ヘルパ ---

export function tryResolveJump(
  expr: Expr,
  labels: LabelTable,
): number | undefined {
  const res = resolveJump(expr, labels);
  return res.kind === "pc" ? res.pc : undefined;
}

export function resolveJump(expr: Expr, labels: LabelTable): JumpResolution {
  if (expr.kind === "int") return { kind: "pc", pc: expr.value };
  if (expr.kind === "reg") {
    const pc = labels.get(expr.name);
    if (pc !== undefined) return { kind: "pc", pc, label: expr.name };
    return { kind: "label", label: expr.name };
  }
  return { kind: "dynamic" };
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

function parseLabel(
  line: string,
  sourceLine: number,
): { label?: string; rest: string } {
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

  const headToken = cursor.tokens[cursor.index];
  if (!headToken || headToken.kind !== "identifier") {
    throw new ParseError("命令または代入の先頭が識別子である必要があります", {
      sourceLine,
    });
  }
  const head = headToken.value;
  cursor.index += 1;

  const keywordOps = new Set([
    "skip",
    "spbarr",
    "load",
    "store",
    "beqz",
    "jmp",
  ]);

  if (keywordOps.has(head)) {
    const op = head;
    const textTrimmed = text.trim();
    switch (op) {
      case "skip":
        ensureEof(cursor, sourceLine);
        return { op: "skip", text: textTrimmed };
      case "spbarr":
        ensureEof(cursor, sourceLine);
        return { op: "spbarr", text: textTrimmed };
      case "load": {
        const dest = expectIdentifier(cursor, sourceLine);
        expectSymbol(cursor, ",", sourceLine);
        const addr = parseExpr(cursor, sourceLine);
        ensureEof(cursor, sourceLine);
        return { op: "load", dest, addr, text: textTrimmed };
      }
      case "store": {
        const src = expectIdentifier(cursor, sourceLine);
        expectSymbol(cursor, ",", sourceLine);
        const addr = parseExpr(cursor, sourceLine);
        ensureEof(cursor, sourceLine);
        return { op: "store", src, addr, text: textTrimmed };
      }
      case "beqz": {
        const cond = expectIdentifier(cursor, sourceLine);
        expectSymbol(cursor, ",", sourceLine);
        const target = expectIdentifier(cursor, sourceLine);
        ensureEof(cursor, sourceLine);
        return { op: "beqz", cond, target, targetPc: -1, text: textTrimmed };
      }
      case "jmp": {
        const target = parseExpr(cursor, sourceLine);
        ensureEof(cursor, sourceLine);
        return { op: "jmp", target, text: textTrimmed };
      }
      default:
        // fallthrough to assignment/cmov handling
        break;
    }
  }

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

function expectSymbol(
  cursor: TokenCursor,
  value: string,
  sourceLine: number,
): void {
  const token = cursor.tokens[cursor.index];
  if (token?.kind === "symbol" && token.value === value) {
    cursor.index += 1;
    return;
  }
  throw new ParseError(`記号 '${value}' が必要です`, {
    sourceLine,
    at: cursor.index,
  });
}

function maybeSymbol(cursor: TokenCursor, value: string): boolean {
  const token = cursor.tokens[cursor.index];
  if (token?.kind === "symbol" && token.value === value) {
    cursor.index += 1;
    return true;
  }
  return false;
}

function parseExpr(cursor: TokenCursor, sourceLine: number): Expr {
  return parseBinOp(cursor, sourceLine, 0);
}

const PRECEDENCE: Record<BinaryOp, number> = {
  "&": 1,
  "+": 2,
  "-": 2,
  "*": 3,
};

const BINARY_OPS = new Set<BinaryOp>(["&", "+", "-", "*"]);

function parseBinOp(
  cursor: TokenCursor,
  sourceLine: number,
  minPrec: number,
): Expr {
  let left = parsePrimary(cursor, sourceLine);

  while (true) {
    const token = cursor.tokens[cursor.index];
    if (!token || token.kind !== "symbol") break;
    const op = token.value as BinaryOp;
    if (!BINARY_OPS.has(op)) break;
    const prec = PRECEDENCE[op];
    if (prec < minPrec) break;

    cursor.index += 1;
    const right = parseBinOp(cursor, sourceLine, prec + 1);
    left = { kind: "binop", op, left, right };
  }

  return left;
}

function parsePrimary(cursor: TokenCursor, sourceLine: number): Expr {
  const token = cursor.tokens[cursor.index];
  if (!token) {
    throw new ParseError("式が必要です", { sourceLine });
  }

  if (token.kind === "identifier") {
    cursor.index += 1;
    return { kind: "reg", name: token.value };
  }

  if (token.kind === "int") {
    cursor.index += 1;
    return { kind: "int", value: Number(token.value) };
  }

  if (token.kind === "symbol" && token.value === "(") {
    cursor.index += 1;
    const expr = parseExpr(cursor, sourceLine);
    expectSymbol(cursor, ")", sourceLine);
    return expr;
  }

  throw new ParseError("無効な式です", { sourceLine, at: cursor.index });
}

function ensureEof(cursor: TokenCursor, sourceLine: number): void {
  if (cursor.index !== cursor.tokens.length) {
    throw new ParseError("不要なトークンがあります", {
      sourceLine,
      at: cursor.index,
    });
  }
}
