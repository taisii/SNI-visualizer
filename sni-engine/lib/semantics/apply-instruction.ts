import type { GraphNode, TraceStep } from "@/lib/analysis-schema";
import type { Instruction, Expr } from "@/muasm-ast";
import type { LatticeValue } from "../core/lattice";
import {
  cloneState,
  type AbsState,
  type RelValue,
  joinSecurity,
  isHighLike,
  securityToLattice,
  makeRel,
} from "../core/state";
import { getMem, getReg, setMem, setReg } from "../core/state-ops";
import {
  updateCtrlObsNS,
  updateCtrlObsSpec,
  updateMemObsNS,
  updateMemObsSpec,
} from "../core/observations";
import { defaultMemLabel, evalExpr, getMemByExpr } from "./eval";
import { normalizeOperand, stringifyExpr, toAstFromString } from "./parse";

export type ExecMode = TraceStep["executionMode"];

function assertNever(instr: never, node: GraphNode): never {
  throw new Error(
    `unsupported instruction '${(instr as Instruction).op}' at pc=${node.pc}`,
  );
}

const toControlObsId = (pc: number) => String(pc);
const toControlTargetObsId = (pc: number, target?: Expr) => {
  const suffix = stringifyExpr(target);
  return suffix ? `${pc}:target:${suffix}` : `${pc}:target`;
};

function toMemObsId(pc: number, addr?: Expr): string | undefined {
  if (!addr) return undefined;
  return `${pc}:${stringifyExpr(addr)}`;
}

export function applyInstruction(
  node: GraphNode,
  state: AbsState,
  executionMode: ExecMode,
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
    if (executionMode === "NS") {
      const v = makeRel(value.ns, value.sp);
      kind === "reg" ? setReg(next, name, v) : setMem(next, name, v);
    } else {
      const prev = kind === "reg" ? getReg(next, name) : getMem(next, name);
      const updated: RelValue = makeRel(
        prev.ns,
        joinSecurity(prev.sp, value.sp),
      );
      kind === "reg"
        ? setReg(next, name, updated)
        : setMem(next, name, updated);
    }
  };

  const observeMem = (val: LatticeValue) => {
    if (!memObsId) return;
    if (executionMode === "NS") {
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
      const v: RelValue = makeRel(
        joinSecurity(lVal.ns, lAddr.ns),
        joinSecurity(lVal.sp, lAddr.sp),
      );
      const observedPoint = executionMode === "NS" ? lAddr.ns : lAddr.sp;
      observeMem(isHighLike(observedPoint) ? "EqHigh" : "EqLow");
      setValue("reg", ast.dest, v);
      break;
    }
    case "store": {
      const lAddr = evalExpr(state, ast.addr);
      const lVal = getReg(state, ast.src);
      const v: RelValue = makeRel(
        joinSecurity(lVal.ns, lAddr.ns),
        joinSecurity(lVal.sp, lAddr.sp),
      );
      const observedPoint = executionMode === "NS" ? lAddr.ns : lAddr.sp;
      observeMem(isHighLike(observedPoint) ? "EqHigh" : "EqLow");
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
    case "beqz":
    case "bnez": {
      const level = getReg(state, ast.cond);
      const observed = executionMode === "NS" ? level.ns : level.sp;
      if (executionMode === "NS") {
        updateCtrlObsNS(next, ctrlObsId, securityToLattice(observed));
      } else {
        updateCtrlObsSpec(next, ctrlObsId, securityToLattice(observed));
      }
      break;
    }
    case "jmp": {
      const targetLevel = evalExpr(state, ast.target);
      const observed = executionMode === "NS" ? targetLevel.ns : targetLevel.sp;
      const targetObsId = toControlTargetObsId(node.pc, ast.target);
      if (executionMode === "NS") {
        updateCtrlObsNS(next, targetObsId, securityToLattice(observed));
      } else {
        updateCtrlObsSpec(next, targetObsId, securityToLattice(observed));
      }
      break;
    }
    default: {
      assertNever(ast, node);
    }
  }

  return next;
}

function getJoinOfCondAndVal(
  state: AbsState,
  cond: Expr,
  value: Expr,
): RelValue {
  return joinPair(evalExpr(state, cond), evalExpr(state, value));
}

function joinPair(a: RelValue, b: RelValue): RelValue {
  return { ns: joinSecurity(a.ns, b.ns), sp: joinSecurity(a.sp, b.sp) };
}
