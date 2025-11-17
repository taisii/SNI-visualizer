import { mockAnalysisResult } from "../fixtures/mock-analysis-result";
import type { AnalysisResult } from "../types/analysis-result";

const MOCK_LATENCY_MS = 200;

/**
 * UI から解析エンジンを呼び出すためのファサード。
 * 現時点ではモック結果を返す。将来的に WebWorker / WASM へ置き換え予定。
 */
export async function analyze(sourceCode: string): Promise<AnalysisResult> {
  // sourceCode は現状未使用だが、将来的なエンジン実装を見据えて受け取っておく。
  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
  return mockAnalysisResult;
}
