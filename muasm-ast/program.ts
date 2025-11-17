// MuASM プログラム構造の型定義

import type { Instruction } from "./instruction";
import type { Expr, Identifier } from "./expr";

export type LabeledInstr = {
  label?: Identifier;
  instr: Instruction;
  sourceLine: number;
  pc: number;
};

export type LabelTable = Map<Identifier, number>;

export type Program = {
  instructions: LabeledInstr[];
  labels: LabelTable;
};

// 解析／パーサーで利用するユーティリティのため再エクスポート
export type { Instruction, Expr, Identifier };
