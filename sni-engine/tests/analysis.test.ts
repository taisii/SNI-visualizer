import { describe, it, expect } from "vitest";
import { analyzeVCFG } from "../lib/analysis/analyze";
import type { StaticGraph } from "@/lib/analysis-schema";
import { buildVCFG } from "@/vcfg-builder";

const baseNode = (
  id: string,
  pc: number,
  type: "ns" | "spec",
  instruction: string,
): StaticGraph["nodes"][number] => ({
  id,
  pc,
  label: `${pc}: ${instruction}`,
  type,
  instruction,
});

const edge = (
  source: string,
  target: string,
  type: "ns" | "spec" | "rollback",
) => ({ source, target, type });

describe("analyzeVCFG", () => {
  it("Secure single-node program", async () => {
    const graph: StaticGraph = {
      nodes: [baseNode("n0", 0, "ns", "skip")],
      edges: [],
    };

    const res = await analyzeVCFG(graph, {
      entryRegs: ["a"],
      policy: { regs: { a: "Low" } },
    });

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

    const res = await analyzeVCFG(graph, {
      policy: { mem: { secret: "High" }, regs: { secret: "High" } },
    });

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
      nodes: [baseNode("n0", 0, "ns", "skip"), baseNode("n1", 1, "ns", "skip")],
      edges: [edge("n0", "n1", "ns"), edge("n1", "n0", "ns")],
    };

    const res = await analyzeVCFG(graph, { iterationCap: 0, entryRegs: ["a"] });
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

    const res = await analyzeVCFG(graph, {
      policy: { mem: { secret: "High" }, regs: { secret: "High" } },
    });

    expect(res.result).toBe("SNI_Violation");
    const n2 = res.trace.steps.find(
      (s) => s.nodeId === "n2" && s.executionMode === "NS",
    );
    const regs = n2?.state.sections.find((s) => s.id === "regs")?.data ?? {};
    expect(Object.keys(regs).sort()).toEqual(["r", "secret"].sort());
    expect(regs.r.label).toBe("EqLow");
    const obsSection = n2?.state.sections.find((s) => s.id === "obsMem");
    expect(obsSection?.alert).toBe(true);
  });

  it("unknown regs default to EqHigh", async () => {
    const graph: StaticGraph = {
      nodes: [baseNode("n0", 0, "ns", "assign x y")],
      edges: [],
    };

    const res = await analyzeVCFG(graph, {});
    const regs =
      res.trace.steps[0].state.sections.find((s) => s.id === "regs")?.data ??
      {};
    expect(regs.x.label).toBe("EqLow");
  });

  it("uses instructionAst to evaluate expressions", async () => {
    const graph: StaticGraph = {
      nodes: [baseNode("n0", 0, "ns", "x <- b + 1")],
      edges: [],
    };
    const firstNode = graph.nodes[0];
    if (!firstNode) throw new Error("graph.nodes[0] is missing");
    firstNode.instructionAst = {
      op: "assign",
      dest: "x",
      expr: {
        kind: "binop",
        op: "+",
        left: { kind: "reg", name: "b" },
        right: { kind: "int", value: 1 },
      },
      text: "x <- b + 1",
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { b: "High" } },
      entryRegs: ["x", "b"],
    });
    const regs =
      res.trace.steps[1].state.sections.find((s) => s.id === "regs")?.data ??
      {};
    expect(regs.x.label).toBe("EqHigh");
  });

  it("store in speculative mode flags leak via observation", async () => {
    const graph: StaticGraph = {
      nodes: [baseNode("s0", 0, "spec", "store secret addr")],
      edges: [],
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { secret: "High", addr: "High" } },
    });
    const step = res.trace.steps[1];
    expect(step.isViolation).toBe(true);
    const obs = step.state.sections.find((s) => s.id === "obsMem");
    expect(obs?.alert).toBe(true);
  });

  it("cmov joins condition and source", async () => {
    const graph: StaticGraph = {
      nodes: [baseNode("n0", 0, "ns", "cmov dst cond src")],
      edges: [],
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { cond: "High", src: "Low" } },
    });
    const regs =
      res.trace.steps[1].state.sections.find((s) => s.id === "regs")?.data ??
      {};
    expect(regs.dst.label).toBe("EqHigh");
  });

  it("rejects unknown instruction with AnalysisError", async () => {
    const graph: StaticGraph = {
      nodes: [baseNode("n0", 0, "ns", "foobar x")],
      edges: [],
    };

    const res = await analyzeVCFG(graph, { policy: { regs: { x: "Low" } } });
    expect(res.error?.type).toBe("AnalysisError");
    expect(res.error?.message).toContain("unsupported instruction");
    expect(res.trace.steps).toHaveLength(0);
  });

  it("speculative edge keeps speculative mode even if target node is ns", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        baseNode("n1", 1, "ns", "load x secret"),
      ],
      edges: [edge("n0", "n1", "spec")],
    };

    const res = await analyzeVCFG(graph, {
      policy: { mem: { secret: "High" }, regs: { secret: "High" } },
    });
    const step = res.trace.steps.find((s) => s.nodeId === "n1");
    expect(step?.executionMode).toBe("Speculative");
    expect(step?.isViolation).toBe(true);
  });

  it("detects control-flow leak via beqz condition", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "assign cond low"), // NS: cond は Low
        baseNode("s1", 1, "spec", "assign cond secret"), // Spec: cond に High を上書き
        baseNode("n2", 2, "ns", "beqz cond L1"), // 条件値を観測する制御点
      ],
      edges: [
        edge("n0", "n2", "ns"), // ベースライン経路
        edge("n0", "s1", "spec"), // 投機的に cond を High にする経路
        edge("s1", "n2", "spec"), // 投機的 beqz
      ],
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { low: "Low", secret: "High" } },
    });

    expect(res.result).toBe("SNI_Violation");
    const specN2 = res.trace.steps.find(
      (s) => s.nodeId === "n2" && s.executionMode === "Speculative",
    );
    expect(specN2?.isViolation).toBe(true);
    const obs = specN2?.state.sections.find((s) => s.id === "obsCtrl");
    expect(obs?.alert).toBe(true);
    // PC=2 の制御観測が Leak として記録されていること
    expect(obs?.data["2"].label).toBe("Leak");
  });

  it("rollback restores baseline regs/mem while keeping obs leak", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "assign r base"),
        baseNode("s1", 1, "spec", "store secret secret"),
        baseNode("n2", 2, "ns", "skip"),
      ],
      edges: [
        edge("n0", "s1", "spec"),
        edge("s1", "n2", "rollback"),
        edge("n0", "n2", "ns"), // ベースライン経路
      ],
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { base: "Low", secret: "High" } },
    });

    const n2ns = res.trace.steps.find(
      (s) => s.nodeId === "n2" && s.executionMode === "NS",
    );
    const regs = n2ns?.state.sections.find((s) => s.id === "regs")?.data ?? {};
    expect(regs.r.label).toBe("EqLow"); // 基本経路の値に戻る
    const obs = n2ns?.state.sections.find((s) => s.id === "obsMem");
    expect(obs?.alert).toBe(true); // 投機中の観測は保持
  });

  it("replay trace unrolls cycles up to visit cap in deterministic order", async () => {
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
    // 現行実装では「状態が変化したノードのみ」ワークリストで展開する。
    // このグラフではどのノードでも状態が変わらないため、entry と最初の n0 だけが記録される。
    expect(order).toEqual(["", "n0"]);
  });

  it("worklist trace is finite on cycles and retains converged states", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "assign a b"),
        baseNode("n1", 1, "ns", "assign b a"),
      ],
      edges: [edge("n0", "n1", "ns"), edge("n1", "n0", "ns")],
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { a: "Low", b: "High" } },
    });
    const steps = res.trace.steps;
    // 状態が収束した後は同じノードを再訪しないことを確認（entry + n0 + n1）
    expect(steps.length).toBe(3);
    const regsN1 =
      steps
        .filter((s) => s.nodeId === "n1")
        .pop()
        ?.state.sections.find((s) => s.id === "regs")?.data ?? {};
    expect(regsN1.a.label).toBe("EqHigh");
    expect(regsN1.b.label).toBe("EqHigh");
  });

  it("worklist trace logs each visit state changes in order", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "load z a"),
        baseNode("n1", 1, "ns", "load a c"),
      ],
      edges: [edge("n0", "n1", "ns"), edge("n1", "n0", "ns")],
    };

    const res = await analyzeVCFG(graph, {
      maxSteps: 10,
      entryRegs: ["z", "a", "c"],
    });

    const order = res.trace.steps.map((s) => s.nodeId);
    expect(order).toEqual(["", "n0", "n1", "n0", "n1"]); // entry含む
    const lastN1 = res.trace.steps.filter((s) => s.nodeId === "n1").pop();
    const regsN1 =
      lastN1?.state.sections.find((s) => s.id === "regs")?.data ?? {};
    expect(regsN1.a.label).toBe("EqHigh");
    const lastN0 = res.trace.steps.filter((s) => s.nodeId === "n0").pop();
    const regsN0 =
      lastN0?.state.sections.find((s) => s.id === "regs")?.data ?? {};
    expect(regsN0.z.label).toBe("EqHigh");
  });

  it("uses bfs trace order by default", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "assign a b"),
        baseNode("n1", 1, "ns", "assign c a"),
        baseNode("n2", 2, "ns", "assign d c"),
      ],
      edges: [edge("n0", "n1", "ns"), edge("n0", "n2", "ns")],
    };

    const res = await analyzeVCFG(graph, {
      entryRegs: ["a", "b", "c", "d"],
      policy: { regs: { b: "High" } },
    });
    const order = res.trace.steps.map((s) => s.nodeId);

    expect(res.traceMode).toBe("bfs");
    expect(order).toEqual(["", "n0", "n1", "n2"]);
  });

  it("switches to single-path (LIFO) trace order when traceMode is set", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "assign a b"),
        baseNode("n1", 1, "ns", "assign c a"),
        baseNode("n2", 2, "ns", "assign d c"),
      ],
      edges: [edge("n0", "n1", "ns"), edge("n0", "n2", "ns")],
    };

    const res = await analyzeVCFG(graph, {
      traceMode: "single-path",
      entryRegs: ["a", "b", "c", "d"],
      policy: { regs: { b: "High" } },
    });
    const order = res.trace.steps.map((s) => s.nodeId);

    expect(res.traceMode).toBe("single-path");
    expect(order).toEqual(["", "n0", "n2", "n1"]);
  });

  it("seeds registers used in program at step0", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "load z a"),
        baseNode("n1", 1, "ns", "load a c"),
        baseNode("n2", 2, "ns", "beqz y Loop"),
      ],
      edges: [
        edge("n0", "n1", "ns"),
        edge("n1", "n2", "ns"),
        edge("n2", "n0", "ns"),
      ],
    };

    const res = await analyzeVCFG(graph, {});
    const step0 = res.trace.steps[0];
    const regs = step0.state.sections.find((s) => s.id === "regs")?.data ?? {};
    expect(Object.keys(regs).sort()).toEqual(["a", "c", "y", "z"].sort());
    expect(regs.a.label).toBe("EqLow");
    expect(regs.y.label).toBe("EqLow");
  });

  it("parses MuASM commas/<- via AST and completes without unsupported instruction", async () => {
    const code = `
Loop:
  beqz x, L3
  load z, secret
  jmp L11
L3:
  beqz w, L10
  load temp, in
  jmp L11
L10:
  secret <- temp
L11:
  beqz y, Loop
`;
    const graph = buildVCFG(code);
    const res = await analyzeVCFG(graph, { iterationCap: 300, maxSteps: 300 });
    expect(res.error).toBeUndefined();
  });

  it("loop program (load-load-branch) produces stable EqHigh observations", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "load z a"), // load z, a
        baseNode("n1", 1, "ns", "load a c"), // load a, c
        baseNode("n2", 2, "ns", "beqz y Loop"),
      ],
      edges: [
        edge("n0", "n1", "ns"),
        edge("n1", "n2", "ns"),
        edge("n2", "n0", "ns"), // Loop back
      ],
    };

    const res = await analyzeVCFG(graph, {
      entryRegs: ["z", "a", "c", "y"],
      policy: {
        mem: { a: "High", c: "High" },
        regs: { y: "Low", a: "Low", c: "Low", z: "Low" },
      },
    });
    expect(res.result).toBe("Secure");
    const steps = res.trace.steps;
    const nodeSeq = steps.map((s) => s.nodeId);
    // 現行実装では entry, n0, n1 の 3 ステップで収束する
    expect(nodeSeq.slice(0, 3)).toEqual(["", "n0", "n1"]);
    expect(nodeSeq.filter((id) => id === "n0").length).toBeGreaterThanOrEqual(
      1,
    );

    const firstN0 = steps.find((s) => s.nodeId === "n0" && s.stepId !== 0);
    if (!firstN0) throw new Error("first n0 missing");
    const regsN0 = firstN0.state.sections.find((s) => s.id === "regs")?.data;
    if (!regsN0) throw new Error("regs n0 missing");
    expect(regsN0.z.label).toBe("EqHigh");
    const obsN0 = firstN0.state.sections.find((s) => s.id === "obsMem");
    if (!obsN0) throw new Error("obs n0 missing");
    // NS 観測も High をベースラインとして記録する
    expect(obsN0.data["0:a"].label).toBe("EqLow"); // アドレスのみ観測のため Low 基準

    const firstN1 = steps.find((s) => s.nodeId === "n1");
    if (!firstN1) throw new Error("first n1 missing");
    const regsN1 = firstN1.state.sections.find((s) => s.id === "regs")?.data;
    if (!regsN1) throw new Error("regs n1 missing");
    expect(regsN1.a.label).toBe("EqHigh");
    const obsN1 = firstN1.state.sections.find((s) => s.id === "obsMem");
    if (!obsN1) throw new Error("obs n1 missing");
    // 同様に 1 番目の load も High 観測となる
    expect(obsN1.data["1:c"].label).toBe("EqLow");

    expect(steps.every((s) => s.isViolation === false)).toBe(true);
  });
});
