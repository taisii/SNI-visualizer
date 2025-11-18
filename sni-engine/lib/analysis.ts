import type {
  AnalysisResult,
  ExecutionTrace,
  GraphEdge,
  GraphNode,
  StaticGraph,
  TraceStep,
  TraceMode,
} from "@/lib/analysis-schema";
import { ANALYSIS_SCHEMA_VERSION } from "@/lib/analysis-schema";
import { join, type LatticeValue, toDisplay } from "./lattice";
import {
  type AbsState,
  type InitPolicy,
  bottomState,
  cloneState,
  initState,
  type RelValue,
  defaultMemRel,
  defaultRegRel,
} from "./state";
import { parseGraph } from "./graph";
import type { Expr, Instruction } from "@/muasm-ast";

type Mode = "NS" | "Speculative";

export type AnalyzeOptions = {
  iterationCap?: number;
  policy?: InitPolicy;
  entryRegs?: string[];
  entryNodeId?: string;
  maxSteps?: number;
  traceMode?: TraceMode;
};

const DEFAULT_CAP = 10_000;
const DEFAULT_MAX_STEPS = 500;
const DEFAULT_TRACE_MODE: TraceMode = "bfs";
const normalizeOperand = (token: string): string => token.replace(/,+$/g, "");

const INSTR_KEYWORDS = new Set([
  "assign",
  "op",
  "load",
  "store",
  "cmov",
  "beqz",
  "jmp",
  "spbarr",
  "skip",
]);

function collectRegisterNames(graph: StaticGraph): Set<string> {
  const regs = new Set<string>();
  const tokenRe = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
  for (const n of graph.nodes) {
    const text = n.instruction ?? n.label ?? "";
    const tokens = text.match(tokenRe) ?? [];
    const opToken = tokens[0];
    tokens.forEach((raw, idx) => {
      const t = normalizeOperand(raw);
      if (idx === 0 && INSTR_KEYWORDS.has(t)) return;
      if (opToken === "beqz" && idx === tokens.length - 1) return; // ラベル除外
      if (opToken === "jmp" && idx >= 1 && idx === tokens.length - 1) return;
      if (INSTR_KEYWORDS.has(t)) return;
      regs.add(t);
    });
  }
  return regs;
}

function seedRegs(state: AbsState, regs: Set<string>) {
  for (const r of regs) {
    if (!state.regs.has(r)) {
      state.regs.set(r, defaultRegRel());
    }
  }
}

function getEntryNode(
  graph: StaticGraph,
  entryNodeId?: string,
  nodeMap?: Map<string, GraphNode>,
): GraphNode {
  if (entryNodeId) {
    const n =
      nodeMap?.get(entryNodeId) ??
      graph.nodes.find((v) => v.id === entryNodeId);
    if (!n) throw new Error(`entry node ${entryNodeId} not found`);
    return n;
  }
  return graph.nodes[0];
}

function assertNever(instr: never, node: GraphNode): never {
  throw new Error(
    `unsupported instruction '${(instr as Instruction).op}' at pc=${node.pc}`,
  );
}

function getAdj(graph: StaticGraph): Map<string, GraphEdge[]> {
  const adj = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    const list = adj.get(e.source);
    if (list) list.push(e);
  }
  return adj;
}

// MEMLEAK 用: メモリアクセス観測の NS 側更新
function updateMemObsNS(
  state: AbsState,
  obsId: string,
  observed: LatticeValue,
) {
  // フェーズ2以降: NS でも Low/High を区別して履歴を構築する
  const prev = state.obsMem.get(obsId) ?? "Bot";
  const next =
    observed === "EqHigh" || observed === "Leak" || observed === "Top"
      ? "EqHigh"
      : "EqLow";
  state.obsMem.set(obsId, join(prev, next));
}

// MEMLEAK 用: メモリアクセス観測の Spec 側更新
function updateMemObsSpec(
  state: AbsState,
  obsId: string,
  observed: LatticeValue,
) {
  const prev = state.obsMem.get(obsId) ?? "Bot";
  if (observed === "EqHigh" || observed === "Leak" || observed === "Top") {
    const next = prev === "EqHigh" ? "EqHigh" : "Leak"; // baseline High のみ非違反、それ以外は漏洩
    state.obsMem.set(obsId, join(prev, next));
  } else if (observed === "EqLow") {
    state.obsMem.set(obsId, join(prev, "EqLow"));
  }
}

// CTRLLEAK 用: 制御フロー観測の NS 側更新
function updateCtrlObsNS(
  state: AbsState,
  obsId: string,
  observed: LatticeValue,
) {
  const prev = state.obsCtrl.get(obsId) ?? "Bot";
  const next =
    observed === "EqHigh" || observed === "Leak" || observed === "Top"
      ? "EqHigh"
      : "EqLow";
  state.obsCtrl.set(obsId, join(prev, next));
}

// CTRLLEAK 用: 制御フロー観測の Spec 側更新
function updateCtrlObsSpec(
  state: AbsState,
  obsId: string,
  observed: LatticeValue,
) {
  const prev = state.obsCtrl.get(obsId) ?? "Bot";
  if (observed === "EqHigh" || observed === "Leak" || observed === "Top") {
    const next = prev === "EqHigh" ? "EqHigh" : "Leak";
    state.obsCtrl.set(obsId, join(prev, next));
  } else if (observed === "EqLow") {
    state.obsCtrl.set(obsId, join(prev, "EqLow"));
  }
}

function relJoin(a: RelValue, b: RelValue): RelValue {
  return { ns: join(a.ns, b.ns), sp: join(a.sp, b.sp) };
}

function getReg(state: AbsState, name: string): RelValue {
  return state.regs.get(name) ?? defaultRegRel();
}

function getMem(state: AbsState, name: string): RelValue {
  return state.mem.get(name) ?? defaultMemRel();
}

function setReg(state: AbsState, name: string, value: RelValue) {
  state.regs.set(name, value);
}

function setMem(state: AbsState, name: string, value: RelValue) {
  state.mem.set(name, value);
}

function stringifyExpr(expr: Expr): string {
  switch (expr.kind) {
    case "reg":
      return expr.name;
    case "int":
      return String(expr.value);
    case "binop":
      return `(${stringifyExpr(expr.left)}${expr.op}${stringifyExpr(expr.right)})`;
    default:
      return "";
  }
}

function evalExpr(state: AbsState, expr: Expr): RelValue {
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

function getMemByExpr(state: AbsState, expr: Expr): RelValue {
  if (expr.kind === "reg") return getMem(state, expr.name);
  return getMem(state, stringifyExpr(expr));
}

// 文字列命令を最小限の AST に変換するフォールバック。既存の文字列パスと同等の
// 解析結果になるよう、演算子は意味を持たない加算として扱う。
function toAstFromString(op: string, rest: string[]): Instruction | undefined {
  switch (op) {
    case "":
    case "skip":
      return { op: "skip", text: "skip" };
    case "assign": {
      const [dst, src] = rest;
      if (!dst || !src) return undefined;
      return {
        op: "assign",
        dest: dst,
        expr: { kind: "reg", name: src },
        text: `assign ${dst} ${src}`,
      };
    }
    case "op": {
      const [dst, a, b] = rest;
      if (!dst || !a || !b) return undefined;
      return {
        op: "assign",
        dest: dst,
        expr: {
          kind: "binop",
          op: "+",
          left: { kind: "reg", name: a },
          right: { kind: "reg", name: b },
        },
        text: `op ${dst} ${a} ${b}`,
      };
    }
    case "load": {
      const [dst, addr] = rest;
      if (!dst || !addr) return undefined;
      return {
        op: "load",
        dest: dst,
        addr: { kind: "reg", name: addr },
        text: `load ${dst} ${addr}`,
      };
    }
    case "store": {
      const [src, addr] = rest;
      if (!src || !addr) return undefined;
      return {
        op: "store",
        src,
        addr: { kind: "reg", name: addr },
        text: `store ${src} ${addr}`,
      };
    }
    case "cmov": {
      const [dst, cond, src] = rest;
      if (!dst || !cond || !src) return undefined;
      return {
        op: "cmov",
        dest: dst,
        cond: { kind: "reg", name: cond },
        value: { kind: "reg", name: src },
        text: `cmov ${dst} ${cond} ${src}`,
      };
    }
    case "spbarr":
      return { op: "spbarr", text: "spbarr" };
    case "beqz": {
      const [cond] = rest;
      if (!cond) return undefined;
      return {
        op: "beqz",
        cond,
        target: cond,
        targetPc: -1,
        text: `beqz ${cond}`,
      };
    }
    case "jmp": {
      const [target] = rest;
      if (!target) return undefined;
      return {
        op: "jmp",
        target: { kind: "reg", name: target },
        text: `jmp ${target}`,
      };
    }
    default:
      return undefined;
  }
}

function applyInstruction(
  node: GraphNode,
  state: AbsState,
  mode: Mode,
): AbsState {
  const next = cloneState(state);
  const instrRaw = node.instruction ?? node.label ?? "";
  const [opRaw, ...restRaw] = instrRaw.trim().split(/\s+/);
  const op = normalizeOperand(opRaw);
  const rest = restRaw.map(normalizeOperand);
  const ast =
    (node.instructionAst as Instruction | undefined) ??
    toAstFromString(op, rest);

  const ctrlObsId = String(node.pc);

  if (!ast) {
    throw new Error(`unsupported instruction '${op}' at pc=${node.pc}`);
  }

  const memObsId =
    ast.op === "load" || ast.op === "store"
      ? `${node.pc}:${stringifyExpr(ast.addr)}`
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
      setValue("mem", stringifyExpr(ast.addr), v);
      break;
    }
    case "cmov": {
      const v = relJoin(evalExpr(state, ast.cond), evalExpr(state, ast.value));
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

function mergeState(
  dst: AbsState,
  src: AbsState,
  opts: {
    regs?: boolean;
    mem?: boolean;
    obsMem?: boolean;
    obsCtrl?: boolean;
  } = {},
): { changed: boolean } {
  const { regs = true, mem = true, obsMem = true, obsCtrl = true } = opts;
  let changed = false;
  if (regs) {
    for (const [k, v] of src.regs) {
      const cur = dst.regs.get(k) ?? defaultRegRel();
      const n = relJoin(cur, v);
      if (n.ns !== cur.ns || n.sp !== cur.sp) {
        dst.regs.set(k, n);
        changed = true;
      }
    }
  }
  if (mem) {
    for (const [k, v] of src.mem) {
      const cur = dst.mem.get(k) ?? defaultMemRel();
      const n = relJoin(cur, v);
      if (n.ns !== cur.ns || n.sp !== cur.sp) {
        dst.mem.set(k, n);
        changed = true;
      }
    }
  }
  if (obsMem) {
    for (const [k, v] of src.obsMem) {
      const cur = dst.obsMem.get(k) ?? "Bot";
      const n = join(cur, v);
      if (n !== cur) {
        dst.obsMem.set(k, n);
        changed = true;
      }
    }
  }
  if (obsCtrl) {
    for (const [k, v] of src.obsCtrl) {
      const cur = dst.obsCtrl.get(k) ?? "Bot";
      const n = join(cur, v);
      if (n !== cur) {
        dst.obsCtrl.set(k, n);
        changed = true;
      }
    }
  }
  return { changed };
}

function stateHasViolation(state: AbsState): boolean {
  // 仕様: 観測チャンネルに Leak/Top が現れた場合のみ違反とみなす。
  // 高機密がレジスタ・メモリに拡散しても観測されなければ許容とする。
  for (const v of state.obsMem.values()) {
    if (v === "Leak" || v === "Top") return true;
  }
  for (const v of state.obsCtrl.values()) {
    if (v === "Leak" || v === "Top") return true;
  }
  return false;
}

function stateToSections(state: AbsState) {
  const regs: Record<string, ReturnType<typeof toDisplay>> = {};
  const mem: Record<string, ReturnType<typeof toDisplay>> = {};
  const obsMem: Record<string, ReturnType<typeof toDisplay>> = {};
  const obsCtrl: Record<string, ReturnType<typeof toDisplay>> = {};
  for (const [k, v] of state.regs) {
    const joined = join(v.ns, v.sp);
    regs[k] = {
      ...toDisplay(joined),
      detail: { ns: v.ns, sp: v.sp, join: joined },
    };
  }
  for (const [k, v] of state.mem) {
    const joined = join(v.ns, v.sp);
    mem[k] = {
      ...toDisplay(joined),
      detail: { ns: v.ns, sp: v.sp, join: joined },
    };
  }
  for (const [k, v] of state.obsMem) obsMem[String(k)] = toDisplay(v);
  for (const [k, v] of state.obsCtrl) obsCtrl[String(k)] = toDisplay(v);

  let hasMemViolation = false;
  for (const v of state.obsMem.values()) {
    if (v === "Leak" || v === "Top") {
      hasMemViolation = true;
      break;
    }
  }

  let hasCtrlViolation = false;
  for (const v of state.obsCtrl.values()) {
    if (v === "Leak" || v === "Top") {
      hasCtrlViolation = true;
      break;
    }
  }

  return {
    sections: [
      {
        id: "regs",
        title: "Registers",
        type: "key-value" as const,
        data: regs,
      },
      { id: "mem", title: "Memory", type: "key-value" as const, data: mem },
      {
        id: "obsMem",
        title: "Memory Observations",
        type: "key-value" as const,
        data: obsMem,
        alert: hasMemViolation,
      },
      {
        id: "obsCtrl",
        title: "Control Observations",
        type: "key-value" as const,
        data: obsCtrl,
        alert: hasCtrlViolation,
      },
    ],
  };
}

export async function analyzeVCFG(
  rawGraph: StaticGraph,
  opts: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const traceMode = opts.traceMode ?? DEFAULT_TRACE_MODE;
  let graph: StaticGraph;
  try {
    graph = parseGraph(rawGraph);
  } catch (err) {
    return {
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      graph: rawGraph,
      trace: { steps: [] },
      traceMode,
      result: "SNI_Violation",
      error: {
        type: "ParseError",
        message: err instanceof Error ? err.message : String(err),
        detail: err,
      },
    };
  }
  const iterationCap = opts.iterationCap ?? DEFAULT_CAP;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const usedRegs = collectRegisterNames(graph);
  const entryNode = getEntryNode(graph, opts.entryNodeId, nodeMap);
  const adj = getAdj(graph);

  const states = new Map<string, Map<Mode, AbsState>>();
  const ensureState = (nodeId: string, mode: Mode): AbsState => {
    const m = states.get(nodeId) ?? new Map<Mode, AbsState>();
    states.set(nodeId, m);
    const st = m.get(mode) ?? bottomState();
    m.set(mode, st);
    return st;
  };

  const entryMode: Mode = entryNode.type === "spec" ? "Speculative" : "NS";
  ensureState(entryNode.id, entryMode);
  const seededInit = initState(opts.policy, opts.entryRegs);
  seedRegs(seededInit, usedRegs);
  states.get(entryNode.id)?.set(entryMode, seededInit);

  const worklist: Array<{ nodeId: string; mode: Mode }> = [
    { nodeId: entryNode.id, mode: entryMode },
  ];
  const takeNext = (): { nodeId: string; mode: Mode } | undefined =>
    traceMode === "single-path" ? worklist.pop() : worklist.shift();

  let iterations = 0;
  const stepLogs: TraceStep[] = [];
  let stepId = 0;

  const init = states.get(entryNode.id)?.get(entryMode) ?? bottomState();
  stepLogs.push({
    stepId,
    nodeId: "", // entry はどのノードにもフォーカスさせない
    description: "(entry)",
    executionMode: entryMode,
    state: stateToSections(init),
    isViolation: stateHasViolation(init),
  });

  while (worklist.length > 0) {
    const shifted = takeNext();
    if (!shifted) break;
    const { nodeId, mode } = shifted;
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const inState = ensureState(nodeId, mode);
    seedRegs(inState, usedRegs);

    let outState: AbsState;
    try {
      outState = applyInstruction(node, inState, mode);
    } catch (err) {
      return {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        graph,
        trace: { steps: [] },
        traceMode,
        result: "SNI_Violation",
        error: {
          type: "AnalysisError",
          message: err instanceof Error ? err.message : String(err),
          detail: err,
        },
      };
    }
    states.get(nodeId)?.set(mode, outState);

    stepId += 1;
    if (stepId > maxSteps) {
      return {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        graph,
        trace: { steps: stepLogs } as ExecutionTrace,
        traceMode,
        result: "SNI_Violation",
        error: {
          type: "AnalysisError",
          message: "maxSteps exceeded",
          detail: { maxSteps },
        },
      };
    }
    stepLogs.push({
      stepId,
      nodeId,
      description: node.label ?? "",
      executionMode: mode,
      state: stateToSections(outState),
      isViolation: stateHasViolation(outState),
    });

    const edges = adj.get(nodeId) ?? [];
    for (const e of edges) {
      const tgtId = e.target;
      const targetMode: Mode =
        e.type === "spec" ? "Speculative" : e.type === "rollback" ? "NS" : mode;
      const tgtState = ensureState(tgtId, targetMode);
      seedRegs(tgtState, usedRegs);
      const nextState = cloneState(outState);

      const { changed } =
        e.type === "rollback"
          ? mergeState(
              tgtState,
              (() => {
                const rollbackOnly = bottomState();
                for (const [k, v] of nextState.obsMem)
                  rollbackOnly.obsMem.set(k, v);
                for (const [k, v] of nextState.obsCtrl)
                  rollbackOnly.obsCtrl.set(k, v);
                return rollbackOnly;
              })(),
              { regs: false, mem: false, obsMem: true, obsCtrl: true },
            )
          : mergeState(tgtState, nextState);
      if (changed) {
        ensureState(tgtId, targetMode);
        states.get(tgtId)?.set(targetMode, tgtState);
        worklist.push({ nodeId: tgtId, mode: targetMode });
      }
    }

    iterations += 1;
    if (iterations > iterationCap) {
      return {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        graph,
        trace: { steps: [] },
        traceMode,
        result: "SNI_Violation",
        error: {
          type: "AnalysisError",
          message: "iterationCap exceeded",
          detail: { iterationCap },
        },
      };
    }
  }

  const finalViolation = stepLogs.some((s) => s.isViolation);
  const result: AnalysisResult = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    graph,
    trace: { steps: stepLogs } as ExecutionTrace,
    traceMode,
    result: finalViolation ? "SNI_Violation" : "Secure",
  };
  return result;
}
