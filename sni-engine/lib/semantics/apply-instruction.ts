import type { GraphNode } from "@/lib/analysis-schema";
import type { Instruction, Expr } from "@/muasm-ast";
import { join, type LatticeValue } from "../core/lattice";
import { cloneState, type AbsState, type RelValue } from "../core/state";
import { getMem, getReg, setMem, setReg } from "../core/state-ops";
import {
  updateCtrlObsNS,
  updateCtrlObsSpec,
  updateMemObsNS,
  updateMemObsSpec,
} from "../core/observations";
import { defaultMemLabel, evalExpr, getMemByExpr } from "./eval";
import { normalizeOperand, stringifyExpr, toAstFromString } from "./parse";

export type ExecMode = "NS" | "Speculative";

function assertNever(instr: never, node: GraphNode): never {
  throw new Error(
    `unsupported instruction '${(instr as Instruction).op}' at pc=${node.pc}`,
  );
}

const toControlObsId = (pc: number) => String(pc);

function toMemObsId(pc: number, addr?: Expr): string | undefined {
  if (!addr) return undefined;
  return `${pc}:${stringifyExpr(addr)}`;
}

export function applyInstruction(
  node: GraphNode,
  state: AbsState,
  mode: ExecMode,
): AbsState {
  const next = cloneState(state);
  const instrRaw = node.instruction ?? node.label ?? "";
  const [opRaw, ...restRaw] = instrRaw.trim().split(/\s+/);
  const op = normalizeOperand(opRaw);
  const rest = restRaw.map(normalizeOperand);
  const ast =
    (node.instructionAst as Instruction | undefined) ??
    toAstFromString(op, rest);

  const ctrlObsId = toControlObsId(node.pc);

  if (!ast) {
    throw new Error(`unsupported instruction '${op}' at pc=${node.pc}`);
  }

  const memObsId =
    ast.op === "load" || ast.op === "store"
      ? toMemObsId(node.pc, ast.addr)
      : undefined;

  const setValue = (kind: "reg" | "mem", name: string, value: RelValue) => {
    if (mode === "NS") {
      kind === "reg" ? setReg(next, name, value) : setMem(next, name, value);
    } else {
      const prev = kind === "reg" ? getReg(next, name) : getMem(next, name);
      const updated: RelValue = { ns: prev.ns, sp: join(prev.sp, value.sp) };
      kind === "reg"
        ? setReg(next, name, updated)
        : setMem(next, name, updated);
    }
  };

  const observeMem = (val: LatticeValue) => {
    if (!memObsId) return;
    if (mode === "NS") {
      updateMemObsNS(next, memObsId, val);
    } else {
      updateMemObsSpec(next, memObsId, val);
    }
  };

  switch (ast.op) {
    case "skip":
      break;
    case "assign": {
      const v = evalExpr(state, ast.expr);
      setValue("reg", ast.dest, v);
      break;
    }
    case "load": {
      const lAddr = evalExpr(state, ast.addr);
      const lVal = getMemByExpr(state, ast.addr);
      const v: RelValue = {
        ns: join(lVal.ns, lAddr.ns),
        sp: join(lVal.sp, lAddr.sp),
      };
      const observed =
        mode === "NS"
          ? lAddr.ns === "EqHigh" || lAddr.ns === "Leak" || lAddr.ns === "Top"
            ? "EqHigh"
            : "EqLow"
          : lAddr.sp === "EqHigh" || lAddr.sp === "Leak" || lAddr.sp === "Top"
            ? "EqHigh"
            : "EqLow";
      observeMem(observed);
      setValue("reg", ast.dest, v);
      break;
    }
    case "store": {
      const lAddr = evalExpr(state, ast.addr);
      const lVal = getReg(state, ast.src);
      const v: RelValue = {
        ns: join(lVal.ns, lAddr.ns),
        sp: join(lVal.sp, lAddr.sp),
      };
      const observed =
        mode === "NS"
          ? lAddr.ns === "EqHigh" || lAddr.ns === "Leak" || lAddr.ns === "Top"
            ? "EqHigh"
            : "EqLow"
          : lAddr.sp === "EqHigh" || lAddr.sp === "Leak" || lAddr.sp === "Top"
            ? "EqHigh"
            : "EqLow";
      observeMem(observed);
      setValue("mem", defaultMemLabel(ast.addr), v);
      break;
    }
    case "cmov": {
      const v = getJoinOfCondAndVal(state, ast.cond, ast.value);
      setValue("reg", ast.dest, v);
      break;
    }
    case "spbarr":
      break;
    case "beqz": {
      const level = getReg(state, ast.cond);
      const observed = mode === "NS" ? level.ns : level.sp;
      if (mode === "NS") {
        updateCtrlObsNS(next, ctrlObsId, observed);
      } else {
        updateCtrlObsSpec(next, ctrlObsId, observed);
      }
      break;
    }
    case "jmp": {
      const level: LatticeValue = "EqLow";
      if (mode === "NS") {
        updateCtrlObsNS(next, ctrlObsId, level);
      } else {
        updateCtrlObsSpec(next, ctrlObsId, level);
      }
      break;
    }
    default: {
      assertNever(ast, node);
    }
  }

  return next;
}

function getJoinOfCondAndVal(state: AbsState, cond: Expr, value: Expr): RelValue {
  return joinPair(evalExpr(state, cond), evalExpr(state, value));
}

function joinPair(a: RelValue, b: RelValue): RelValue {
  return { ns: join(a.ns, b.ns), sp: join(a.sp, b.sp) };
}
