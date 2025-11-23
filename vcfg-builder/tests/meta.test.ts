import { describe, it, expect } from "vitest";
import { buildVCFG } from "..";

describe("buildVCFG (meta モードのみ)", () => {
  it("命令ノードを単一化しつつ spec 区間をマークする", () => {
    const graph = buildVCFG(
      `
beqz cond, L1
skip
L1: skip
`,
      { windowSize: 2, speculationMode: "stack-guard" },
    );

    const nsNodes = graph.nodes.filter((n) => n.type === "ns");
    const specNodes = graph.nodes.filter((n) => n.type === "spec");

    expect(nsNodes).toHaveLength(3);
    expect(specNodes.length).toBeGreaterThan(0);

    // spec エッジは NS ノードへ到達し、rollback は NS へ戻る
    expect(
      graph.edges.some((e) => e.type === "spec" && e.target.startsWith("n")),
    ).toBe(true);
    expect(
      graph.edges.some(
        (e) => e.type === "rollback" && e.target.startsWith("n"),
      ),
    ).toBe(true);
  });

  it("spec-begin/end メタノードとラベルを生成し、NS ノードに戻る", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      { windowSize: 2, speculationMode: "stack-guard" },
    );

    const specBegin = graph.nodes.find((n) => n.id.includes(":begin"));
    const specEnd = graph.nodes.find((n) => n.id.includes(":end@"));
    expect(specBegin?.type).toBe("spec");
    expect(specEnd?.type).toBe("spec");

    const specEdgeLabels = new Set(
      graph.edges
        .filter((e) => e.type === "spec" && e.label !== undefined)
        .map((e) => e.label),
    );
    expect(specEdgeLabels).toEqual(new Set(["spec: x != 0", "spec: x == 0"]));

    // rollback は NS ノードへ戻る
    const rollbackTargets = new Set(
      graph.edges.filter((e) => e.type === "rollback").map((e) => e.target),
    );
    expect([...rollbackTargets].every((id) => id.startsWith("n"))).toBe(true);
  });

  it("supports bnez branches with symmetric spec labels", () => {
    const graph = buildVCFG(
      `
bnez flag, Target
skip
Target: skip
`,
      { windowSize: 2 },
    );

    const nsEdges = graph.edges.filter((e) => e.source === "n0");
    expect(nsEdges.some((e) => e.label === "flag != 0")).toBe(true);
    expect(nsEdges.some((e) => e.label === "flag == 0")).toBe(true);

    const specEdgeLabels = new Set(
      graph.edges
        .filter((e) => e.type === "spec" && e.label)
        .map((e) => e.label),
    );
    expect(specEdgeLabels).toEqual(
      new Set(["spec: flag == 0", "spec: flag != 0"]),
    );
  });

  it("meta ノードは仮想 PC (負値) を持ち、NS ノードの PC を汚染しない", () => {
    const graph = buildVCFG(
      `
beqz x, L
spbarr
L: skip
`,
      { windowSize: 3 },
    );

    const nsPcs = graph.nodes
      .filter((n) => n.type === "ns")
      .map((n) => n.pc ?? 0);
    const specPcs = graph.nodes
      .filter((n) => n.type === "spec")
      .map((n) => n.pc ?? 0);

    expect(nsPcs.every((pc) => pc >= 0)).toBe(true);
    expect(specPcs.every((pc) => pc < 0)).toBe(true);
    // NS ノード数は命令数と一致する
    expect(nsPcs.length).toBe(3);
  });

  it("discard モードでは spec-end ノードを生成しない", () => {
    const graph = buildVCFG(
      `
beqz x, L
L: skip
`,
      { windowSize: 2, speculationMode: "discard" },
    );

    const specEnds = graph.nodes.filter(
      (n) => n.type === "spec" && n.label?.startsWith("spec-end"),
    );
    expect(specEnds).toHaveLength(0);
    expect(graph.edges.every((e) => e.type !== "rollback")).toBe(true);
  });

  it("discard モードでもネストした分岐に spec エッジを張るが spec-end/rollback は出さない", () => {
    const graph = buildVCFG(
      `
beqz c1, L1
beqz c2, L2
skip
L1: skip
L2: skip
`,
      { windowSize: 3, speculationMode: "discard" },
    );

    const specEnds = graph.nodes.filter(
      (n) => n.type === "spec" && n.label?.startsWith("spec-end"),
    );
    expect(specEnds).toHaveLength(0);
    expect(graph.edges.every((e) => e.type !== "rollback")).toBe(true);

    // ネストした分岐の NS ノードへ spec エッジが届いていることを確認
    const specEdgeTargets = new Set(
      graph.edges
        .filter((e) => e.type === "spec")
        .map((e) => e.target),
    );
    expect(specEdgeTargets.has("n1")).toBe(true); // 内側分岐
    expect(specEdgeTargets.has("n3") || specEdgeTargets.has("n4")).toBe(true); // taken/untaken のどちらか
  });

  it("discard モードでは spbarr で spec トレースを打ち切り、spec-end/rollback は出さない", () => {
    const graph = buildVCFG(
      `
beqz x, L
spbarr
skip
L: skip
`,
      { windowSize: 3, speculationMode: "discard" },
    );

    const specEnds = graph.nodes.filter(
      (n) => n.type === "spec" && n.label?.startsWith("spec-end"),
    );
    expect(specEnds).toHaveLength(0);
    expect(graph.edges.every((e) => e.type !== "rollback")).toBe(true);

    const specTargets = new Set(
      graph.edges.filter((e) => e.type === "spec").map((e) => e.target),
    );
    expect(specTargets.has("n1")).toBe(true); // spbarr までは到達
    expect(specTargets.has("n2")).toBe(false); // バリア以降へは伸びない
  });

  it("windowSize を 1 にするとメタノード経由で即座に rollback が張られる", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      { windowSize: 1, speculationMode: "stack-guard" },
    );

    const rollbackTargets = new Set(
      graph.edges.filter((e) => e.type === "rollback").map((e) => e.target),
    );
    expect(rollbackTargets).toEqual(new Set(["n1", "n2"]));

    // span が短くても spec-begin/end が生成される
    expect(
      graph.nodes.some((n) => n.type === "spec" && n.id.includes(":begin")),
    ).toBe(true);
    expect(
      graph.nodes.some((n) => n.type === "spec" && n.id.includes(":end@")),
    ).toBe(true);
  });

  it("命令が存在しない分岐方向では spec-begin を生成しない", () => {
    const graph = buildVCFG(
      `
L0: skip
beqz cond, L0
`,
      { windowSize: 2 },
    );

    const specBeginLabels = graph.nodes
      .filter((n) => n.type === "spec" && n.label?.startsWith("spec-begin"))
      .map((n) => n.label ?? "");

    expect(
      specBeginLabels.some((label) => label.includes("spec: cond == 0")),
    ).toBe(true);
    expect(
      specBeginLabels.some((label) => label.includes("spec: cond != 0")),
    ).toBe(false);
  });

  it("spec メタノードに specContext メタデータを付与する", () => {
    const graph = buildVCFG(
      `
beqz x, L1
skip
L1: skip
`,
      { windowSize: 2, speculationMode: "stack-guard" },
    );

    const specNodes = graph.nodes.filter((n) => n.type === "spec");
    expect(specNodes.length).toBeGreaterThan(0);

    const begins = specNodes.filter((n) => n.specContext?.phase === "begin");
    const ends = specNodes.filter((n) => n.specContext?.phase === "end");

    expect(begins.length).toBeGreaterThan(0);
    expect(ends.length).toBeGreaterThan(0);
    for (const begin of begins) {
      expect(begin.specContext?.id).toBeDefined();
    }
    for (const end of ends) {
      const ctxId = end.specContext?.id;
      expect(ctxId).toBeDefined();
      const matchingBegin = begins.find(
        (node) => node.specContext?.id === ctxId,
      );
      expect(matchingBegin).toBeDefined();
    }
  });
});
