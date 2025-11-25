import { describe, it, expect } from "vitest";
import { buildVCFG } from "..";

describe("buildVCFG (light モードのみ)", () => {
  it("命令ノードは ns として生成し、spec 区間にメタノードを付与する", () => {
    const graph = buildVCFG(
      `
beqz cond, L1
skip
L1: skip
`,
    );

    const nsNodes = graph.nodes.filter((n) => n.type === "ns");
    const specNodes = graph.nodes.filter((n) => n.type === "spec");

    expect(nsNodes).toHaveLength(3);
    expect(specNodes.length).toBeGreaterThan(0);
    expect(specNodes.every((n) => (n.pc ?? 0) < 0)).toBe(true);
  });

  it("spec エッジはラベル付きで分岐先に届くが rollback は生成しない", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
    );

    const specEdges = graph.edges.filter((e) => e.type === "spec");
    expect(specEdges.length).toBeGreaterThan(0);
    expect(specEdges.some((e) => e.label?.startsWith("spec:"))).toBe(true);
    const edgeTypes = new Set(graph.edges.map((e) => e.type));
    expect(edgeTypes).toEqual(new Set(["ns", "spec"]));
  });
});
