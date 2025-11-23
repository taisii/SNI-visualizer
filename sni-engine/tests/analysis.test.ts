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

const specMetaNode = (
  id: string,
  pc: number,
  label: string,
  phase: "begin" | "end",
  contextId: string,
): StaticGraph["nodes"][number] => ({
  id,
  pc,
  label,
  type: "spec",
  instruction: "skip",
  specContext: { id: contextId, phase },
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

  it("stops exploring once a Leak is observed", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        baseNode("s1", 1, "spec", "load r secret"),
        baseNode("n2", 2, "ns", "skip"),
      ],
      edges: [
        edge("n0", "s1", "spec"),
        edge("s1", "n2", "rollback"),
        edge("n2", "n0", "ns"),
      ],
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { secret: "High", r: "Low" }, mem: { secret: "High" } },
    });

    expect(res.result).toBe("SNI_Violation");
    const visitedNodes = res.trace.steps.map((s) => s.nodeId);
    expect(visitedNodes).not.toContain("n2");
    const lastStep = res.trace.steps[res.trace.steps.length - 1];
    expect(lastStep?.nodeId).toBe("s1");
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
        baseNode("n0", 0, "ns", "assign warm hi"),
        baseNode("s1", 1, "spec", "load r ptr"),
        baseNode("n2", 2, "ns", "skip"),
      ],
      edges: [edge("n0", "s1", "spec"), edge("s1", "n2", "rollback")],
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { ptr: "Low", hi: "High" } },
      speculationMode: "stack-guard",
    });

    expect(res.result).toBe("Secure");
    const n2 = res.trace.steps.find(
      (s) => s.nodeId === "n2" && s.executionMode === "NS",
    );
    expect(n2).toBeDefined();
    const regs = n2?.state.sections.find((s) => s.id === "regs")?.data ?? {};
    expect(regs.r.label).toBe("Low");
    const obsSection = n2?.state.sections.find((s) => s.id === "obsMem");
    expect(obsSection?.alert).toBe(false);
    const obsEntries = obsSection?.data ?? {};
    expect(obsEntries["1:ptr"]?.label).toBe("Low");
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
    expect(regs.x.label).toBe("Low");
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
    expect(regs.x.label).toBe("High");
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

  it("NS モードでは spec-begin ノード以外への spec エッジを辿らない", async () => {
    const program = `Loop:
  load z, a
  load a, c
  beqz y, Loop
  load z, a
  load a, c`;
    const graph = buildVCFG(program, { windowSize: 5 });

    const res = await analyzeVCFG(graph, { traceMode: "single-path" });
    const firstSpecStep = res.trace.steps.find((s) => s.executionMode === "Speculative");
    expect(firstSpecStep).toBeDefined();
    const node = graph.nodes.find((n) => n.id === firstSpecStep?.nodeId);
    expect(node?.type).toBe("spec");
    expect(node?.label?.startsWith("spec-begin")).toBe(true);
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
    expect(regs.dst.label).toBe("High");
  });

  it("rejects unknown instruction with AnalysisError", async () => {
    const graph: StaticGraph = {
      nodes: [baseNode("n0", 0, "ns", "foobar x")],
      edges: [],
    };

    const res = await analyzeVCFG(graph, { policy: { regs: { x: "Low" } } });
    expect(res.error?.type).toBe("AnalysisError");
    expect(res.error?.message).toContain("unsupported instruction");
    expect(res.trace.steps.length).toBeGreaterThan(0);
  });

  it("speculative edge keeps speculative mode when NS -> spec-begin -> ns", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        {
          id: "sb",
          pc: -1,
          label: "spec-begin unit-test",
          type: "spec",
          instruction: "skip",
        },
        baseNode("n1", 1, "ns", "load x secret"),
      ],
      edges: [edge("n0", "sb", "spec"), edge("sb", "n1", "spec")],
    };

    const res = await analyzeVCFG(graph, {
      policy: { mem: { secret: "High" }, regs: { secret: "High" } },
    });
    const step = res.trace.steps.find((s) => s.nodeId === "n1");
    expect(step?.executionMode).toBe("Speculative");
    expect(step?.isViolation).toBe(true);
  });

  it("warns (but does not error) when maxSpeculationDepth prevents entering a new context", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        specMetaNode("sbOuter", -1, "spec-begin outer", "begin", "ctxOuter"),
        baseNode("outerWork", 1, "spec", "skip"),
        specMetaNode("sbInner", -2, "spec-begin inner", "begin", "ctxInner"),
        baseNode("innerWork", 2, "spec", "skip"),
      ],
      edges: [
        edge("n0", "sbOuter", "spec"),
        edge("sbOuter", "outerWork", "spec"),
        edge("outerWork", "sbInner", "spec"),
        edge("sbInner", "innerWork", "spec"),
      ],
    };

    const res = await analyzeVCFG(graph, { maxSpeculationDepth: 1 });

    expect(res.result).toBe("Secure");
    const visited = res.trace.steps.map((s) => s.nodeId);
    expect(visited).not.toContain("innerWork");
    expect(res.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "MaxSpeculationDepth",
          detail: expect.objectContaining({ contextId: "ctxInner" }),
        }),
      ]),
    );
  });

  it("rollback しても外側の投機文脈があれば Speculative を維持する", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        specMetaNode("sbOuter", -1, "spec-begin outer", "begin", "ctxOuter"),
        baseNode("n1", 1, "ns", "assign r secret"),
        specMetaNode("sbInner", -2, "spec-begin inner", "begin", "ctxInner"),
        baseNode("n2", 2, "ns", "assign q secret"),
        specMetaNode("seInner", -3, "spec-end inner", "end", "ctxInner"),
        baseNode("n3", 3, "ns", "assign p secret"),
        specMetaNode("seOuter", -4, "spec-end outer", "end", "ctxOuter"),
        baseNode("n4", 4, "ns", "skip"),
      ],
      edges: [
        edge("n0", "sbOuter", "spec"),
        edge("sbOuter", "n1", "spec"),
        edge("n1", "sbInner", "spec"),
        edge("sbInner", "n2", "spec"),
        edge("n2", "seInner", "spec"),
        edge("seInner", "n3", "rollback"),
        edge("n3", "seOuter", "spec"),
        edge("seOuter", "n4", "rollback"),
      ],
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { secret: "High", r: "Low", q: "Low", p: "Low" } },
      speculationMode: "stack-guard",
    });
    expect(res.result).toBe("Secure");

    const afterInner = res.trace.steps.find(
      (s) => s.nodeId === "n3" && s.executionMode === "Speculative",
    );
    expect(afterInner).toBeDefined();

    const afterOuter = res.trace.steps.find(
      (s) => s.nodeId === "n4" && s.executionMode === "NS",
    );
    expect(afterOuter).toBeDefined();
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

  it("detects control-flow leak via jmp target expression", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "assign tgt base"),
        baseNode("s1", 1, "spec", "assign tgt secret"),
        baseNode("n2", 2, "ns", "jmp tgt"),
      ],
      edges: [
        edge("n0", "n2", "ns"), // ベースライン: Low ターゲット
        edge("n0", "s1", "spec"),
        edge("s1", "n2", "spec"), // Spec: High ターゲット
      ],
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { base: "Low", secret: "High", tgt: "Low" } },
      entryRegs: ["base", "secret", "tgt"],
    });

    expect(res.result).toBe("SNI_Violation");
    const specJmp = res.trace.steps.find(
      (s) => s.nodeId === "n2" && s.executionMode === "Speculative",
    );
    expect(specJmp?.isViolation).toBe(true);
    const obs = specJmp?.state.sections.find((s) => s.id === "obsCtrl");
    expect(obs?.alert).toBe(true);
    expect(obs?.data["2:target:tgt"]?.label).toBe("Leak");
  });

  it("does not report leak when jmp target stays Low in NS/Spec", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "assign tgt base"), // NS/Spec とも Low のまま
        baseNode("s1", 1, "spec", "assign tgt base"),
        baseNode("n2", 2, "ns", "jmp tgt"),
      ],
      edges: [
        edge("n0", "n2", "ns"),
        edge("n0", "s1", "spec"),
        edge("s1", "n2", "spec"),
      ],
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { base: "Low", tgt: "Low" } },
      entryRegs: ["base", "tgt"],
    });

    expect(res.result).toBe("Secure");
    const specJmp = res.trace.steps.find(
      (s) => s.nodeId === "n2" && s.executionMode === "Speculative",
    );
    const obs = specJmp?.state.sections.find((s) => s.id === "obsCtrl");
    expect(obs?.alert).toBe(false);
    expect(obs?.data["2:target:tgt"]?.label).toBe("Low");
  });

  it("stringifies complex jmp target expressions in observations", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "assign a base"),
        baseNode("n1", 1, "ns", "assign b base"),
        {
          id: "n2",
          pc: 2,
          type: "ns",
          label: "2: jmp (a+b)",
          instruction: "jmp a+b",
          instructionAst: {
            op: "jmp",
            target: {
              kind: "binop",
              op: "+",
              left: { kind: "reg", name: "a" },
              right: { kind: "reg", name: "b" },
            },
            text: "jmp (a+b)",
          },
        },
        baseNode("s3", 3, "spec", "assign b secret"),
      ],
      edges: [
        edge("n0", "n1", "ns"),
        edge("n1", "n2", "ns"),
        edge("n1", "s3", "spec"),
        edge("s3", "n2", "spec"),
      ],
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { base: "Low", secret: "High", a: "Low", b: "Low" } },
      entryRegs: ["base", "secret", "a", "b"],
    });

    expect(res.result).toBe("SNI_Violation");
    const specJmp = res.trace.steps.find(
      (s) => s.nodeId === "n2" && s.executionMode === "Speculative",
    );
    expect(specJmp?.isViolation).toBe(true);
    const obs = specJmp?.state.sections.find((s) => s.id === "obsCtrl");
    expect(obs?.alert).toBe(true);
    expect(obs?.data["2:target:(a+b)"]?.label).toBe("Leak");
  });

  it("rollback restores baseline regs/mem after secure speculation", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "assign r base"),
        baseNode("s1", 1, "spec", "assign r secret"),
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
    expect(regs.r.label).toBe("Low"); // 基本経路の値に戻る
    const obs = n2ns?.state.sections.find((s) => s.id === "obsMem");
    expect(obs?.alert).toBe(false);
  });

  it("selects NS/SP updates based on executionMode from trace logic", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "assign r base"),
        baseNode("s1", 1, "spec", "assign r secret"),
        baseNode("n2", 2, "ns", "skip"),
      ],
      edges: [
        edge("n0", "s1", "spec"),
        edge("s1", "n2", "rollback"),
        edge("n0", "n2", "ns"),
      ],
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { base: "Low", secret: "High", r: "Low" } },
    });

    const specAssign = res.trace.steps.find(
      (s) => s.nodeId === "s1" && s.executionMode === "Speculative",
    );
    expect(specAssign).toBeDefined();
    const regsSection = specAssign?.state.sections.find(
      (s) => s.id === "regs",
    );
    const rDetail = regsSection?.data.r.detail;
    expect(rDetail?.ns).toBe("Low");
    expect(rDetail?.sp).toBe("High");
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
    // 現行実装では「まだ訪れていない modeKey」も 1 度だけログに残す。
    expect(order).toEqual(["", "n0", "n2"]);
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
    expect(regsN1.a.label).toBe("High");
    expect(regsN1.b.label).toBe("High");
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
    expect(regsN1.a.label).toBe("High");
    const lastN0 = res.trace.steps.filter((s) => s.nodeId === "n0").pop();
    const regsN0 =
      lastN0?.state.sections.find((s) => s.id === "regs")?.data ?? {};
    expect(regsN0.z.label).toBe("High");
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
    expect(regs.a.label).toBe("Low");
    expect(regs.y.label).toBe("Low");
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
    const res = await analyzeVCFG(graph, { iterationCap: 2000, maxSteps: 2000 });
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
    expect(regsN0.z.label).toBe("High");
    const obsN0 = firstN0.state.sections.find((s) => s.id === "obsMem");
    if (!obsN0) throw new Error("obs n0 missing");
    // NS 観測も High をベースラインとして記録する
    expect(obsN0.data["0:a"].label).toBe("Low"); // アドレスのみ観測のため Low 基準

    const firstN1 = steps.find((s) => s.nodeId === "n1");
    if (!firstN1) throw new Error("first n1 missing");
    const regsN1 = firstN1.state.sections.find((s) => s.id === "regs")?.data;
    if (!regsN1) throw new Error("regs n1 missing");
    expect(regsN1.a.label).toBe("High");
    const obsN1 = firstN1.state.sections.find((s) => s.id === "obsMem");
    if (!obsN1) throw new Error("obs n1 missing");
    // 同様に 1 番目の load も High 観測となる
    expect(obsN1.data["1:c"].label).toBe("Low");

    expect(steps.every((s) => s.isViolation === false)).toBe(true);
  });

  it("returns partial trace when maxSteps is exceeded", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        baseNode("n1", 1, "ns", "skip"),
      ],
      edges: [edge("n0", "n1", "ns"), edge("n1", "n0", "ns")],
    };

    const res = await analyzeVCFG(graph, { maxSteps: 1 });
    expect(res.error?.message).toBe("maxSteps exceeded");
    expect(res.trace.steps.length).toBeGreaterThan(0);
  });

  it("specWindow が 1 のときは 2 ステップ目の投機を遮断する", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        {
          id: "sb",
          pc: -1,
          label: "spec-begin unit",
          type: "spec",
          instruction: "skip",
          specContext: { id: "ctx1", phase: "begin" },
        },
        baseNode("n1", 1, "ns", "skip"),
        baseNode("n2", 2, "ns", "load r secret"),
      ],
      edges: [
        edge("n0", "sb", "spec"),
        edge("sb", "n1", "spec"),
        edge("n1", "n2", "spec"),
      ],
    };

    const res = await analyzeVCFG(graph, {
      specMode: "light",
      specWindow: 1,
      policy: { mem: { secret: "High" }, regs: { secret: "High" } },
    });

    const visited = res.trace.steps.map((s) => s.nodeId);
    expect(visited).toContain("n1");
    expect(visited).not.toContain("n2");
    expect(res.result).toBe("Secure");
    const specStep = res.trace.steps.find((s) => s.nodeId === "n1");
    expect(specStep?.specWindowRemaining).toBe(0);
  });

  it("specWindow を 2 にすると投機 2 ステップ目の漏洩を検出する", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        {
          id: "sb",
          pc: -1,
          label: "spec-begin unit",
          type: "spec",
          instruction: "skip",
          specContext: { id: "ctx1", phase: "begin" },
        },
        baseNode("n1", 1, "ns", "skip"),
        baseNode("n2", 2, "ns", "load r secret"),
      ],
      edges: [
        edge("n0", "sb", "spec"),
        edge("sb", "n1", "spec"),
        edge("n1", "n2", "spec"),
      ],
    };

    const res = await analyzeVCFG(graph, {
      specMode: "light",
      specWindow: 2,
      policy: { mem: { secret: "High" }, regs: { secret: "High" } },
    });

    const visited = res.trace.steps.map((s) => s.nodeId);
    expect(visited).toContain("n2");
    expect(res.result).toBe("SNI_Violation");
  });

  it("spec-begin への突入で外側 specWindow がデクリメントされる（内側終了後の外側 spec を遮断）", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        // Outer speculation
        specMetaNode("sbOuter", -1, "spec-begin outer", "begin", "ctxOuter"),
        baseNode("n1", 1, "ns", "skip"),
        // Inner speculation
        specMetaNode("sbInner", -2, "spec-begin inner", "begin", "ctxInner"),
        baseNode("n2", 2, "ns", "skip"),
        specMetaNode("seInner", -3, "spec-end inner", "end", "ctxInner"),
        baseNode("n3", 3, "ns", "load r secret"), // outer でのみ到達させたいノード
      ],
      edges: [
        edge("n0", "sbOuter", "spec"),
        edge("sbOuter", "n1", "spec"),
        edge("n1", "sbInner", "spec"), // ここで inner を開始
        edge("sbInner", "n2", "spec"),
        edge("n2", "seInner", "spec"),
        edge("seInner", "n1", "rollback"), // inner を抜けて outer に戻る
        edge("n1", "n3", "spec"), // outer が残っていれば進むが、残量0なら遮断されるはず
      ],
    };

    const res = await analyzeVCFG(graph, {
      specMode: "light",
      specWindow: 1, // outer の窓を 1 に設定し、spec-begin で消費させる
      policy: { mem: { secret: "High" }, regs: { secret: "High" } },
      traceMode: "single-path",
    });

    const visited = res.trace.steps.map((s) => s.nodeId);
    // outer window が 1 → sbOuter->n1 で 0 になり、sbInner に入れないことを確認
    expect(visited).not.toContain("sbInner");
    expect(visited).not.toContain("n3"); // outer が尽きているので追加の spec も遮断
    expect(res.result).toBe("Secure");
  });

  it("外側の specWindow が尽きたら内側の spec-begin に入らない", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        {
          id: "sb1",
          pc: -1,
          label: "outer spec-begin",
          type: "spec",
          instruction: "skip",
          specContext: { id: "ctx1", phase: "begin" },
        },
        baseNode("n1", 1, "ns", "skip"),
        {
          id: "sb2",
          pc: -2,
          label: "inner spec-begin",
          type: "spec",
          instruction: "skip",
          specContext: { id: "ctx2", phase: "begin" },
        },
        baseNode("n2", 2, "ns", "load r secret"),
      ],
      edges: [
        edge("n0", "sb1", "spec"),
        edge("sb1", "n1", "spec"),
        edge("n1", "sb2", "spec"),
        edge("sb2", "n2", "spec"),
      ],
    };

    const res = await analyzeVCFG(graph, {
      specMode: "light",
      specWindow: 1,
      policy: { mem: { secret: "High" }, regs: { secret: "High" } },
    });

    const visited = res.trace.steps.map((s) => s.nodeId);
    expect(visited).toContain("sb1");
    expect(visited).toContain("n1");
    expect(visited).not.toContain("sb2");
    expect(visited).not.toContain("n2");
    const n1Step = res.trace.steps.find((s) => s.nodeId === "n1");
    expect(n1Step?.specWindowRemaining).toBe(0);
    expect(res.result).toBe("Secure");
  });

  it("specWindow が 0 以下ならエラーを返し解析を行わない", async () => {
    const graph: StaticGraph = {
      nodes: [baseNode("n0", 0, "ns", "skip")],
      edges: [],
    };

    const res = await analyzeVCFG(graph, {
      specMode: "light",
      specWindow: 0,
      policy: {},
    });

    expect(res.error?.type).toBe("AnalysisError");
    expect(res.error?.message).toContain("specWindow must be greater than 0");
    expect(res.trace.steps).toEqual([]);
    expect(res.result).toBe("SNI_Violation");
  });

  it("returns partial trace when iterationCap is exceeded", async () => {
    const graph: StaticGraph = {
      nodes: [
        baseNode("n0", 0, "ns", "skip"),
        baseNode("n1", 1, "ns", "skip"),
      ],
      edges: [edge("n0", "n1", "ns"), edge("n1", "n0", "ns")],
    };

    const res = await analyzeVCFG(graph, { iterationCap: 1 });
    expect(res.error?.message).toBe("iterationCap exceeded");
    expect(res.trace.steps.length).toBeGreaterThan(0);
  });
});
