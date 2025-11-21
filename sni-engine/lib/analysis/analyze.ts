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
import {
  applyInstruction,
  type ExecMode as ExecutionMode,
} from "../semantics";
import {
  mergeState,
  seedRegs,
  stateHasViolation,
  extractObservations,
} from "../core/state-ops";
import { stateToSections, type SpecContextInfo } from "./state-to-sections";
import { collectRegisterNames } from "./registers";

export type AnalyzeOptions = {
  iterationCap?: number;
  policy?: InitPolicy;
  entryRegs?: string[];
  entryNodeId?: string;
  maxSteps?: number;
  traceMode?: TraceMode;
  maxSpeculationDepth?: number;
  speculationMode?: SpeculationMode;
};

export type SpeculationMode = "discard" | "stack-guard";

const DEFAULT_CAP = 10_000;
const DEFAULT_MAX_STEPS = 10_000;
const DEFAULT_TRACE_MODE: TraceMode = "bfs";
const DEFAULT_MAX_SPECULATION_DEPTH = 20;
const DEFAULT_SPECULATION_MODE: SpeculationMode = "stack-guard";

type ContextStack = readonly string[];

const makeModeKey = (
  mode: ExecutionMode,
  stack: ContextStack,
  stackKey: (stack: ContextStack) => string,
): string =>
  mode === "NS" ? "NS" : `Speculative|${stackKey(stack)}`;

const makeStackKey = (stack: ContextStack) =>
  stack.length === 0 ? "root" : stack.join("::");

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

const deriveInitialStack = (node: GraphNode, mode: ExecutionMode): string[] => {
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
  const warnings: AnalysisWarning[] = [];
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
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
  const iterationCap = opts.iterationCap ?? DEFAULT_CAP;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxSpeculationDepth =
    opts.maxSpeculationDepth ?? DEFAULT_MAX_SPECULATION_DEPTH;
  const speculationMode = opts.speculationMode ?? DEFAULT_SPECULATION_MODE;
  const discardSpec = speculationMode === "discard";
  const stackGuardEnabled = speculationMode === "stack-guard";
  const stackKeyFn = makeStackKey;
  const speculationDepthWarned = new Set<string>();
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const usedRegs = collectRegisterNames(graph);
  const specContextInfo = buildSpecContextInfo(graph);
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

  const entryMode: ExecutionMode =
    entryNode.type === "spec" ? "Speculative" : "NS";
  const entryStack = deriveInitialStack(entryNode, entryMode);
  const entryModeKey = makeModeKey(entryMode, entryStack, stackKeyFn);
  ensureState(entryNode.id, entryModeKey);
  const seededInit = initState(opts.policy, opts.entryRegs);
  seedRegs(seededInit, usedRegs);
  states.get(entryNode.id)?.set(entryModeKey, seededInit);

  type WorkItem = {
    nodeId: string;
    executionMode: ExecutionMode;
    stack: ContextStack;
  };
  const worklist: WorkItem[] = [
    {
      nodeId: entryNode.id,
      executionMode: entryMode,
      stack: entryStack,
    },
  ];
  const takeNext = (): WorkItem | undefined =>
    traceMode === "single-path" ? worklist.pop() : worklist.shift();

  let iterations = 0;
  const stepLogs: TraceStep[] = [];
  let stepId = 0;

  const init =
    states.get(entryNode.id)?.get(entryModeKey) ?? bottomState();
  stepLogs.push({
    stepId,
    nodeId: "", // entry はどのノードにもフォーカスさせない
    description: "(entry)",
    executionMode: entryMode,
    state: stateToSections(init, {
      specStack: entryStack,
      specContextInfo,
    }),
    isViolation: stateHasViolation(init),
  });

  while (worklist.length > 0) {
    const shifted = takeNext();
    if (!shifted) break;
    const { nodeId, executionMode, stack } = shifted;
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const modeKey = makeModeKey(executionMode, stack, stackKeyFn);
    const inState = ensureState(nodeId, modeKey);
    seedRegs(inState, usedRegs);

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
        warnings: warnings.length > 0 ? warnings : undefined,
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
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }
    const violation = stateHasViolation(outState);
    stepLogs.push({
      stepId,
      nodeId,
      description: node.label ?? "",
      executionMode,
      state: stateToSections(outState, {
        specStack: stack,
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
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    const edges = adj.get(nodeId) ?? [];
    for (const e of edges) {
      const tgtId = e.target;
      const targetNode = nodeMap.get(tgtId);
      const isSpecNode = targetNode?.type === "spec";

      if (discardSpec && e.type === "rollback") {
        // discard モードでは rollback へ遷移しない
        continue;
      }

      if (e.type === "spec" && executionMode !== "Speculative") {
        if (!isSpecNode) {
          // NS 実行中は meta ノードを経由しない spec エッジを無視
          continue;
        }
        if (targetNode.specContext?.phase === "end") {
          // spec-end は投機中のみ訪問可能
          continue;
        }
      }

      if (
        stackGuardEnabled &&
        e.type === "spec" &&
        targetNode?.specContext?.phase === "end"
      ) {
        const top = stack.at(-1);
        if (!top || top !== targetNode.specContext.id) {
          // 異なるコンテキストの spec-end への突入を拒否
          continue;
        }
      }

      let nextStack: ContextStack = stack;
      let targetExecutionMode: ExecutionMode = executionMode;
      if (e.type === "spec") {
        targetExecutionMode = "Speculative";
        const contextIdToPush =
          targetNode && targetNode.specContext?.phase === "begin"
            ? targetNode.specContext.id
            : undefined;

        if (
          contextIdToPush &&
          stack.length >= maxSpeculationDepth
        ) {
          const warnKey = `${contextIdToPush}:${stack.length}`;
          if (!speculationDepthWarned.has(warnKey)) {
            speculationDepthWarned.add(warnKey);
            warnings.push({
              type: "MaxSpeculationDepth",
              message: `maxSpeculationDepth(${maxSpeculationDepth}) reached before entering speculative context ${contextIdToPush}`,
              detail: {
                contextId: contextIdToPush,
                nodeId,
                maxSpeculationDepth,
                stackDepth: stack.length,
              },
            });
          }
          // 投機深さ制限に達している場合は、新たな投機コンテキストには入らない
          continue;
        }

        nextStack = pushContext(stack, contextIdToPush);
      } else if (e.type === "rollback") {
        const popped = popContext(stack, node.specContext?.id);
        nextStack = popped;
        targetExecutionMode = popped.length > 0 ? "Speculative" : "NS";
      }

      const targetModeKey = makeModeKey(
        targetExecutionMode,
        nextStack,
        stackKeyFn,
      );
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
        worklist.push({
          nodeId: tgtId,
          executionMode: targetExecutionMode,
          stack: nextStack,
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
    warnings: warnings.length > 0 ? warnings : undefined,
  };
  return result;
}
