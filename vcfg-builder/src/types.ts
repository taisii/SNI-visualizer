// AST およびプログラム構造の型定義

export type Identifier = string;
export type Register = Identifier;
export type BinaryOp = "+" | "-" | "*" | "&";

export type Expr =
  | { kind: "reg"; name: Register }
  | { kind: "int"; value: number }
  | { kind: "binop"; op: BinaryOp; left: Expr; right: Expr };

export type Instruction =
  | { op: "skip"; text: string }
  | { op: "assign"; dest: Register; expr: Expr; text: string }
  | { op: "load"; dest: Register; addr: Expr; text: string }
  | { op: "store"; src: Register; addr: Expr; text: string }
  | { op: "beqz"; cond: Register; target: Identifier; targetPc: number; text: string }
  | { op: "jmp"; target: Expr; text: string }
  | { op: "spbarr"; text: string }
  | { op: "cmov"; dest: Register; cond: Expr; value: Expr; text: string };

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
