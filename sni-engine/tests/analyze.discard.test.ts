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

describe("analyzeVCFG discard mode", () => {
  it("rollback エッジを無視し、spec-end で終端する", async () => {
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

    const res = await analyzeVCFG(graph, { speculationMode: "discard" });

    const nsHits = res.trace.steps.filter(
      (s) => s.nodeId === "n0" && s.executionMode === "NS",
    );
    // 初回の n0 だけが含まれるはず
    expect(nsHits).toHaveLength(1);
    const last = res.trace.steps[res.trace.steps.length - 1];
    expect(last.nodeId).toBe("se");
    expect(last.executionMode).toBe("Speculative");

    const specSection = last.state.sections.find((s) => s.id === "specStack");
    expect(specSection).toBeDefined();
    expect(specSection?.data.d1.label).toBe("ctxA");
  });
});
