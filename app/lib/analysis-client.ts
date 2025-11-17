import { buildVCFG } from "@/vcfg-builder/src";
import { analyzeVCFG } from "@/sni-engine/src/analysis";
import { ANALYSIS_SCHEMA_VERSION, type AnalysisError, type AnalysisResult } from "../types/analysis-result";

function buildErrorResult(type: AnalysisError["type"], message: string, detail?: unknown): AnalysisResult {
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    graph: { nodes: [], edges: [] },
    trace: { steps: [] },
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
export async function analyze(sourceCode: string): Promise<AnalysisResult> {
  try {
    const graph = buildVCFG(sourceCode);
    return await analyzeVCFG(graph, {});
  } catch (err) {
    const message = err instanceof Error ? err.message : "解析で例外が発生しました";
    const type: AnalysisError["type"] = err instanceof Error && err.name === "ParseError"
      ? "ParseError"
      : "InternalError";
    // buildVCFG が投げる ParseError を UI 側に伝搬させるため error フィールドで返す
    return buildErrorResult(type, message, err);
  }
}
