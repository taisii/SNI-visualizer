import { describe, it, expect } from "vitest";
import { buildVCFG } from "..";

describe("buildVCFG discard mode", () => {
  it("rollback エッジを生成しない", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      { windowSize: 2, speculationMode: "discard" },
    );

    const rollbackEdges = graph.edges.filter((e) => e.type === "rollback");
    expect(rollbackEdges).toHaveLength(0);

    // spec 区間自体は生成される
    expect(graph.nodes.some((n) => n.type === "spec")).toBe(true);
  });
});
