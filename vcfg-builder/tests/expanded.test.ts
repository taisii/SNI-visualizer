import { describe, it, expect } from "vitest";
import { buildVCFG } from "..";

describe("buildVCFG expanded mode (default)", () => {
  it("embeds instructionAst on ns/spec nodes", () => {
    const graph = buildVCFG(
      `
beqz x, L
L: skip
`,
      2,
    );

    const n0 = graph.nodes.find((n) => n.id === "n0");
    expect(n0?.instructionAst).toBeDefined();
    expect(n0?.instructionAst?.op).toBe("beqz");

    const specNode = graph.nodes.find((n) => n.type === "spec");
    expect(specNode?.instructionAst).toBeDefined();
  });

  it("branch expands mispredict speculative paths", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      2,
    );

    const nsEdges = graph.edges.filter((e) => e.type === "ns");
    expect(nsEdges).toHaveLength(3);

    const specEdges = graph.edges.filter((e) => e.type === "spec");
    const rollbackEdges = graph.edges.filter((e) => e.type === "rollback");

    expect(specEdges).toHaveLength(3);
    expect(rollbackEdges).toHaveLength(2);
    expect(graph.nodes.filter((n) => n.type === "spec")).toHaveLength(3);
  });

  it("loop preserves back edge without duplication", () => {
    const graph = buildVCFG(
      `
start: beqz x, start
skip
`,
      2,
    );

    const nsEdgeSet = new Set(
      graph.edges
        .filter((e) => e.type === "ns")
        .map((e) => `${e.source}->${e.target}`),
    );
    expect(nsEdgeSet.has("n0->n0")).toBe(true);
    expect(nsEdgeSet.has("n0->n1")).toBe(true);
    expect(nsEdgeSet.size).toBe(
      graph.edges.filter((e) => e.type === "ns").length,
    );
  });

  it("nested speculation keeps context id stable", () => {
    const graph = buildVCFG(
      `
beqz x, L1
beqz y, L2
L1: skip
L2: skip
`,
      3,
    );

    expect(graph.nodes.some((n) => n.id === "n1@spec0")).toBe(true);
    expect(graph.nodes.some((n) => n.id === "n2@spec0")).toBe(true);
  });

  it("spbarr stops speculation and emits rollback", () => {
    const graph = buildVCFG(
      `
beqz x, L
spbarr
L: skip
`,
      3,
    );

    const rollbackTargets = graph.edges
      .filter((e) => e.type === "rollback")
      .map((e) => e.target);
    expect(rollbackTargets).toContain("n2");
  });

  it("windowSize=1 triggers immediate rollback on both mispredict paths", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      1,
    );
    const specIds = graph.nodes
      .filter((n) => n.type === "spec")
      .map((n) => n.id)
      .sort();
    expect(specIds).toEqual(["n1@spec0", "n2@spec1"]);
    const rollbackEdges = graph.edges.filter((e) => e.type === "rollback");
    expect(rollbackEdges).toHaveLength(2);
    expect(new Set(rollbackEdges.map((e) => e.target))).toEqual(
      new Set(["n1", "n2"]),
    );
  });

  it("does not emit rollback to non-existent fallthrough after terminal branch", () => {
    const graph = buildVCFG(
      `
Loop:
  load z, a
  load a, c
  beqz y, Loop
`,
      2,
    );

    expect(graph.nodes.filter((n) => n.type === "ns").map((n) => n.id)).toEqual(
      ["n0", "n1", "n2"],
    );

    const rollbackTargets = new Set(
      graph.edges.filter((e) => e.type === "rollback").map((e) => e.target),
    );
    expect(rollbackTargets.has("n3")).toBe(false);

    const rollbackEdges = graph.edges.filter((e) => e.type === "rollback");
    expect(rollbackEdges).toHaveLength(0);
  });

  it("spec nodes remain unique per speculation context", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      2,
    );
    const specIds = graph.nodes
      .filter((n) => n.type === "spec")
      .map((n) => n.id);
    expect(new Set(specIds).size).toBe(specIds.length);
    expect(specIds.some((id) => id.endsWith("@spec0"))).toBe(true);
    expect(specIds.some((id) => id.endsWith("@spec1"))).toBe(true);
  });

  it("rollback edges originate only from speculative nodes", () => {
    const graph = buildVCFG(
      `
beqz x, L
spbarr
L: skip
`,
      3,
    );

    const nodeType = new Map(graph.nodes.map((n) => [n.id, n.type]));
    const rollbackEdges = graph.edges.filter((e) => e.type === "rollback");

    expect(rollbackEdges.length).toBeGreaterThan(0);
    for (const edge of rollbackEdges) {
      expect(nodeType.get(edge.source)).toBe("spec");
    }
  });
});
