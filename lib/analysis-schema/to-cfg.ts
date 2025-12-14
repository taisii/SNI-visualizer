import type { StaticGraph } from "./index";

/**
 * VCFG から spec ノードと spec エッジを取り除き、通常 CFG 部分だけを抽出するユーティリティ。
 * 入力は不変として扱い、新しい StaticGraph を返す。
 * 依存は型だけに留めているので、不要になればファイルごと削除しやすい。
 */
export function toCFG(graph: StaticGraph): StaticGraph {
  const nsNodes = graph.nodes.filter((n) => n.type === "ns");
  const nsNodeIds = new Set(nsNodes.map((n) => n.id));

  const nsEdges = graph.edges.filter(
    (e) =>
      e.type === "ns" && nsNodeIds.has(e.source) && nsNodeIds.has(e.target),
  );

  // ノード・エッジともに浅いコピーを返し、元のグラフを汚さない
  return {
    nodes: nsNodes.map((n) => ({ ...n })),
    edges: nsEdges.map((e) => ({ ...e })),
  };
}
