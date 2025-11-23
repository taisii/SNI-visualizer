import { describe, expect, it } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";

import type { StaticGraph } from "@/lib/analysis-schema";
import { buildElkGraph, elkLayoutOptions } from "./elkLayout";
import { buildVCFG } from "@/vcfg-builder";

const DEFAULT_PROGRAM = `Loop:
  load z, a
  load a, c
  beqz y, Loop`;

describe("ELK レイアウト入力", () => {
  it("buildElkGraph は ns ノードを pc 順に並べる", () => {
    const graph: StaticGraph = {
      nodes: [
        { id: "n2", label: "pc2", pc: 2, type: "ns" },
        { id: "n0", label: "pc0", pc: 0, type: "ns" },
        { id: "n1", label: "pc1", pc: 1, type: "ns" },
        { id: "m0", label: "spec", pc: -1, type: "spec", specOrigin: "n0" },
      ],
      edges: [
        { source: "n0", target: "n1", type: "ns" },
        { source: "n1", target: "n2", type: "ns" },
      ],
    };

    const elkGraph = buildElkGraph(graph);
    expect(elkGraph.layoutOptions).toBe(elkLayoutOptions);

    const typeById = new Map(graph.nodes.map((node) => [node.id, node.type]));
    const orderedIds = (elkGraph.children ?? [])
      .filter((child) => typeById.get(child.id) === "ns")
      .map((child) => child.id);
    expect(orderedIds).toEqual(["n0", "n1", "n2"]);

    const specIds = (elkGraph.children ?? [])
      .filter((child) => typeById.get(child.id) === "spec")
      .map((child) => child.id);
    expect(specIds).toContain("m0");
  });

  it("デフォルトの MuASM デモも buildElkGraph で pc 順にソートされる", () => {
    const graph = buildVCFG(DEFAULT_PROGRAM, { windowSize: 20 });
    const elkGraph = buildElkGraph(graph);

    const typeById = new Map(graph.nodes.map((node) => [node.id, node.type]));
    const nsOrder = (elkGraph.children ?? [])
      .filter((child) => typeById.get(child.id) === "ns")
      .map((child) => child.id);
    const expectedOrder = [...graph.nodes]
      .filter((node) => node.type === "ns")
      .sort((a, b) => a.pc - b.pc)
      .map((node) => node.id);

    expect(nsOrder).toEqual(expectedOrder);
    expect(
      (elkGraph.children ?? []).some(
        (child) => typeById.get(child.id) === "spec",
      ),
    ).toBe(true);
  });

  it("elk.layout は ns ノードを pc 順で縦に並べる", async () => {
    const graph = buildVCFG(DEFAULT_PROGRAM, { windowSize: 5 });
    const elkGraph = buildElkGraph(graph);

    const elk = new ELK();
    const layout = await elk.layout(elkGraph, {
      layoutOptions: elkLayoutOptions,
    });

    const typeById = new Map(
      graph.nodes.map((node) => [node.id, node.type] as const),
    );
    const nsChildren = (layout.children ?? []).filter(
      (child) => typeById.get(child.id) === "ns",
    );
    const sortedByY = [...nsChildren].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
    const expectedOrder = [...graph.nodes]
      .filter((node) => node.type === "ns")
      .sort((a, b) => a.pc - b.pc)
      .map((node) => node.id);

    expect(sortedByY.map((child) => child.id)).toEqual(expectedOrder);
  });
});
