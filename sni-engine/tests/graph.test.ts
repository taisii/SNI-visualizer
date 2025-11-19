import { describe, it, expect } from "vitest";
import { validateGraph } from "../lib/analysis/graph";
import type { StaticGraph } from "@/lib/analysis-schema";
import { getEntryNode, getAdj } from "../lib/analysis/graph";


describe("parseGraph structural checks", () => {
  it("allows speculative graph even without rollback edge (non-fatal)", () => {
    const graph: StaticGraph = {
      nodes: [
        { id: "n0", pc: 0, type: "ns", label: "0: skip" },
        { id: "s1", pc: 1, type: "spec", label: "1: skip" },
      ],
      edges: [{ source: "n0", target: "s1", type: "spec" }],
    };
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it("requires rollback to go spec -> ns", () => {
    const graph: StaticGraph = {
      nodes: [
        { id: "s1", pc: 1, type: "spec", label: "1: skip" },
        { id: "s2", pc: 2, type: "spec", label: "2: skip" },
      ],
      edges: [{ source: "s1", target: "s2", type: "rollback" }],
    };
    expect(() => validateGraph(graph)).toThrow(/target ns node/);
  });
  });



describe("graph helpers", () => {
  const graph: StaticGraph = {
    nodes: [
      { id: "n0", pc: 0, type: "ns", label: "n0" },
      { id: "n1", pc: 1, type: "ns", label: "n1" },
    ],
    edges: [
      { source: "n0", target: "n1", type: "ns" },
      { source: "n0", target: "n0", type: "ns" },
    ],
  };

  describe("getEntryNode", () => {
    it("returns first node by default", () => {
      expect(getEntryNode(graph).id).toBe("n0");
    });

    it("returns specified node", () => {
      expect(getEntryNode(graph, "n1").id).toBe("n1");
    });

    it("throws if node not found", () => {
      expect(() => getEntryNode(graph, "missing")).toThrow();
    });
  });

  describe("getAdj", () => {
    it("builds adjacency list", () => {
      const adj = getAdj(graph);
      expect(adj.get("n0")).toHaveLength(2);
      expect(adj.get("n1")).toBeUndefined();
    });
  });
});
