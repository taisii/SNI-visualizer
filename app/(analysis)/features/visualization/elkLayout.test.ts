import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";

import type { StaticGraph } from "@/lib/analysis-schema";
import { buildElkGraph, elkLayoutOptions } from "./elkLayout";
import { buildVCFG } from "@/vcfg-builder";

const DEFAULT_PROGRAM = `Loop:
  load z, a
  load a, c
  beqz y, Loop`;

describe("ELK レイアウト", () => {
  it("ns ノードは pc 順に縦並びになる", async () => {
    const graph: StaticGraph = {
      nodes: [
        { id: "n2", label: "pc2", pc: 2, type: "ns" },
        { id: "n0", label: "pc0", pc: 0, type: "ns" },
        { id: "n1", label: "pc1", pc: 1, type: "ns" },
      ],
      edges: [
        { source: "n0", target: "n1", type: "ns" },
        { source: "n1", target: "n2", type: "ns" },
      ],
    };

    const elk = new ELK();
    const layout = await elk.layout(buildElkGraph(graph), {
      layoutOptions: elkLayoutOptions,
    });

    const typeById = new Map(graph.nodes.map((node) => [node.id, node.type]));
    const nsChildren = (layout.children ?? []).filter(
      (child) => typeById.get(child.id) === "ns",
    );

    expect(nsChildren).toHaveLength(3);

    const sortedByY = [...nsChildren].sort(
      (a, b) => (a.y ?? 0) - (b.y ?? 0),
    );
    const expectedOrder = [...graph.nodes]
      .filter((node) => node.type === "ns")
      .sort((a, b) => a.pc - b.pc)
      .map((node) => node.id);

    expect(sortedByY.map((child) => child.id)).toEqual(expectedOrder);
  });

  it("デフォルトの MuASM デモも ns ノードが pc 順になる", async () => {
    const graph = buildVCFG(DEFAULT_PROGRAM, { windowSize: 20, mode: "expanded" });

    const elk = new ELK();
    const layout = await elk.layout(buildElkGraph(graph), {
      layoutOptions: elkLayoutOptions,
    });

    const childById = new Map((layout.children ?? []).map((child) => [child.id, child]));
    const typeById = new Map(graph.nodes.map((node) => [node.id, node.type]));
    const nsChildren = (layout.children ?? []).filter(
      (child) => typeById.get(child.id) === "ns",
    );

    const sortedByY = [...nsChildren].sort(
      (a, b) => (a.y ?? 0) - (b.y ?? 0),
    );
    const expectedOrder = [...graph.nodes]
      .filter((node) => node.type === "ns")
      .sort((a, b) => a.pc - b.pc)
      .map((node) => node.id);

    expect(sortedByY.map((child) => child.id)).toEqual(expectedOrder);
    for (const specNode of graph.nodes.filter((node) => node.type === "spec")) {
      const specChild = childById.get(specNode.id);
      const baseChild = childById.get(`n${specNode.pc}`);
      if (!specChild || !baseChild) continue;
      expect((specChild.y ?? 0) >= (baseChild.y ?? 0)).toBe(true);
    }
  });
});
