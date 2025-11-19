import type { GraphEdge, GraphNode, StaticGraph } from "@/lib/analysis-schema";

// グラフ構造を検証し、副作用なしでそのまま返す。
export function validateGraph(input: StaticGraph): StaticGraph {
  if (!input?.nodes?.length) {
    throw new Error("graph.nodes is empty");
  }
  if (!input?.edges) {
    throw new Error("graph.edges is missing");
  }

  const ids = new Set<string>();
  for (const n of input.nodes) {
    if (!n.id) throw new Error("node.id is required");
    if (ids.has(n.id)) throw new Error(`duplicate node id: ${n.id}`);
    ids.add(n.id);
    if (typeof n.pc !== "number")
      throw new Error(`node.pc is required: ${n.id}`);
    if (n.type !== "ns" && n.type !== "spec")
      throw new Error(`node.type invalid: ${n.id}`);
  }

  const nodeMap = new Map(input.nodes.map((n) => [n.id, n] as const));

  let _hasSpecNode = false;
  for (const n of input.nodes) {
    if (n.type === "spec") _hasSpecNode = true;
  }

  for (const e of input.edges) {
    const srcNode = nodeMap.get(e.source);
    const tgtNode = nodeMap.get(e.target);

    if (!srcNode) {
      throw new Error(`edge source missing node: ${e.source}`);
    }
    if (!tgtNode) {
      const srcInfo = srcNode.label ?? srcNode.id;
      throw new Error(
        `edge target missing node: ${e.target} (from ${e.source} '${srcInfo}')`,
      );
    }
    if (e.type !== "ns" && e.type !== "spec" && e.type !== "rollback") {
      throw new Error(`edge.type invalid on ${e.source}->${e.target}`);
    }
    if (e.type === "rollback") {
      if (srcNode.type !== "spec") {
        throw new Error(`rollback edge must originate from spec node: ${e.source}->${e.target}`);
      }
      if (tgtNode.type !== "ns") {
        throw new Error(`rollback edge must target ns node: ${e.source}->${e.target}`);
      }
    }
    if (e.type === "spec") _hasSpecNode = true;
  }

  return input;
}

export function getEntryNode(
  graph: StaticGraph,
  entryNodeId?: string,
  nodeMap?: Map<string, GraphNode>,
): GraphNode {
  if (entryNodeId) {
    const n =
      nodeMap?.get(entryNodeId) ??
      graph.nodes.find((v) => v.id === entryNodeId);
    if (!n) throw new Error(`entry node ${entryNodeId} not found`);
    return n;
  }
  return graph.nodes[0];
}

export function getAdj(graph: StaticGraph): Map<string, GraphEdge[]> {
  const adj = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    const list = adj.get(e.source);
    if (list) list.push(e);
  }
  return adj;
}
