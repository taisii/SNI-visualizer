import { toCFG } from "@/lib/analysis-schema/to-cfg";
import type { StaticGraph } from "@/lib/analysis-schema";

export type GraphViewMode = "vcfg" | "cfg";

/**
 * UI で表示するグラフを選択するための純粋関数。
 * 依存を最小化し、UI からは mode だけ渡せば良い形にする。
 */
export function deriveDisplayGraph(
  graph: StaticGraph | null,
  mode: GraphViewMode,
): StaticGraph | null {
  if (!graph) return null;
  if (mode === "cfg") return toCFG(graph);
  return graph;
}
