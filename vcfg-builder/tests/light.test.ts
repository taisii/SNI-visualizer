import { describe, expect, it } from "vitest";
import { buildVCFG } from "..";

const edgeKey = (e: { source: string; target: string; type: string }) =>
  `${e.type}:${e.source}->${e.target}`;

describe("buildVCFG light mode", () => {
  it("単一分岐で spec-begin/end を 1 組だけ生成し、rollback を張る", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      { mode: "light", speculationMode: "stack-guard" },
    );

    const specNodes = graph.nodes.filter((n) => n.type === "spec");
    expect(specNodes.map((n) => n.label)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("spec-begin"),
        expect.stringContaining("spec-end"),
      ]),
    );

    const keys = new Set(graph.edges.map(edgeKey));
    expect(keys).toContain("spec:n0->n0:spec-begin");
    expect(keys).toContain("spec:n0:spec-begin->n1");
    expect(keys).toContain("spec:n0:spec-begin->n2");
    expect(keys).toContain("spec:n0:spec-begin->n0:spec-end");
    expect(keys).toContain("rollback:n0:spec-end->n0");
  });

  it("discard モードでは rollback を出力しない", () => {
    const graph = buildVCFG("beqz x, L\nL: skip\n", {
      mode: "light",
      speculationMode: "discard",
    });
    expect(graph.edges.find((e) => e.type === "rollback")).toBeUndefined();
  });

  it("ネストした分岐でも spec コンテキスト ID が重複しない", () => {
    const graph = buildVCFG(
      `
beqz x, L1
beqz y, L2
L1: skip
L2: skip
`,
      { mode: "light" },
    );

    const ctxIds = graph.nodes
      .filter((n) => n.specContext)
      .map((n) => n.specContext?.id);
    const unique = new Set(ctxIds);
    expect(unique.size).toBe(2);
    expect(Array.from(unique)).toEqual(
      expect.arrayContaining(["specctx1", "specctx2"]),
    );
  });

  it("discard モードでは spec-end ノードと rollback を生成しない", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      { mode: "light", speculationMode: "discard" },
    );

    const specEnds = graph.nodes.filter(
      (n) => n.type === "spec" && n.label?.startsWith("spec-end"),
    );
    expect(specEnds).toHaveLength(0);
    expect(graph.edges.every((e) => e.type !== "rollback")).toBe(true);
  });
});
