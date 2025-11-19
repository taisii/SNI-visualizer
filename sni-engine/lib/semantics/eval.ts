import type { Expr } from "@/muasm-ast";
import { type AbsState, type RelValue, defaultRegRel } from "../core/state";
import { relJoin, getReg, getMem } from "../core/state-ops";
import { stringifyExpr } from "./parse";

export function evalExpr(state: AbsState, expr: Expr): RelValue {
  switch (expr.kind) {
    case "reg":
      return getReg(state, expr.name);
    case "int":
      return { ns: "EqLow", sp: "EqLow" };
    case "binop":
      return relJoin(evalExpr(state, expr.left), evalExpr(state, expr.right));
    default:
      return defaultRegRel();
  }
}

export function getMemByExpr(state: AbsState, expr: Expr): RelValue {
  if (expr.kind === "reg") return getMem(state, expr.name);
  return getMem(state, stringifyExpr(expr));
}

export function defaultMemLabel(expr: Expr): string {
  return expr.kind === "reg" ? expr.name : stringifyExpr(expr);
}
