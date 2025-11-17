import { ANALYSIS_SCHEMA_VERSION, type AnalysisResult } from "../types/analysis-result";

// シンプルなデモ用 AnalysisResult。
// 通常 -> 投機 -> ロールバックの最小パスを含み、StateViewer の alert 表示を確認できる。
export const mockAnalysisResult: AnalysisResult = {
  schemaVersion: ANALYSIS_SCHEMA_VERSION,
  result: "SNI_Violation",
  graph: {
    nodes: [
      { id: "n0", label: "0: load r1, [ptr]", pc: 0, type: "ns" },
      { id: "n1", label: "1: add ptr, 1", pc: 1, type: "ns" },
      { id: "n2", label: "1s: add ptr, 1 (spec)", pc: 1, type: "spec", specOrigin: "n1" },
      { id: "n3", label: "rollback", pc: 2, type: "ns" },
    ],
    edges: [
      { source: "n0", target: "n1", type: "ns" },
      { source: "n1", target: "n2", type: "spec", label: "mispredict" },
      { source: "n2", target: "n3", type: "rollback" },
    ],
  },
  trace: {
    steps: [
      {
        stepId: 0,
        nodeId: "n0",
        description: "ロードを実行",
        executionMode: "NS",
        isViolation: false,
        state: {
          sections: [
            {
              id: "registers",
              title: "Registers",
              type: "key-value",
              data: { r1: { label: "EqLow", style: "safe" }, ptr: { label: "Low", style: "safe" } },
            },
          ],
        },
      },
      {
        stepId: 1,
        nodeId: "n2",
        description: "投機的に ptr++",
        executionMode: "Speculative",
        isViolation: false,
        state: {
          sections: [
            {
              id: "registers",
              title: "Registers",
              type: "key-value",
              data: { r1: { label: "EqLow", style: "safe" }, ptr: { label: "Unknown", style: "info" } },
            },
            {
              id: "constraints",
              title: "Constraints",
              type: "key-value",
              data: { path: { label: "diverge", style: "info" } },
            },
          ],
        },
      },
      {
        stepId: 2,
        nodeId: "n3",
        description: "ロールバックでリーク検知",
        executionMode: "NS",
        isViolation: true,
        state: {
          sections: [
            {
              id: "observations",
              title: "Observations",
              type: "key-value",
              alert: true,
              data: { obs0: { label: "Leak", style: "danger", description: "Spec path diverged" } },
              description: "投機履歴を観測",
            },
          ],
        },
      },
    ],
  },
};
