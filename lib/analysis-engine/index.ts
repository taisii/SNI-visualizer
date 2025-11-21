import { buildVCFG } from "@/vcfg-builder";
import { analyzeVCFG, type AnalyzeOptions } from "@/sni-engine";
import {
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisError,
  type AnalysisResult,
  type TraceMode,
} from "@/lib/analysis-schema";

type RunnerOptions = AnalyzeOptions & {
  windowSize?: number;
};

function buildErrorResult(
  type: AnalysisError["type"],
  message: string,
  detail: unknown,
  traceMode: TraceMode,
): AnalysisResult {
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    graph: { nodes: [], edges: [] },
    trace: { steps: [] },
    traceMode,
    result: "SNI_Violation",
    error: {
      type,
      message,
      detail,
    },
  };
}

/**
 * UI から解析エンジンを呼び出すファサード。
 * VCFG ビルダー → SNI 判定エンジンの順で実行し、スキーマに沿った結果を返す。
 */
export async function analyze(
  sourceCode: string,
  options: RunnerOptions = {},
): Promise<AnalysisResult> {
  const traceMode = options.traceMode ?? "single-path";
  const speculationMode = options.speculationMode ?? "stack-guard";
  try {
    const graph = buildVCFG(sourceCode, {
      windowSize: options.windowSize,
      speculationMode,
    });
    const { windowSize: _omitWin, ...engineOpts } = options;
    return await analyzeVCFG(graph, { ...engineOpts, traceMode, speculationMode });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "解析で例外が発生しました";
    const type: AnalysisError["type"] =
      err instanceof Error && err.name === "ParseError"
        ? "ParseError"
        : "InternalError";
    // buildVCFG が投げる ParseError を UI 側に伝搬させるため error フィールドで返す
    return buildErrorResult(type, message, err, traceMode);
  }
}
