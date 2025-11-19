import type {
  AnalysisResult,
  ExecutionTrace,
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
const DEFAULT_MAX_STEPS = 500;
const DEFAULT_TRACE_MODE: TraceMode = "bfs";



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
      const targetMode: Mode =
        e.type === "spec" ? "Speculative" : e.type === "rollback" ? "NS" : mode;
      const tgtState = ensureState(tgtId, targetMode);
      seedRegs(tgtState, usedRegs);

      const { changed } =
        e.type === "rollback"
          ? mergeState(
              tgtState,
              extractObservations(outState),
              { regs: false, mem: false, obsMem: true, obsCtrl: true },
            )
          : mergeState(tgtState, outState);
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
