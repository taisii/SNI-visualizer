import { describe, it, expect } from "vitest";
import { buildVCFG } from "..";

describe("buildVCFG discard デフォルト", () => {
  it("rollback エッジを生成しない（ns/spec のみ）", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
    );

    const edgeTypes = new Set(graph.edges.map((e) => e.type));
    expect(edgeTypes).toEqual(new Set(["ns", "spec"]));

    // spec 区間自体は生成される
    expect(graph.nodes.some((n) => n.type === "spec")).toBe(true);
  });
});
