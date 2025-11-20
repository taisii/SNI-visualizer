import type { Instruction } from "@/muasm-ast";

export const normalizeOperand = (token: string): string =>
  token.replace(/,+$/g, "");

type AnyExpr = {
  kind?: string;
  name?: unknown;
  value?: unknown;
  op?: unknown;
  left?: unknown;
  right?: unknown;
  [key: string]: unknown;
};

export function stringifyExpr(expr: AnyExpr | undefined): string {
  const e = expr;
  switch (e?.kind) {
    case "reg":
      return typeof e.name === "string" ? e.name : "";
    case "int":
      return typeof e.value === "number" ? String(e.value) : "";
    case "binop":
      return `(${stringifyExpr(e.left as AnyExpr)}${
        typeof e.op === "string" ? e.op : ""
      }${stringifyExpr(e.right as AnyExpr)})`;
    default:
      return "";
  }
}

// 文字列命令を最小限の AST に変換するフォールバック
export function toAstFromString(
  op: string,
  rest: string[],
): Instruction | undefined {
  switch (op) {
    case "":
    case "skip":
      return { op: "skip", text: "skip" } as Instruction;
    case "assign": {
      const [dst, src] = rest;
      if (!dst || !src) return undefined;
      return {
        op: "assign",
        dest: dst,
        expr: { kind: "reg", name: src },
        text: `assign ${dst} ${src}`,
      } as Instruction;
    }
    case "op": {
      const [dst, a, b] = rest;
      if (!dst || !a || !b) return undefined;
      return {
        op: "assign",
        dest: dst,
        expr: {
          kind: "binop",
          op: "+",
          left: { kind: "reg", name: a },
          right: { kind: "reg", name: b },
        },
        text: `op ${dst} ${a} ${b}`,
      } as Instruction;
    }
    case "load": {
      const [dst, addr] = rest;
      if (!dst || !addr) return undefined;
      return {
        op: "load",
        dest: dst,
        addr: { kind: "reg", name: addr },
        text: `load ${dst} ${addr}`,
      } as Instruction;
    }
    case "store": {
      const [src, addr] = rest;
      if (!src || !addr) return undefined;
      return {
        op: "store",
        src,
        addr: { kind: "reg", name: addr },
        text: `store ${src} ${addr}`,
      } as Instruction;
    }
    case "cmov": {
      const [dst, cond, src] = rest;
      if (!dst || !cond || !src) return undefined;
      return {
        op: "cmov",
        dest: dst,
        cond: { kind: "reg", name: cond },
        value: { kind: "reg", name: src },
        text: `cmov ${dst} ${cond} ${src}`,
      } as Instruction;
    }
    case "spbarr":
      return { op: "spbarr", text: "spbarr" } as Instruction;
    case "beqz":
    case "bnez": {
      const [cond] = rest;
      if (!cond) return undefined;
      return {
        op,
        cond,
        target: cond,
        targetPc: -1,
        text: `${op} ${cond}`,
      } as Instruction;
    }
    case "jmp": {
      const [target] = rest;
      if (!target) return undefined;
      return {
        op: "jmp",
        target: { kind: "reg", name: target },
        text: `jmp ${target}`,
      } as Instruction;
    }
    default:
      return undefined;
  }
}
