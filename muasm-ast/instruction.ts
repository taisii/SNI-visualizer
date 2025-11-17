// MuASM 命令 AST の型定義

import type { Expr, Identifier, Register } from "./expr";

export type Instruction =
  | { op: "skip"; text: string }
  | { op: "assign"; dest: Register; expr: Expr; text: string }
  | { op: "load"; dest: Register; addr: Expr; text: string }
  | { op: "store"; src: Register; addr: Expr; text: string }
  | {
      op: "beqz";
      cond: Register;
      target: Identifier;
      targetPc: number;
      text: string;
    }
  | { op: "jmp"; target: Expr; text: string }
  | { op: "spbarr"; text: string }
  | { op: "cmov"; dest: Register; cond: Expr; value: Expr; text: string };
