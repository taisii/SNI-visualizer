import { describe, it, expect } from "vitest";
import { buildVCFG } from "..";

describe("buildVCFG stack-guard mode", () => {
  it("stack-guard は rollback エッジを保持する（discard とは異なる）", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      { windowSize: 2, speculationMode: "stack-guard" },
    );

    const rollbackEdges = graph.edges.filter((e) => e.type === "rollback");
    expect(rollbackEdges.length).toBeGreaterThan(0);
  });
});
