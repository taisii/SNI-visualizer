import { describe, it, expect } from "vitest";
import { analyzeVCFG } from "../lib/analysis/analyze";
import type { StaticGraph } from "@/lib/analysis-schema";

const node = (
  id: string,
  pc: number,
  type: "ns" | "spec",
  label: string,
  context?: { id: string; phase: "begin" | "end" },
): StaticGraph["nodes"][number] => ({
  id,
  pc,
  label,
  type,
  instruction: "skip",
  specContext: context,
});

const edge = (
  source: string,
  target: string,
  type: "ns" | "spec" | "rollback",
) => ({ source, target, type });

describe("analyzeVCFG stack-guard (rollback経路付き)", () => {
  it("rollback エッジを辿って NS に復帰する", async () => {
    const graph: StaticGraph = {
      nodes: [
        node("n0", 0, "ns", "0: ns entry"),
        node("sb", -1, "spec", "spec-begin ctxA", { id: "ctxA", phase: "begin" }),
        node("s1", 1, "spec", "1: spec work"),
        node("se", -2, "spec", "spec-end ctxA", { id: "ctxA", phase: "end" }),
      ],
      edges: [
        edge("n0", "sb", "spec"),
        edge("sb", "s1", "spec"),
        edge("s1", "se", "spec"),
        edge("se", "n0", "rollback"),
      ],
    };

    const res = await analyzeVCFG(graph, { speculationMode: "stack-guard" });

    const returnedToNs = res.trace.steps.some(
      (s) => s.nodeId === "n0" && s.executionMode === "NS" && s.stepId > 0,
    );
    expect(returnedToNs).toBe(true);
  });
});
