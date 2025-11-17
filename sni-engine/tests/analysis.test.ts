import { describe, it, expect } from "vitest";
import { analyzeVCFG } from "../src/analysis";
import type { StaticGraph } from "../../app/types/analysis-result";

const baseNode = (id: string, pc: number, type: "ns" | "spec", instruction: string): StaticGraph["nodes"][number] => ({
  id,
  pc,
  label: `${pc}: ${instruction}`,
  type,
  instruction,
});

const edge = (source: string, target: string, type: "ns" | "spec" | "rollback") => ({ source, target, type });

describe("analyzeVCFG", () => {
  it("Secure single-node program", async () => {
    const graph: StaticGraph = {
      nodes: [baseNode("n0", 0, "ns", "skip")],
      edges: [],
    };

    const res = await analyzeVCFG(graph, { entryRegs: ["a"], policy: { regs: { a: "Low" } } });

    expect(res.result).toBe("Secure");
    expect(res.trace.steps[0].executionMode).toBe("NS");
  });

  it("detects speculative leak", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        baseNode("s1", 1, "spec", "load x secret"),
      ],
      edges: [edge("n0", "s1", "spec")],
    };

    const res = await analyzeVCFG(graph, { policy: { mem: { secret: "High" } } });

    expect(res.result).toBe("SNI_Violation");
    const specStep = res.trace.steps.find((s) => s.nodeId === "s1");
    expect(specStep?.isViolation).toBe(true);
  });

  it("barrier-like graph without leak stays Secure", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        baseNode("n1", 1, "ns", "spbarr"),
      ],
      edges: [edge("n0", "n1", "ns")],
    };

    const res = await analyzeVCFG(graph, {});
    expect(res.result).toBe("Secure");
  });

  it("returns ParseError instead of throwing on invalid graph", async () => {
    const graph: StaticGraph = {
      nodes: [baseNode("n0", 0, "ns", "skip")],
      edges: [{ source: "missing", target: "n0", type: "ns" }],
    };

    const res = await analyzeVCFG(graph, {});
    expect(res.error?.type).toBe("ParseError");
    expect(res.result).toBe("SNI_Violation");
  });

  it("caps iterations with AnalysisError", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        baseNode("n1", 1, "ns", "skip"),
      ],
      edges: [edge("n0", "n1", "ns"), edge("n1", "n0", "ns")],
    };

    const res = await analyzeVCFG(graph, { iterationCap: 1, entryRegs: ["a"] });
    expect(res.error?.type).toBe("AnalysisError");
    expect(res.result).toBe("SNI_Violation");
  });

  it("rollback keeps observations but discards speculative regs/mem", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        baseNode("s1", 1, "spec", "load r secret"),
        baseNode("n2", 2, "ns", "skip"),
      ],
      edges: [edge("n0", "s1", "spec"), edge("s1", "n2", "rollback")],
    };

    const res = await analyzeVCFG(graph, { policy: { mem: { secret: "High" } } });

    expect(res.result).toBe("SNI_Violation");
    const n2 = res.trace.steps.find((s) => s.nodeId === "n2");
    const regs = n2?.state.sections.find((s) => s.id === "regs")?.data ?? {};
    expect(Object.keys(regs).length).toBe(0);
    const obsSection = n2?.state.sections.find((s) => s.id === "obs");
    expect(obsSection?.alert).toBe(true);
  });

  it("unknown regs default to EqHigh", async () => {
    const graph: StaticGraph = {
      nodes: [baseNode("n0", 0, "ns", "assign x y")],
      edges: [],
    };

    const res = await analyzeVCFG(graph, {});
    const regs = res.trace.steps[0].state.sections.find((s) => s.id === "regs")?.data ?? {};
    expect(regs["x"].label).toBe("EqHigh");
  });

  it("store in speculative mode flags leak via observation", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("s0", 0, "spec", "store secret addr"),
      ],
      edges: [],
    };

    const res = await analyzeVCFG(graph, { policy: { regs: { secret: "High", addr: "Low" } } });
    const step = res.trace.steps[0];
    expect(step.isViolation).toBe(true);
    const obs = step.state.sections.find((s) => s.id === "obs");
    expect(obs?.alert).toBe(true);
  });

  it("cmov joins condition and source", async () => {
    const graph: StaticGraph = {
      nodes: [baseNode("n0", 0, "ns", "cmov dst cond src")],
      edges: [],
    };

    const res = await analyzeVCFG(graph, { policy: { regs: { cond: "High", src: "Low" } } });
    const regs = res.trace.steps[0].state.sections.find((s) => s.id === "regs")?.data ?? {};
    expect(regs["dst"].label).toBe("Top");
  });

  it("unknown instruction conservatively escalates to Top", async () => {
    const graph: StaticGraph = {
      nodes: [baseNode("n0", 0, "ns", "foobar x")],
      edges: [],
    };

    const res = await analyzeVCFG(graph, { policy: { regs: { x: "Low" } } });
    const step = res.trace.steps[0];
    const regs = step.state.sections.find((s) => s.id === "regs")?.data ?? {};
    expect(regs["x"].label).toBe("Top");
    expect(step.isViolation).toBe(true);
  });

  it("replay trace visits reachable nodes once in deterministic order", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        baseNode("n1", 1, "ns", "skip"),
        baseNode("n2", 2, "ns", "skip"),
      ],
      edges: [
        edge("n0", "n2", "ns"), // 挿入順で n2 が先
        edge("n0", "n1", "spec"),
        edge("n2", "n0", "ns"), // サイクルを作るが再生では一度のみ
      ],
    };

    const res = await analyzeVCFG(graph, {});
    const order = res.trace.steps.map((s) => s.nodeId);
    expect(order).toEqual(["n0", "n2", "n1"]); // edges の順序に追従し再訪しない
  });

  it("replay trace is finite on cycles and retains fixpoint states", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "assign a b"),
        baseNode("n1", 1, "ns", "assign b a"),
      ],
      edges: [edge("n0", "n1", "ns"), edge("n1", "n0", "ns")],
    };

    const res = await analyzeVCFG(graph, { policy: { regs: { a: "Low", b: "High" } } });
    const steps = res.trace.steps;
    expect(steps.length).toBe(2); // cycle でも1ノード1回
    const regsN1 = steps.find((s) => s.nodeId === "n1")?.state.sections.find((s) => s.id === "regs")?.data ?? {};
    // cycle後でも一度の再生で停止し、fixpoint結果を保持（a/b は EqHigh のまま）
    expect(regsN1["a"].label).toBe("EqHigh");
    expect(regsN1["b"].label).toBe("EqHigh");
  });
});
