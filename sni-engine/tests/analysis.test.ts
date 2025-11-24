import { describe, it, expect } from "vitest";
import type { DisplayValue, StaticGraph } from "@/lib/analysis-schema";
import { analyzeVCFG } from "../lib/analysis/analyze";
import { buildVCFG } from "@/vcfg-builder";

const node = (
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

const specBegin = (
  id: string,
  pc: number,
  ctx: string,
): StaticGraph["nodes"][number] => ({
  id,
  pc,
  label: "spec-begin",
  type: "spec",
  instruction: "skip",
  specContext: { id: ctx, phase: "begin" },
});

const edge = (source: string, target: string, type: "ns" | "spec") => ({
  source,
  target,
  type,
});

describe("analyzeVCFG (pruning VCFG)", () => {
  it("Secure single-node program", async () => {
    const graph: StaticGraph = {
      nodes: [node("n0", 0, "ns", "skip")],
      edges: [],
    };
    const res = await analyzeVCFG(graph, {});
    expect(res.result).toBe("Secure");
    expect(res.trace.steps[0].executionMode).toBe("NS");
  });

  it("detects speculative leak", async () => {
    const graph: StaticGraph = {
      nodes: [
        node("n0", 0, "ns", "skip"),
        {
          ...node("s1", 1, "spec", "load r secret"),
          specContext: { id: "ctx1", phase: "begin" },
        },
      ],
      edges: [edge("n0", "s1", "spec")],
    };
    const res = await analyzeVCFG(graph, {
      policy: { mem: { secret: "High" }, regs: { secret: "High", r: "Low" } },
    });
    expect(res.result).toBe("SNI_Violation");
    expect(
      res.trace.steps.some((s) => s.nodeId === "s1" && s.isViolation),
    ).toBe(true);
  });

  it("spec-begin resets window and ns edges keep speculative mode", async () => {
    // n0 --spec--> sb (spec-begin) --ns--> n1
    const graph: StaticGraph = {
      nodes: [
        node("n0", 0, "ns", "beqz x, L"),
        specBegin("sb", -1, "c1"),
        node("n1", 1, "ns", "load r a"),
      ],
      edges: [edge("n0", "sb", "spec"), edge("sb", "n1", "ns")],
    };
    const res = await analyzeVCFG(graph, {
      specWindow: 3,
      policy: { regs: { a: "Low", r: "Low" } },
    });
    const sbStep = res.trace.steps.find((s) => s.nodeId === "sb");
    const n1Step = res.trace.steps.find((s) => s.nodeId === "n1");
    expect(sbStep?.specWindowRemaining).toBe(3);
    expect(n1Step?.executionMode).toBe("Speculative");
    // ns edge でもステップ実行で減算される
    expect(n1Step?.specWindowRemaining).toBe(2);
  });

  it("prunes speculative edge when window is exhausted", async () => {
    // window=1 -> spec-begin でセット、次の spec は 0 になった時点で遮断
    const graph: StaticGraph = {
      nodes: [
        node("n0", 0, "ns", "skip"),
        specBegin("sb", -1, "ctx"),
        {
          ...node("s1", 1, "spec", "load r secret"),
          specContext: { id: "ctx", phase: "begin" },
        },
        node("s2", 2, "spec", "load r secret"),
      ],
      edges: [
        edge("n0", "sb", "spec"),
        edge("sb", "s1", "spec"),
        edge("s1", "s2", "spec"),
      ],
    };
    const res = await analyzeVCFG(graph, {
      specWindow: 2,
      policy: { mem: { secret: "High" }, regs: { secret: "High", r: "Low" } },
    });
    const visited = res.trace.steps.map((s) => s.nodeId);
    expect(visited).toContain("sb");
    expect(visited).toContain("s1");
    expect(visited).not.toContain("s2");
    const s1Step = res.trace.steps.find((s) => s.nodeId === "s1");
    expect(s1Step?.specWindowRemaining).toBe(1);
  });

  it("keeps larger budget on join to avoid losing reachable speculative steps", async () => {
    // sb -> s2 (spec) と sb -> t1(ns) -> s2(spec) で budget=2 と 1 が合流する
    const graph: StaticGraph = {
      nodes: [
        node("n0", 0, "ns", "skip"),
        specBegin("sb", -1, "ctx"),
        node("t1", 1, "spec", "skip"),
        {
          ...node("s2", 2, "spec", "skip"),
          specContext: { id: "ctx", phase: "end" },
        },
        node("s3", 3, "spec", "skip"),
      ],
      edges: [
        edge("n0", "sb", "spec"),
        edge("sb", "s2", "spec"), // 短い経路 (budget 2)
        edge("sb", "t1", "ns"), // 長い経路 (budget 1)
        edge("t1", "s2", "spec"),
        edge("s2", "s3", "spec"),
      ],
    };
    const res = await analyzeVCFG(graph, { specWindow: 3 });
    const visited = res.trace.steps.map((s) => s.nodeId);
    // budget の大きい経路を保持できていれば s3 まで到達する
    expect(visited).toContain("s3");
  });

  it("returns ParseError instead of throwing on invalid graph", async () => {
    const graph: StaticGraph = {
      nodes: [node("n0", 0, "ns", "skip")],
      edges: [{ source: "missing", target: "n0", type: "ns" }],
    };
    const res = await analyzeVCFG(graph, {});
    expect(res.error?.type).toBe("ParseError");
  });

  it("caps iterations with AnalysisError", async () => {
    const graph: StaticGraph = {
      nodes: [node("n0", 0, "ns", "skip"), node("n1", 1, "ns", "skip")],
      edges: [edge("n0", "n1", "ns"), edge("n1", "n0", "ns")],
    };
    const res = await analyzeVCFG(graph, { iterationCap: 0 });
    expect(res.error?.type).toBe("AnalysisError");
  });

  it("unknown regs default to EqHigh", async () => {
    const graph: StaticGraph = {
      nodes: [node("n0", 0, "ns", "assign x y")],
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
      nodes: [node("n0", 0, "ns", "x <- b + 1")],
      edges: [],
    };
    const first = graph.nodes[0];
    if (!first) {
      throw new Error("graph must contain at least one node");
    }
    first.instructionAst = {
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

  it("observations mark Leak and terminate search", async () => {
    const graph: StaticGraph = {
      nodes: [
        node("n0", 0, "ns", "skip"),
        {
          ...node("s1", 1, "spec", "load r secret"),
          specContext: { id: "ctx", phase: "begin" },
        },
        node("s2", 2, "spec", "load r secret"),
      ],
      edges: [edge("n0", "s1", "spec"), edge("s1", "s2", "spec")],
    };
    const res = await analyzeVCFG(graph, {
      policy: { mem: { secret: "High" }, regs: { secret: "High", r: "Low" } },
    });
    expect(res.result).toBe("SNI_Violation");
    const visited = res.trace.steps.map((s) => s.nodeId);
    expect(visited).not.toContain("s2");
  });

  it("detects control-flow leak via beqz condition", async () => {
    const graph: StaticGraph = {
      nodes: [
        node("n0", 0, "ns", "assign cond low"),
        {
          ...node("s1", 1, "spec", "assign cond secret"),
          specContext: { id: "ctx", phase: "begin" },
        },
        node("n2", 2, "ns", "beqz cond L1"),
      ],
      edges: [
        edge("n0", "n2", "ns"),
        edge("n0", "s1", "spec"),
        edge("s1", "n2", "spec"),
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
  });

  it("detects control-flow leak via jmp target expression", async () => {
    const graph: StaticGraph = {
      nodes: [
        node("n0", 0, "ns", "assign tgt base"),
        {
          ...node("s1", 1, "spec", "assign tgt secret"),
          specContext: { id: "ctx2", phase: "begin" },
        },
        node("n2", 2, "ns", "jmp tgt"),
      ],
      edges: [
        edge("n0", "n2", "ns"),
        edge("n0", "s1", "spec"),
        edge("s1", "n2", "spec"),
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
  });

  it("emits warning when Top is observed (non-fatal)", async () => {
    const graph: StaticGraph = {
      nodes: [node("n0", 0, "ns", "beqz cond L1")],
      edges: [],
    };
    const res = await analyzeVCFG(graph, {
      policy: { regs: { cond: "Top" } },
    });
    expect(res.result).toBe("Secure");
    expect(res.warnings?.some((w) => w.type === "TopObserved")).toBe(true);
    const step0 = res.trace.steps[1]; // after n0
    expect(step0.state.sections.find((s) => s.id === "obsCtrl")?.alert).toBe(
      false,
    );
  });

  it("cmov joins condition and source", async () => {
    const graph: StaticGraph = {
      nodes: [node("n0", 0, "ns", "cmov dst cond src")],
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

  it("worklist trace is finite on small loop once state converges", async () => {
    const graph: StaticGraph = {
      nodes: [
        node("n0", 0, "ns", "assign a b"),
        node("n1", 1, "ns", "assign b a"),
      ],
      edges: [edge("n0", "n1", "ns"), edge("n1", "n0", "ns")],
    };

    const res = await analyzeVCFG(graph, {
      policy: { regs: { a: "Low", b: "High" } },
    });
    // entry + n0 + n1 の 3 ステップで収束
    expect(res.trace.steps.length).toBe(3);
    const regsN1 =
      res.trace.steps
        .filter((s) => s.nodeId === "n1")
        .pop()
        ?.state.sections.find((s) => s.id === "regs")?.data ?? {};
    expect(regsN1.a.label).toBe("High");
    expect(regsN1.b.label).toBe("High");
  });

  it("trace includes specWindowRemaining metadata", async () => {
    const graph = buildVCFG("beqz x, L\nskip\nL: skip\n");
    const res = await analyzeVCFG(graph, { specWindow: 3 });
    const anySpec = res.trace.steps.find(
      (s) => s.executionMode === "Speculative",
    );
    expect(anySpec?.specWindowRemaining).toBeDefined();
  });

  it("log stack pushes nested spec-begin contexts", async () => {
    // n0 -> sb1(spec-begin c1) -> sb2(spec-begin c2)
    const graph: StaticGraph = {
      nodes: [
        node("n0", 0, "ns", "beqz x, L"),
        specBegin("sb1", -1, "c1"),
        specBegin("sb2", -2, "c2"),
      ],
      edges: [edge("n0", "sb1", "spec"), edge("sb1", "sb2", "spec")],
    };
    const res = await analyzeVCFG(graph, { specWindow: 3 });
    const sb2Step = res.trace.steps.find((s) => s.nodeId === "sb2");
    const specStackSection = sb2Step?.state.sections.find(
      (s) => s.id === "specStack",
    );
    const stackSb2: Record<string, DisplayValue> = specStackSection?.data ?? {};
    expect(Object.keys(stackSb2)).toHaveLength(2);
    const labels = Object.values(stackSb2).map((v) => v.label);
    const joined = labels.join("|");
    // originLabel が優先されるため ID そのものではなくラベルに含まれていることを確認
    expect(joined).toMatch(/beqz x, L/);
    expect(joined).toContain("c2");
  });

  it("prunes speculative path when specWindow is exhausted across ns edges", async () => {
    // light モードでは spec-begin 以降の投機パスが ns エッジで張られるため、
    // 命令ステップ単位での減算が効いているかを検証する。
    const graph: StaticGraph = {
      nodes: [
        node("n0", 0, "ns", "beqz x, L"),
        specBegin("sb", -1, "ctx"),
        {
          ...node("s1", 1, "spec", "load r secret"),
          specContext: { id: "ctx", phase: "begin" },
        },
        node("s2", 2, "spec", "load r secret"),
      ],
      edges: [
        edge("n0", "sb", "spec"),
        edge("sb", "s1", "ns"), // 投機モードのまま ns エッジを進む
        edge("s1", "s2", "ns"),
      ],
    };
    const res = await analyzeVCFG(graph, {
      specWindow: 2,
      policy: { mem: { secret: "High" }, regs: { secret: "High", r: "Low" } },
    });
    const visited = res.trace.steps.map((s) => s.nodeId);
    expect(visited).toContain("s1");
    expect(visited).not.toContain("s2"); // w が 0 でプルーニング
  });
});
