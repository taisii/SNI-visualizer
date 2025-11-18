import { ParseError, resolveJump } from "@/muasm-ast";
import type { Expr, Identifier, Program, JumpResolution } from "@/muasm-ast";

export type ProgramContext = {
  program: Program;
  resolveLabel(label: Identifier): number;
  resolveJump(expr: Expr): JumpResolution;
  hasPc(pc: number): boolean;
};

export function createProgramContext(program: Program): ProgramContext {
  const resolveLabel = (label: Identifier) => {
    const target = program.labels.get(label);
    if (target === undefined) {
      throw new ParseError(`ラベル '${label}' を解決できませんでした`);
    }
    return target;
  };

  const resolveJumpTarget = (expr: Expr): JumpResolution =>
    resolveJump(expr, program.labels);

  const hasPc = (pc: number) => pc >= 0 && pc < program.instructions.length;

  return { program, resolveLabel, resolveJump: resolveJumpTarget, hasPc };
}
