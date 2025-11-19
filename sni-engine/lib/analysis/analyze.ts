import type {
  AnalysisResult,
  ExecutionTrace,
  GraphNode,
  StaticGraph,
  TraceStep,
  TraceMode,
} from "@/lib/analysis-schema";
import { ANALYSIS_SCHEMA_VERSION } from "@/lib/analysis-schema";
import {
  type AbsState,
  type InitPolicy,
  bottomState,
  initState,
} from "../core/state";
import { validateGraph, getEntryNode, getAdj } from "./graph";
import { applyInstruction, type ExecMode as Mode } from "../semantics";
import {
  mergeState,
  seedRegs,
  stateHasViolation,
  extractObservations,
} from "../core/state-ops";
import { stateToSections } from "./state-to-sections";
import { collectRegisterNames } from "./registers";

export type AnalyzeOptions = {
  iterationCap?: number;
  policy?: InitPolicy;
  entryRegs?: string[];
  entryNodeId?: string;
  maxSteps?: number;
  traceMode?: TraceMode;
};

const DEFAULT_CAP = 10_000;
const DEFAULT_MAX_STEPS = 10_000;
const DEFAULT_TRACE_MODE: TraceMode = "bfs";

type ContextStack = readonly string[];

const makeModeKey = (mode: Mode, stack: ContextStack): string =>
  mode === "NS"
    ? "NS"
    : `Speculative|${stack.length === 0 ? "root" : stack.join("::")}`;

const pushContext = (stack: ContextStack, ctxId?: string): ContextStack => {
  if (!ctxId) return stack;
  return [...stack, ctxId];
};

const popContext = (stack: ContextStack, ctxId?: string): ContextStack => {
  if (!ctxId) return stack.length === 0 ? stack : [];
  if (stack.length === 0) return stack;
  const top = stack[stack.length - 1];
  if (top === ctxId) {
    return stack.slice(0, -1);
  }
  const idx = stack.lastIndexOf(ctxId);
  if (idx === -1) return [];
  return stack.slice(0, idx);
};

const deriveInitialStack = (node: GraphNode, mode: Mode): string[] => {
  if (mode !== "Speculative") return [];
  const ctxId = node.specContext?.id;
  return ctxId ? [ctxId] : [];
};



export async function analyzeVCFG(
  rawGraph: StaticGraph,
  opts: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const traceMode = opts.traceMode ?? DEFAULT_TRACE_MODE;
  let graph: StaticGraph;
  try {
    graph = validateGraph(rawGraph);
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

  const states = new Map<string, Map<string, AbsState>>();
  const ensureState = (nodeId: string, modeKey: string): AbsState => {
    const m = states.get(nodeId) ?? new Map<string, AbsState>();
    states.set(nodeId, m);
    const st = m.get(modeKey) ?? bottomState();
    m.set(modeKey, st);
    return st;
  };

  const entryMode: Mode = entryNode.type === "spec" ? "Speculative" : "NS";
  const entryStack = deriveInitialStack(entryNode, entryMode);
  const entryModeKey = makeModeKey(entryMode, entryStack);
  ensureState(entryNode.id, entryModeKey);
  const seededInit = initState(opts.policy, opts.entryRegs);
  seedRegs(seededInit, usedRegs);
  states.get(entryNode.id)?.set(entryModeKey, seededInit);

  type WorkItem = { nodeId: string; mode: Mode; stack: ContextStack };
  const worklist: WorkItem[] = [
    { nodeId: entryNode.id, mode: entryMode, stack: entryStack },
  ];
  const takeNext = (): WorkItem | undefined =>
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
    const { nodeId, mode, stack } = shifted;
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const modeKey = makeModeKey(mode, stack);
    const inState = ensureState(nodeId, modeKey);
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
    states.get(nodeId)?.set(modeKey, outState);

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
    const violation = stateHasViolation(outState);
    stepLogs.push({
      stepId,
      nodeId,
      description: node.label ?? "",
      executionMode: mode,
      state: stateToSections(outState),
      isViolation: violation,
    });

    if (violation) {
      return {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        graph,
        trace: { steps: stepLogs } as ExecutionTrace,
        traceMode,
        result: "SNI_Violation",
      };
    }

    const edges = adj.get(nodeId) ?? [];
    for (const e of edges) {
      const tgtId = e.target;
      const targetNode = nodeMap.get(tgtId);
      const isSpecNode = targetNode?.type === "spec";
      if (e.type === "spec" && mode !== "Speculative") {
        if (!isSpecNode) {
          // NS 実行中は meta ノードを経由しない spec エッジを無視
          continue;
        }
        if (targetNode.specContext?.phase === "end") {
          // spec-end は投機中のみ訪問可能
          continue;
        }
      }

      let nextStack: ContextStack = stack;
      let targetMode: Mode = mode;
      if (e.type === "spec") {
        targetMode = "Speculative";
        const contextIdToPush =
          targetNode && targetNode.specContext?.phase === "begin"
            ? targetNode.specContext.id
            : undefined;
        nextStack = pushContext(stack, contextIdToPush);
      } else if (e.type === "rollback") {
        const popped = popContext(stack, node.specContext?.id);
        nextStack = popped;
        targetMode = popped.length > 0 ? "Speculative" : "NS";
      }

      const targetModeKey = makeModeKey(targetMode, nextStack);
      const existingStates = states.get(tgtId);
      const hadState = existingStates?.has(targetModeKey) ?? false;
      const tgtState = ensureState(tgtId, targetModeKey);
      seedRegs(tgtState, usedRegs);

      const { changed } =
        e.type === "rollback"
          ? mergeState(
              tgtState,
              extractObservations(outState),
              { regs: false, mem: false, obsMem: true, obsCtrl: true },
            )
          : mergeState(tgtState, outState);
      const needsVisit = changed || !hadState;
      if (needsVisit) {
        ensureState(tgtId, targetModeKey);
        states.get(tgtId)?.set(targetModeKey, tgtState);
        worklist.push({ nodeId: tgtId, mode: targetMode, stack: nextStack });
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
