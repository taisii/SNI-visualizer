import { describe, it, expect } from "vitest";
import { buildVCFG } from "..";

describe("buildVCFG integration (light only)", () => {
  it("linear program yields only ns edges", () => {
    const graph = buildVCFG("skip\nskip");
    expect(graph.nodes.every((n) => n.type === "ns")).toBe(true);
    expect(graph.edges).toEqual([{ source: "n0", target: "n1", type: "ns" }]);
  });

  it("branch speculation adds spec-begin meta and spec edges without rollback", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
    );

    const edgeTypes = new Set(graph.edges.map((e) => e.type));
    expect(edgeTypes).toEqual(new Set(["ns", "spec"]));

    const specBegin = graph.nodes.find((n) => n.id.includes("spec-begin"));
    expect(specBegin?.type).toBe("spec");
    const specEdges = graph.edges.filter((e) => e.type === "spec");
    const targets = new Set(specEdges.map((e) => e.target));
    expect(targets.has("n1") || targets.has("n2")).toBe(true);
  });

  it("loop preserves back edge", () => {
    const graph = buildVCFG(
      `
start: beqz x, start
skip
`,
    );

    const nsEdgeSet = new Set(
      graph.edges
        .filter((e) => e.type === "ns")
        .map((e) => `${e.source}->${e.target}`),
    );
    expect(nsEdgeSet.has("n0->n0")).toBe(true);
    expect(nsEdgeSet.has("n0->n1")).toBe(true);
  });

  it("does not emit rollback to non-existent fallthrough after terminal branch", () => {
    const graph = buildVCFG(
      `
Loop:
  load z, a
  load a, c
  beqz y, Loop
`,
    );

    // rollback は生成しない（ns/spec のみ）
    const edgeTypes = new Set(graph.edges.map((e) => e.type));
    expect(edgeTypes).toEqual(new Set(["ns", "spec"]));
  });

  it("handles moderately large programs without exploding", () => {
    const body = Array.from({ length: 400 }, (_, i) =>
      i % 50 === 0 ? "beqz r0, L0" : "skip",
    ).join("\n");
    const program = `${body}\nL0: skip`;
    const graph = buildVCFG(program);

    // ns ノードは命令数分あること
    expect(graph.nodes.filter((n) => n.type === "ns").length).toBe(401);
    // エッジが生成され、グラフが空でないこと
    expect(graph.edges.length).toBeGreaterThan(0);
  });
});
