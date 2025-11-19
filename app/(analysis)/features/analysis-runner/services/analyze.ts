import type { AnalysisResult } from "@/lib/analysis-schema";
import type { AnalyzeOptions } from "@/sni-engine";
import type { VCFGMode } from "@/vcfg-builder";
import { analyze as runAnalysis } from "@/lib/analysis-engine";

// UI から解析エンジンを呼び出す薄いファサード。
// 将来の WebWorker/非同期実行への移行点として境界を明示する。
export async function analyze(
  sourceCode: string,
  options: AnalyzeOptions & { vcfgMode?: VCFGMode } = {},
): Promise<AnalysisResult> {
  return runAnalysis(sourceCode, options);
}
