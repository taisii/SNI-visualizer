import { describe, expect, it } from "vitest";
import { buildVCFG } from "..";

const edgeKey = (e: { source: string; target: string; type: string }) =>
  `${e.type}:${e.source}->${e.target}`;

describe("buildVCFG light mode", () => {
  it("単一分岐で spec-begin を 1 つ生成し、spec エッジのみを張る", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
    );

    const specNodes = graph.nodes.filter((n) => n.type === "spec");
    expect(specNodes.map((n) => n.label)).toEqual(
      expect.arrayContaining([expect.stringContaining("spec-begin")]),
    );

    const keys = new Set(graph.edges.map(edgeKey));
    expect(keys).toContain("spec:n0->n0:spec-begin");
    expect(keys).toContain("spec:n0:spec-begin->n1");
    expect(keys).toContain("spec:n0:spec-begin->n2");
    // rollback エッジは存在しない
    expect(
      Array.from(keys).every(
        (k) => k.startsWith("ns:") || k.startsWith("spec:"),
      ),
    ).toBe(true);
  });

  it("ネストした分岐でも spec コンテキスト ID が重複しない", () => {
    const graph = buildVCFG(
      `
beqz x, L1
beqz y, L2
L1: skip
L2: skip
`,
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

  it("spec-end ノードと rollback は生成しない", () => {
    const graph = buildVCFG("beqz x, L\nskip\nL: skip\n");
    const specEnds = graph.nodes.filter(
      (n) => n.type === "spec" && n.label?.startsWith("spec-end"),
    );
    expect(specEnds).toHaveLength(0);
    const edgeTypes = new Set(graph.edges.map((e) => e.type));
    expect(edgeTypes).toEqual(new Set(["ns", "spec"]));
  });
});
