import { describe, it, expect } from "vitest";
import { buildVCFG } from "..";

const MODES: Array<"expanded" | "meta"> = ["expanded", "meta"];

describe("buildVCFG integration (expanded / meta)", () => {
  it.each(MODES)("linear program yields only ns edges (%s)", (mode) => {
    const graph = buildVCFG("skip\nskip", { windowSize: 2, mode });
    expect(graph.nodes.every((n) => n.type === "ns")).toBe(true);
    expect(graph.edges).toEqual([{ source: "n0", target: "n1", type: "ns" }]);
  });

  it.each(MODES)(
    "branch speculation emits rollback to both paths (%s)",
    (mode) => {
      const graph = buildVCFG(
        `
beqz x, L
skip
L: skip
`,
        { windowSize: 2, mode },
      );

      const rollbackTargets = new Set(
        graph.edges.filter((e) => e.type === "rollback").map((e) => e.target),
      );
      expect(rollbackTargets.has("n1")).toBe(true);
      expect(rollbackTargets.has("n2")).toBe(true);
    },
  );

  it.each(MODES)("spbarr stops speculation (%s)", (mode) => {
    const graph = buildVCFG(
      `
beqz x, L
spbarr
L: skip
`,
      { windowSize: 3, mode },
    );

    // いずれのモードでも spbarr 以降で rollback が n2 に戻る
    const rollbackTargets = graph.edges
      .filter((e) => e.type === "rollback")
      .map((e) => e.target);
    expect(rollbackTargets).toContain("n2");
  });

  it.each(MODES)(
    "windowSize=1 rolls back immediately on mispredict paths (%s)",
    (mode) => {
      const graph = buildVCFG(
        `
beqz x, L
skip
L: skip
`,
        { windowSize: 1, mode },
      );
      const rollbackTargets = new Set(
        graph.edges.filter((e) => e.type === "rollback").map((e) => e.target),
      );
      expect(rollbackTargets).toEqual(new Set(["n1", "n2"]));
    },
  );

  it.each(MODES)("loop preserves back edge (%s)", (mode) => {
    const graph = buildVCFG(
      `
start: beqz x, start
skip
`,
      { windowSize: 2, mode },
    );

    const nsEdgeSet = new Set(
      graph.edges
        .filter((e) => e.type === "ns")
        .map((e) => `${e.source}->${e.target}`),
    );
    expect(nsEdgeSet.has("n0->n0")).toBe(true);
    expect(nsEdgeSet.has("n0->n1")).toBe(true);
  });

  it.each(MODES)(
    "does not emit rollback to non-existent fallthrough after terminal branch (%s)",
    (mode) => {
      const graph = buildVCFG(
        `
Loop:
  load z, a
  load a, c
  beqz y, Loop
`,
        { windowSize: 2, mode },
      );

      const rollbackTargets = new Set(
        graph.edges.filter((e) => e.type === "rollback").map((e) => e.target),
      );
      expect(rollbackTargets.has("n3")).toBe(false);
    },
  );

  it.each(MODES)(
    "handles moderately large programs without exploding (%s)",
    (mode) => {
      const body = Array.from({ length: 400 }, (_, i) =>
        i % 50 === 0 ? "beqz r0, L0" : "skip",
      ).join("\n");
      const program = `${body}\nL0: skip`;
      const graph = buildVCFG(program, { windowSize: 5, mode });

      // ns ノードは命令数分あること
      expect(graph.nodes.filter((n) => n.type === "ns").length).toBe(401);
      // エッジが生成され、グラフが空でないこと
      expect(graph.edges.length).toBeGreaterThan(0);
    },
  );
});
