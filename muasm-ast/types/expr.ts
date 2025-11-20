// 基本的な式と識別子の型定義

export type Identifier = string;
export type Register = Identifier;
export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "&"
  | "<"
  | ">"
  | "<="
  | ">="
  | "="
  | "!=";

export type Expr =
  | { kind: "reg"; name: Register }
  | { kind: "int"; value: number }
  | { kind: "binop"; op: BinaryOp; left: Expr; right: Expr };
