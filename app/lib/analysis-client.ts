import { buildVCFG } from "@/vcfg-builder/src";
import { analyzeVCFG, type AnalyzeOptions } from "@/sni-engine/src/analysis";
import {
	ANALYSIS_SCHEMA_VERSION,
	type AnalysisError,
	type AnalysisResult,
	type TraceMode,
} from "../types/analysis-result";

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
	options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
	const traceMode = options.traceMode ?? "single-path";
	try {
		const graph = buildVCFG(sourceCode);
		return await analyzeVCFG(graph, { ...options, traceMode });
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
