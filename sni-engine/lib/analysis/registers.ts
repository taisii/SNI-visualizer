import type { StaticGraph } from "@/lib/analysis-schema";
import type { Expr, Instruction } from "@/muasm-ast";
import { normalizeOperand } from "../semantics/parse";

type Options = { allowTextFallback?: boolean };

const INSTR_KEYWORDS = new Set([
  "assign",
  "op",
  "load",
  "store",
  "cmov",
  "beqz",
  "bnez",
  "jmp",
  "spbarr",
  "skip",
]);

export function collectRegisterNames(
  graph: StaticGraph,
  opts: Options = {},
): Set<string> {
  const { allowTextFallback = true } = opts;
  const regs = new Set<string>();

  for (const n of graph.nodes) {
    if (n.instructionAst) {
      collectFromAst(regs, n.instructionAst);
    } else if (allowTextFallback) {
      collectFromText(regs, n.instruction ?? n.label ?? "");
    }
  }

  return regs;
}

function collectFromAst(regs: Set<string>, instr: Instruction) {
  const addReg = (r: string | undefined) => {
    if (!r) return;
    regs.add(r);
  };
  const collectExpr = (expr: Expr | undefined) => {
    if (!expr) return;
    switch (expr.kind) {
      case "reg":
        addReg(expr.name);
        break;
      case "binop":
        collectExpr(expr.left);
        collectExpr(expr.right);
        break;
      default:
        break;
    }
  };

  switch (instr.op) {
    case "assign":
      addReg(instr.dest);
      collectExpr(instr.expr);
      break;
    case "load":
      addReg(instr.dest);
      collectExpr(instr.addr);
      break;
    case "store":
      addReg(instr.src);
      collectExpr(instr.addr);
      break;
    case "cmov":
      addReg(instr.dest);
      collectExpr(instr.cond);
      collectExpr(instr.value);
      break;
    case "beqz":
      addReg(instr.cond);
      break;
    case "bnez":
      addReg(instr.cond);
      break;
    case "jmp":
      collectExpr(instr.target);
      break;
    case "spbarr":
    case "skip":
      break;
  }
}

function collectFromText(regs: Set<string>, text: string) {
  const tokenRe = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
  const tokens = text.match(tokenRe) ?? [];
  const opToken = tokens[0];
  tokens.forEach((raw, idx) => {
    const t = normalizeOperand(raw);
    if (idx === 0 && INSTR_KEYWORDS.has(t)) return;
    if ((opToken === "beqz" || opToken === "bnez") && idx === tokens.length - 1)
      return; // ラベル除外
    if (opToken === "jmp" && idx >= 1 && idx === tokens.length - 1) return;
    if (INSTR_KEYWORDS.has(t)) return;
    regs.add(t);
  });
}
