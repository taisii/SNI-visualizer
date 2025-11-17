import type {
  AnalysisResult,
  ExecutionTrace,
  GraphEdge,
  GraphNode,
  StaticGraph,
  TraceStep,
} from "../../app/types/analysis-result";
import { ANALYSIS_SCHEMA_VERSION } from "../../app/types/analysis-result";
import { join, LatticeValue, toDisplay } from "./lattice";
import { AbsState, InitPolicy, bottomState, cloneState, initState, defaultLattice } from "./state";
import { parseGraph } from "./graph";

type Mode = "NS" | "Speculative";

export type AnalyzeOptions = {
  iterationCap?: number;
  policy?: InitPolicy;
  entryRegs?: string[];
  entryNodeId?: string;
};

const DEFAULT_CAP = 10_000;

function getEntryNode(graph: StaticGraph, entryNodeId?: string, nodeMap?: Map<string, GraphNode>): GraphNode {
  if (entryNodeId) {
    const n = nodeMap?.get(entryNodeId) ?? graph.nodes.find((v) => v.id === entryNodeId);
    if (!n) throw new Error(`entry node ${entryNodeId} not found`);
    return n;
  }
  return graph.nodes[0];
}

function getAdj(graph: StaticGraph): Map<string, GraphEdge[]> {
  const adj = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e);
  }
  return adj;
}

function obsKey(node: GraphNode): number {
  return node.pc;
}

function updateObsNS(state: AbsState, node: GraphNode, observed: LatticeValue) {
  if (observed === "EqHigh") {
    const prev = state.obs.get(obsKey(node)) ?? "Bot";
    state.obs.set(obsKey(node), join(prev, "EqHigh"));
  } else if (observed === "Leak" || observed === "Top") {
    const prev = state.obs.get(obsKey(node)) ?? "Bot";
    state.obs.set(obsKey(node), join(prev, observed));
  }
}

function updateObsSpec(state: AbsState, node: GraphNode, observed: LatticeValue) {
  if (observed === "EqHigh" || observed === "Leak" || observed === "Top") {
    const prev = state.obs.get(obsKey(node)) ?? "Bot";
    // NS 観測済みなら EqHigh を保持、それ以外は Leak にする
    const next = prev === "EqHigh" ? "EqHigh" : "Leak";
    state.obs.set(obsKey(node), join(prev, next));
  }
}

function getReg(state: AbsState, name: string): LatticeValue {
  return state.regs.get(name) ?? defaultLattice();
}

function getMem(state: AbsState, name: string): LatticeValue {
  return state.mem.get(name) ?? defaultLattice();
}

function setReg(state: AbsState, name: string, value: LatticeValue) {
  state.regs.set(name, value);
}

function setMem(state: AbsState, name: string, value: LatticeValue) {
  state.mem.set(name, value);
}

function specAssign(prev: LatticeValue, newVal: LatticeValue): LatticeValue {
  if (prev === "Bot") return newVal;
  if (prev === "EqLow") {
    if (newVal === "EqLow") return "EqLow";
    if (newVal === "Diverge") return "Diverge";
    if (newVal === "EqHigh" || newVal === "Leak" || newVal === "Top") return "Leak";
  }
  if (prev === "EqHigh") {
    if (newVal === "EqHigh") return "EqHigh";
    return "Top";
  }
  // fallback: conservative join
  return join(prev, newVal);
}

function applyInstruction(
  node: GraphNode,
  state: AbsState,
  mode: Mode,
): AbsState {
  const next = cloneState(state);
  const instrRaw = node.instruction ?? node.label ?? "";
  const [op, ...rest] = instrRaw.trim().split(/\s+/);

  const setValue = (kind: "reg" | "mem", name: string, value: LatticeValue) => {
    if (mode === "NS") {
      kind === "reg" ? setReg(next, name, value) : setMem(next, name, value);
    } else {
      const prev = kind === "reg" ? getReg(next, name) : getMem(next, name);
      const v = specAssign(prev, value);
      kind === "reg" ? setReg(next, name, v) : setMem(next, name, v);
    }
  };

  const observe = (val: LatticeValue) => {
    if (mode === "NS") {
      updateObsNS(next, node, val);
    } else {
      updateObsSpec(next, node, val);
    }
  };

  switch (op) {
    case "":
    case "skip":
      break;
    case "assign": {
      const [dst, src] = rest;
      const v = getReg(state, src);
      setValue("reg", dst, v);
      break;
    }
    case "op": { // binary op dst a b
      const [dst, a, b] = rest;
      const v = join(getReg(state, a), getReg(state, b));
      setValue("reg", dst, v);
      break;
    }
    case "load": {
      const [dst, addr] = rest;
      const lAddr = getReg(state, addr);
      const lVal = getMem(state, addr);
      observe(lVal === "Bot" ? lAddr : join(lVal, lAddr));
      const v = join(lVal, lAddr);
      setValue("reg", dst, v);
      break;
    }
    case "store": {
      const [src, addr] = rest;
      const lAddr = getReg(state, addr);
      const lVal = getReg(state, src);
      observe(lVal === "Bot" ? lAddr : join(lVal, lAddr));
      const v = join(lVal, lAddr);
      setValue("mem", addr, v);
      break;
    }
    case "cmov": { // cmov dst cond src
      const [dst, cond, src] = rest;
      const v = join(getReg(state, cond), getReg(state, src));
      setValue("reg", dst, v);
      break;
    }
    case "spbarr":
      // 投機ウィンドウ閉鎖はグラフ構造で表現されるため、ここでは状態変化なし
      break;
    case "beqz":
    case "jmp":
      // 制御は VCFG edges が持つので状態変化なし
      break;
    default:
      // 未知命令は安全側 Top へ: 既知レジスタ/メモリ/観測を Top でつぶす
      const obsVal = mode === "NS" ? updateObsNS : updateObsSpec;
      // 既存の観測を Top へ
      obsVal(next, node, "Top");
      for (const k of next.regs.keys()) {
        setReg(next, k, join(getReg(next, k), "Top"));
      }
      for (const k of next.mem.keys()) {
        setMem(next, k, join(getMem(next, k), "Top"));
      }
      break;
  }

  return next;
}

function mergeState(dst: AbsState, src: AbsState, opts: { regs?: boolean; mem?: boolean; obs?: boolean } = {}): { changed: boolean } {
  const { regs = true, mem = true, obs = true } = opts;
  let changed = false;
  if (regs) {
    for (const [k, v] of src.regs) {
      const cur = dst.regs.get(k) ?? "Bot";
      const n = join(cur, v);
      if (n !== cur) {
        dst.regs.set(k, n);
        changed = true;
      }
    }
  }
  if (mem) {
    for (const [k, v] of src.mem) {
      const cur = dst.mem.get(k) ?? "Bot";
      const n = join(cur, v);
      if (n !== cur) {
        dst.mem.set(k, n);
        changed = true;
      }
    }
  }
  if (obs) {
    for (const [k, v] of src.obs) {
      const cur = dst.obs.get(k) ?? "Bot";
      const n = join(cur, v);
      if (n !== cur) {
        dst.obs.set(k, n);
        changed = true;
      }
    }
  }
  return { changed };
}

function stateHasViolation(state: AbsState): boolean {
  // 仕様: 観測チャンネルに Leak/Top が現れた場合のみ違反とみなす。
  // 高機密がレジスタ・メモリに拡散しても観測されなければ許容とする。
  for (const v of state.obs.values()) {
    if (v === "Leak" || v === "Top") return true;
  }
  return false;
}

function stateToSections(state: AbsState) {
  const regs: Record<string, ReturnType<typeof toDisplay>> = {};
  const mem: Record<string, ReturnType<typeof toDisplay>> = {};
  const obs: Record<string, ReturnType<typeof toDisplay>> = {};
  for (const [k, v] of state.regs) regs[k] = toDisplay(v);
  for (const [k, v] of state.mem) mem[k] = toDisplay(v);
  for (const [k, v] of state.obs) obs[String(k)] = toDisplay(v);
  const hasLeak = stateHasViolation(state);
  return {
    sections: [
      { id: "regs", title: "Registers", type: "key-value", data: regs },
      { id: "mem", title: "Memory", type: "key-value", data: mem },
      { id: "obs", title: "Observations", type: "key-value", data: obs, alert: hasLeak },
    ],
  };
}

function buildReplayTrace(
  graph: StaticGraph,
  states: Map<string, AbsState>,
  entryNodeId: string,
  adj: Map<string, GraphEdge[]>,
  nodeMap: Map<string, GraphNode>,
): TraceStep[] {
  const steps: TraceStep[] = [];
  const visited = new Set<string>();
  const queue: string[] = [entryNodeId];
  let stepId = 0;

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const st = states.get(nodeId) ?? bottomState();
    const hasLeak = stateHasViolation(st);
    steps.push({
      stepId: stepId++,
      nodeId,
      description: node.label ?? "",
      executionMode: node.type === "spec" ? "Speculative" : "NS",
      state: stateToSections(st),
      isViolation: hasLeak,
    });

    const edges = adj.get(nodeId) ?? [];
    for (const e of edges) {
      if (!visited.has(e.target)) queue.push(e.target);
    }
  }

  return steps;
}

export async function analyzeVCFG(
  rawGraph: StaticGraph,
  opts: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  let graph: StaticGraph;
  try {
    graph = parseGraph(rawGraph);
  } catch (err) {
    return {
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      graph: rawGraph,
      trace: { steps: [] },
      result: "SNI_Violation",
      error: { type: "ParseError", message: err instanceof Error ? err.message : String(err), detail: err },
    };
  }
  const iterationCap = opts.iterationCap ?? DEFAULT_CAP;
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const entryNode = getEntryNode(graph, opts.entryNodeId, nodeMap);
  const adj = getAdj(graph);

  const states = new Map<string, AbsState>();
  states.set(entryNode.id, initState(opts.policy, opts.entryRegs));

  const worklist: string[] = [entryNode.id];
  let iterations = 0;

  while (worklist.length > 0) {
    const nodeId = worklist.shift()!;
    const node = nodeMap.get(nodeId)!;
    const inState = states.get(nodeId)!;

    const mode: Mode = node.type === "spec" ? "Speculative" : "NS";
    const outState = applyInstruction(node, inState, mode);
    states.set(nodeId, outState);

    const edges = adj.get(nodeId) ?? [];
    for (const e of edges) {
      const tgtId = e.target;
      const tgtState = states.get(tgtId) ?? bottomState();
      const nextState = cloneState(outState);
      const { changed } = e.type === "rollback"
        ? mergeState(
            tgtState,
            (() => {
              const rollbackOnly = bottomState();
              for (const [k, v] of nextState.obs) rollbackOnly.obs.set(k, v);
              return rollbackOnly;
            })(),
            { regs: false, mem: false, obs: true },
          )
        : mergeState(tgtState, nextState);
      if (changed) {
        states.set(tgtId, tgtState);
        worklist.push(tgtId);
      }
    }

    iterations += 1;
    if (iterations > iterationCap) {
      return {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        graph,
        trace: { steps: [] },
        result: "SNI_Violation",
        error: { type: "AnalysisError", message: "iterationCap exceeded", detail: { iterationCap } },
      };
    }
  }

  // 仕様に従い、到達順の再生トレースを生成
  const steps = buildReplayTrace(graph, states, entryNode.id, adj, nodeMap);

  const finalViolation = Array.from(states.values()).some(stateHasViolation);
  const result: AnalysisResult = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    graph,
    trace: { steps } as ExecutionTrace,
    result: finalViolation ? "SNI_Violation" : "Secure",
  };
  return result;
}
