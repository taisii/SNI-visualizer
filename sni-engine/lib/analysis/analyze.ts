import type {
  AnalysisResult,
  AnalysisWarning,
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
import { applyInstruction, type ExecMode as ExecutionMode } from "../semantics";
import {
  mergeState,
  seedRegs,
  stateHasViolation,
  stateHasTop,
} from "../core/state-ops";
import { stateToSections, type SpecContextInfo } from "./state-to-sections";
import { collectRegisterNames } from "./registers";
import { cloneState, decrementBudget } from "../core/state";

export type AnalyzeOptions = {
  iterationCap?: number;
  policy?: InitPolicy;
  entryRegs?: string[];
  entryNodeId?: string;
  maxSteps?: number;
  traceMode?: TraceMode;
  specWindow?: number;
};

const DEFAULT_CAP = 10_000;
const DEFAULT_MAX_STEPS = 10_000;
const DEFAULT_TRACE_MODE: TraceMode = "bfs";
const DEFAULT_SPEC_WINDOW = 20;

type LogStack = readonly string[];

const makeModeKey = (mode: ExecutionMode): string => mode;

const deriveInitialLogStack = (
  node: GraphNode,
  mode: ExecutionMode,
): string[] => {
  if (mode !== "Speculative") return [];
  const ctxId = node.specContext?.id;
  return ctxId ? [ctxId] : [];
};

const buildSpecContextInfo = (
  graph: StaticGraph,
): Map<string, SpecContextInfo> => {
  const info = new Map<string, SpecContextInfo>();
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n] as const));

  for (const node of graph.nodes) {
    const ctx = node.specContext;
    if (ctx?.phase === "begin") {
      info.set(ctx.id, { id: ctx.id });
    }
  }

  for (const edge of graph.edges) {
    if (edge.type !== "spec") continue;
    const targetNode = nodeById.get(edge.target);
    const ctx = targetNode?.specContext;
    if (!ctx || ctx.phase !== "begin") continue;

    const assumption =
      edge.label?.replace(/^spec:\s*/i, "") ?? edge.label ?? undefined;
    const originNode = nodeById.get(edge.source);
    const originLabel =
      originNode?.instruction && originNode.instruction !== "skip"
        ? originNode.instruction
        : undefined;

    const prev = info.get(ctx.id) ?? { id: ctx.id };
    info.set(ctx.id, {
      id: ctx.id,
      originNodeId: originNode?.id ?? prev.originNodeId,
      originLabel: originLabel ?? prev.originLabel,
      assumption: assumption ?? prev.assumption,
    });
  }

  return info;
};
export async function analyzeVCFG(
  rawGraph: StaticGraph,
  opts: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const traceMode = opts.traceMode ?? DEFAULT_TRACE_MODE;
  const specMode = "light" as const;
  const specWindow = opts.specWindow ?? DEFAULT_SPEC_WINDOW;
  const specWindowActive = specMode === "light";
  const warnings: AnalysisWarning[] = [];
  const topWarned = new Set<string>();
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
      specWindow: specWindowActive ? specWindow : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
  const iterationCap = opts.iterationCap ?? DEFAULT_CAP;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const usedRegs = collectRegisterNames(graph);
  const specContextInfo = buildSpecContextInfo(graph);
  const entryNode = getEntryNode(graph, opts.entryNodeId, nodeMap);
  const adj = getAdj(graph);

  if (specWindowActive && specWindow <= 0) {
    return {
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      graph,
      trace: { steps: [] },
      traceMode,
      result: "SNI_Violation",
      error: {
        type: "AnalysisError",
        message: "specWindow must be greater than 0",
        detail: { specWindow },
      },
      specWindow,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  const states = new Map<string, Map<string, AbsState>>();
  const ensureState = (nodeId: string, modeKey: string): AbsState => {
    const m = states.get(nodeId) ?? new Map<string, AbsState>();
    states.set(nodeId, m);
    const st = m.get(modeKey) ?? bottomState();
    m.set(modeKey, st);
    return st;
  };

  const entryMode: ExecutionMode =
    entryNode.type === "spec" ? "Speculative" : "NS";
  const entryLogStack = deriveInitialLogStack(entryNode, entryMode);
  const entryModeKey = makeModeKey(entryMode);
  ensureState(entryNode.id, entryModeKey);
  const seededInit = initState(opts.policy, opts.entryRegs);
  seededInit.budget =
    entryMode === "Speculative" && specWindowActive ? specWindow : "inf";
  seedRegs(seededInit, usedRegs);
  states.get(entryNode.id)?.set(entryModeKey, seededInit);

  type WorkItem = {
    nodeId: string;
    executionMode: ExecutionMode;
    logStack: LogStack;
  };
  const worklist: WorkItem[] = [
    {
      nodeId: entryNode.id,
      executionMode: entryMode,
      logStack: entryLogStack,
    },
  ];
  const takeNext = (): WorkItem | undefined =>
    traceMode === "single-path" ? worklist.pop() : worklist.shift();

  let iterations = 0;
  const stepLogs: TraceStep[] = [];
  let stepId = 0;

  const init = states.get(entryNode.id)?.get(entryModeKey) ?? bottomState();
  stepLogs.push({
    stepId,
    nodeId: "", // entry はどのノードにもフォーカスさせない
    description: "(entry)",
    executionMode: entryMode,
    specWindowRemaining:
      entryMode === "Speculative" && specWindowActive ? specWindow : undefined,
    state: stateToSections(init, {
      specStack: entryLogStack,
      specContextInfo,
    }),
    isViolation: stateHasViolation(init),
  });

  while (worklist.length > 0) {
    const shifted = takeNext();
    if (!shifted) break;
    const { nodeId, executionMode, logStack } = shifted;
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const modeKey = makeModeKey(executionMode);
    const inState = ensureState(nodeId, modeKey);
    seedRegs(inState, usedRegs);

    let currentBudget: number | undefined;
    let nextBudget: number | "inf" = inState.budget;

    if (specWindowActive && executionMode === "Speculative") {
      currentBudget =
        inState.budget === "inf" ? specWindow : (inState.budget as number);
      if (currentBudget <= 0) {
        // Pruning: これ以上遷移しない
        continue;
      }
      nextBudget =
        inState.budget === "inf"
          ? "inf"
          : (decrementBudget(inState.budget) as number);
    }

    let outState: AbsState;
    try {
      outState = applyInstruction(node, inState, executionMode);
    } catch (err) {
      return {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        graph,
        trace: { steps: stepLogs },
        traceMode,
        result: "SNI_Violation",
        error: {
          type: "AnalysisError",
          message: err instanceof Error ? err.message : String(err),
          detail: err,
        },
        specWindow: specWindowActive ? specWindow : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }
    outState.budget = nextBudget;
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
        specWindow: specWindowActive ? specWindow : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }
    const violation = stateHasViolation(outState);
    const hasTop = stateHasTop(outState);
    if (hasTop) {
      const warnKey = `${nodeId}|${executionMode}`;
      if (!topWarned.has(warnKey)) {
        topWarned.add(warnKey);
        warnings.push({
          type: "TopObserved",
          message:
            "観測トレースに解析不能 (Top) が含まれます。結果は不確定です。",
          detail: { nodeId },
        });
      }
    }
    stepLogs.push({
      stepId,
      nodeId,
      description: node.label ?? "",
      executionMode,
      specWindowRemaining: currentBudget,
      state: stateToSections(outState, {
        specStack: logStack,
        specContextInfo,
      }),
      isViolation: violation,
    });

    if (violation) {
      return {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        graph,
        trace: { steps: stepLogs } as ExecutionTrace,
        traceMode,
        result: "SNI_Violation",
        specWindow: specWindowActive ? specWindow : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    const edges = adj.get(nodeId) ?? [];
    for (const e of edges) {
      const tgtId = e.target;
      const targetNode = nodeMap.get(tgtId);
      if (e.type === "spec" && executionMode !== "Speculative") {
        // NS -> spec エッジは spec-begin への突入のみ許可
        if (
          targetNode?.type !== "spec" ||
          targetNode.specContext?.phase !== "begin"
        ) {
          continue;
        }
      }

      let targetExecutionMode: ExecutionMode = executionMode;
      const successorState = cloneState(outState);
      let nextLogStack: LogStack = logStack;

      if (e.type === "spec") {
        targetExecutionMode = "Speculative";
        const entering = targetNode?.specContext?.phase === "begin";
        if (entering) {
          // spec-begin に入った時点でリソースを最大値にリセットし、ログ用スタックに push する
          nextLogStack = targetNode?.specContext?.id
            ? [...logStack, targetNode.specContext.id]
            : logStack;
          // NS -> spec-begin のときだけリセット。既に投機中なら残量を引き継ぐ。
          if (executionMode === "NS") {
            successorState.budget =
              specWindowActive && targetExecutionMode === "Speculative"
                ? specWindow
                : "inf";
          } else {
            successorState.budget = outState.budget;
          }
        } else {
          successorState.budget = outState.budget;
        }
      } else if (targetExecutionMode === "Speculative") {
        successorState.budget = outState.budget;
      } else {
        successorState.budget = "inf";
      }

      if (
        specWindowActive &&
        targetExecutionMode === "Speculative" &&
        successorState.budget !== "inf" &&
        successorState.budget <= 0
      ) {
        continue;
      }

      const targetModeKey = makeModeKey(targetExecutionMode);
      const existingStates = states.get(tgtId);
      const hadState = existingStates?.has(targetModeKey) ?? false;
      const tgtState = ensureState(tgtId, targetModeKey);
      seedRegs(tgtState, usedRegs);

      const { changed } = mergeState(tgtState, successorState);
      const needsVisit = changed || !hadState;
      if (needsVisit) {
        worklist.push({
          nodeId: tgtId,
          executionMode: targetExecutionMode,
          logStack: nextLogStack,
        });
      }
    }

    iterations += 1;
    if (iterations > iterationCap) {
      return {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        graph,
        trace: { steps: stepLogs } as ExecutionTrace,
        traceMode,
        result: "SNI_Violation",
        error: {
          type: "AnalysisError",
          message: "iterationCap exceeded",
          detail: { iterationCap },
        },
        specWindow: specWindowActive ? specWindow : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
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
    specWindow: specWindowActive ? specWindow : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
  return result;
}
