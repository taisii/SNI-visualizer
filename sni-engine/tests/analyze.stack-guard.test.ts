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

describe("analyzeVCFG stack-guard mode", () => {
  it("異なる投機コンテキストの spec-end への誤突入を拒否する", async () => {
    const graph: StaticGraph = {
      nodes: [
        node("n0", 0, "ns", "0: ns entry"),
        node("sbA", -1, "spec", "spec-begin A", { id: "ctxA", phase: "begin" }),
        node("sA", 1, "spec", "1: spec A"),
        node("seA", -2, "spec", "spec-end A", { id: "ctxA", phase: "end" }),
        node("seB", -4, "spec", "spec-end B", { id: "ctxB", phase: "end" }),
      ],
      edges: [
        edge("n0", "sbA", "spec"),
        edge("sbA", "sA", "spec"),
        // 誤ったエッジ: A の中から B の spec-end へ直接向かう
        edge("sA", "seB", "spec"),
        // 正常経路も用意しておく
        edge("sA", "seA", "spec"),
        edge("seA", "n0", "rollback"),
        // seB は誤った経路からしか到達できない
      ],
    };

    const res = await analyzeVCFG(graph, { speculationMode: "stack-guard" });

    const visitedIds = res.trace.steps.map((s) => s.nodeId);
    // guard により sA -> seB の遷移は落ちるので、B の spec-end は ctxB ルート経由のみ訪れる
    const directHijackHit = res.trace.steps.find(
      (s, idx) =>
        s.nodeId === "seB" &&
        res.trace.steps[idx - 1]?.nodeId === "sA" &&
        res.trace.steps[idx - 1]?.executionMode === "Speculative",
    );
    expect(directHijackHit).toBeUndefined();

    // 正常経路の seA は訪問される
    expect(visitedIds).toContain("seA");
  });

  it("ネストした投機を許可し、スタックを可視化する", async () => {
    const graph: StaticGraph = {
      nodes: [
        node("n0", 0, "ns", "0: ns entry"),
        node("sbA", -1, "spec", "spec-begin A", { id: "ctxA", phase: "begin" }),
        node("n1", 1, "ns", "1: ns in spec A"),
        node("sbB", -2, "spec", "spec-begin B", { id: "ctxB", phase: "begin" }),
        node("n2", 2, "ns", "2: ns in spec B"),
        node("seB", -3, "spec", "spec-end B", { id: "ctxB", phase: "end" }),
        node("seA", -4, "spec", "spec-end A", { id: "ctxA", phase: "end" }),
      ],
      edges: [
        edge("n0", "sbA", "spec"),
        edge("sbA", "n1", "spec"),
        edge("n1", "sbB", "spec"),
        edge("sbB", "n2", "spec"),
        edge("n2", "seB", "spec"),
        edge("seB", "n1", "rollback"),
        edge("n1", "seA", "spec"),
        edge("seA", "n0", "rollback"),
      ],
    };

    const res = await analyzeVCFG(graph, { speculationMode: "stack-guard" });

    // 診断用にステップを保持していることを簡易確認
    expect(res.error).toBeUndefined();

    const seBStep = res.trace.steps.find((s) => s.nodeId === "seB");
    expect(seBStep?.executionMode).toBe("Speculative");
    const specSection = seBStep?.state.sections.find((s) => s.id === "specStack");
    expect(specSection?.data.d1.label).toBe("ctxB");
    expect(specSection?.data.d2.label).toBe("ctxA");
  });
});
