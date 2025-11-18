import type { StaticGraph } from "@/lib/analysis-schema";

export class GraphBuilder {
  private readonly nodeSet = new Set<string>();
  private readonly edgeSet = new Set<string>();
  private readonly nodes: StaticGraph["nodes"] = [];
  private readonly edges: StaticGraph["edges"] = [];

  addNode(node: StaticGraph["nodes"][number]) {
    if (this.nodeSet.has(node.id)) return;
    this.nodeSet.add(node.id);
    this.nodes.push(node);
  }

  addEdge(edge: StaticGraph["edges"][number]) {
    const key = `${edge.source}->${edge.target}:${edge.type}:${edge.label ?? ""}`;
    if (this.edgeSet.has(key)) return;
    this.edgeSet.add(key);
    this.edges.push(edge);
  }

  toGraph(): StaticGraph {
    return {
      nodes: this.nodes,
      edges: this.edges,
    };
  }
}
