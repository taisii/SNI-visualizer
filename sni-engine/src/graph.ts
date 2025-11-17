import type { StaticGraph } from "../../app/types/analysis-result";

export function parseGraph(input: StaticGraph): StaticGraph {
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
    if (typeof n.pc !== "number") throw new Error(`node.pc is required: ${n.id}`);
    if (n.type !== "ns" && n.type !== "spec") throw new Error(`node.type invalid: ${n.id}`);
  }

  for (const e of input.edges) {
    if (!ids.has(e.source)) throw new Error(`edge source missing node: ${e.source}`);
    if (!ids.has(e.target)) throw new Error(`edge target missing node: ${e.target}`);
    if (e.type !== "ns" && e.type !== "spec" && e.type !== "rollback") {
      throw new Error(`edge.type invalid on ${e.source}->${e.target}`);
    }
  }

  return input;
}
