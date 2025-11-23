import { describe, it, expect } from "vitest";
import { buildVCFG } from "..";

describe("buildVCFG integration (meta standard)", () => {
  it("linear program yields only ns edges", () => {
    const graph = buildVCFG("skip\nskip", { windowSize: 2 });
    expect(graph.nodes.every((n) => n.type === "ns")).toBe(true);
    expect(graph.edges).toEqual([{ source: "n0", target: "n1", type: "ns" }]);
  });

  it("branch speculation emits rollback to both paths", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      { windowSize: 2, speculationMode: "stack-guard" },
    );

    const rollbackTargets = new Set(
      graph.edges.filter((e) => e.type === "rollback").map((e) => e.target),
    );
    expect(rollbackTargets.has("n1")).toBe(true);
    expect(rollbackTargets.has("n2")).toBe(true);
  });

  it("spbarr stops speculation", () => {
    const graph = buildVCFG(
      `
beqz x, L
spbarr
L: skip
`,
      { windowSize: 3, speculationMode: "stack-guard" },
    );

    // meta でも spbarr 以降で rollback が n2 に戻る
    const rollbackTargets = graph.edges
      .filter((e) => e.type === "rollback")
      .map((e) => e.target);
    expect(rollbackTargets).toContain("n2");
  });

  it("windowSize=1 rolls back immediately on mispredict paths", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      { windowSize: 1, speculationMode: "stack-guard" },
    );
    const rollbackTargets = new Set(
      graph.edges.filter((e) => e.type === "rollback").map((e) => e.target),
    );
    expect(rollbackTargets).toEqual(new Set(["n1", "n2"]));
  });

  it("loop preserves back edge", () => {
    const graph = buildVCFG(
      `
start: beqz x, start
skip
`,
      { windowSize: 2 },
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
      { windowSize: 2 },
    );

    const rollbackTargets = new Set(
      graph.edges.filter((e) => e.type === "rollback").map((e) => e.target),
    );
    expect(rollbackTargets.has("n3")).toBe(false);
  });

  it("handles moderately large programs without exploding", () => {
    const body = Array.from({ length: 400 }, (_, i) =>
      i % 50 === 0 ? "beqz r0, L0" : "skip",
    ).join("\n");
    const program = `${body}\nL0: skip`;
    const graph = buildVCFG(program, { windowSize: 5 });

    // ns ノードは命令数分あること
    expect(graph.nodes.filter((n) => n.type === "ns").length).toBe(401);
    // エッジが生成され、グラフが空でないこと
    expect(graph.edges.length).toBeGreaterThan(0);
  });
});
