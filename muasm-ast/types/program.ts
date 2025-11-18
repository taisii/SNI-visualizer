// MuASM プログラム構造の型定義

import type { Instruction } from "./instruction";
import type { Identifier } from "./expr";

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
