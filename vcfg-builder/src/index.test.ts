import { describe, it, expect, expectTypeOf } from "vitest";
import { buildVCFG, parse, ParseError, type Program } from "./index";
import { tryResolveJump } from "./parser";
import type { StaticGraph } from "../../app/types/analysis-result";

describe("API surface/type shape", () => {
  it("buildVCFG signature aligns with StaticGraph output", () => {
    expectTypeOf(buildVCFG).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(buildVCFG).parameter(1).toEqualTypeOf<number | undefined>();
    expectTypeOf(buildVCFG).returns.toMatchTypeOf<StaticGraph>();
  });

  it("parse signature returns Program", () => {
    expectTypeOf(parse).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(parse).returns.toMatchTypeOf<Program>();
  });
});

describe("parser", () => {
  it("parses all instruction kinds and resolves labels", () => {
    const code = `
start: skip
x <- 1
load r1, base
store r1, base + 8
beqz r1, end
jmp r1 + 1
spbarr
x <- r1 ? r2
end: skip
    `;

    const program = parse(code);
    expect(program.instructions).toHaveLength(9);
    expect(program.labels.get("start")).toBe(0);
    expect(program.labels.get("end")).toBe(8);

    const beqzInstr = program.instructions[4]?.instr;
    if (!beqzInstr || beqzInstr.op !== "beqz") {
      throw new Error("beqz not parsed");
    }
    expect(beqzInstr.cond).toBe("r1");
    expect(beqzInstr.target).toBe("end");
    expect(beqzInstr.targetPc).toBe(8);
  });

  it("supports forward label references", () => {
    const program = parse(`
beqz x, later
later: skip
    `);

    const beqz = program.instructions[0]?.instr;
    if (!beqz || beqz.op !== "beqz") throw new Error("expected beqz");
    expect(beqz.targetPc).toBe(1);
    expect(program.labels.get("later")).toBe(1);
  });

  it("ignores line-end comments", () => {
    const program = parse("load r1, base // comment\n// full line comment\nskip");
    expect(program.instructions).toHaveLength(2);
    expect(program.instructions[0]?.instr.op).toBe("load");
    expect(program.instructions[1]?.instr.op).toBe("skip");
  });

  it("accepts label-only lines and ties label to the next instruction", () => {
    const program = parse(`
Loop:
  load z, a
  load a, c
  beqz y, Loop
    `);

    expect(program.labels.get("Loop")).toBe(0);
    expect(program.instructions).toHaveLength(3);
    const beqz = program.instructions[2]?.instr;
    if (!beqz || beqz.op !== "beqz") throw new Error("expected beqz");
    expect(beqz.targetPc).toBe(0);
  });

  it("throws ParseError on invalid token", () => {
    expect(() => parse("foo @ 1")).toThrow(ParseError);
  });

  it("throws on duplicate label with source line detail", () => {
    try {
      parse("L: skip\nL: skip");
      throw new Error("expected ParseError");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const detail = (err as ParseError).detail as { sourceLine?: number };
      expect(detail?.sourceLine).toBe(2);
    }
  });

  it("throws when beqz target label is missing and reports source line", () => {
    try {
      parse("beqz x, missing");
      throw new Error("expected ParseError");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      const detail = (err as ParseError).detail as { sourceLine?: number };
      expect(detail?.sourceLine).toBe(1);
    }
  });

  it("parses cmov instruction with reg operands", () => {
    const program = parse("x <- r1 ? r2");

    const instr = program.instructions[0]?.instr;
    if (!instr || instr.op !== "cmov") throw new Error("expected cmov");

    expect(instr.dest).toBe("x");
    expect(instr.cond).toEqual({ kind: "reg", name: "r1" });
    expect(instr.value).toEqual({ kind: "reg", name: "r2" });
  });

  it("respects operator precedence and associativity", () => {
    const program = parse("x <- 1 + 2 * (3 - 4) & 5");

    const instr = program.instructions[0]?.instr;
    if (!instr || instr.op !== "assign") throw new Error("expected assign");

    expect(instr.expr).toEqual({
      kind: "binop",
      op: "+",
      left: { kind: "int", value: 1 },
      right: {
        kind: "binop",
        op: "&",
        left: {
          kind: "binop",
          op: "*",
          left: { kind: "int", value: 2 },
          right: {
            kind: "binop",
            op: "-",
            left: { kind: "int", value: 3 },
            right: { kind: "int", value: 4 },
          },
        },
        right: { kind: "int", value: 5 },
      },
    });
  });

  it("tryResolveJump handles ints, labels, and unresolved regs", () => {
    const labels = new Map([["lbl", 5]]);
    expect(tryResolveJump({ kind: "int", value: -3 }, labels)).toBe(-3);
    expect(tryResolveJump({ kind: "reg", name: "lbl" }, labels)).toBe(5);
    expect(tryResolveJump({ kind: "reg", name: "missing" }, labels)).toBeUndefined();
  });
});

describe("buildVCFG", () => {
  it("linear program yields only ns edges", () => {
    const graph = buildVCFG("skip\nskip", 2);
    expect(graph.nodes.filter(n => n.type === "spec")).toHaveLength(0);
    expect(graph.edges).toEqual([{ source: "n0", target: "n1", type: "ns" }]);
  });

  it("branch expands mispredict speculative paths", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      2,
    );

    const nsEdges = graph.edges.filter(e => e.type === "ns");
    expect(nsEdges).toHaveLength(3);

    const specEdges = graph.edges.filter(e => e.type === "spec");
    const rollbackEdges = graph.edges.filter(e => e.type === "rollback");

    expect(specEdges).toHaveLength(3);
    expect(rollbackEdges).toHaveLength(2);
    expect(graph.nodes.filter(n => n.type === "spec")).toHaveLength(3);
  });

  it("loop preserves back edge without duplication", () => {
    const graph = buildVCFG(
      `
start: beqz x, start
skip
`,
      2,
    );

    const nsEdgeSet = new Set(graph.edges.filter(e => e.type === "ns").map(e => `${e.source}->${e.target}`));
    expect(nsEdgeSet.has("n0->n0")).toBe(true);
    expect(nsEdgeSet.has("n0->n1")).toBe(true);
    expect(nsEdgeSet.size).toBe(graph.edges.filter(e => e.type === "ns").length);
  });

  it("nested speculation keeps context id stable", () => {
    const graph = buildVCFG(
      `
beqz x, L1
beqz y, L2
L1: skip
L2: skip
`,
      3,
    );

    expect(graph.nodes.some(n => n.id === "n1@spec0")).toBe(true);
    expect(graph.nodes.some(n => n.id === "n2@spec0")).toBe(true);
  });

  it("spbarr stops speculation and emits rollback", () => {
    const graph = buildVCFG(
      `
beqz x, L
spbarr
L: skip
`,
      3,
    );

    const rollbackTargets = graph.edges.filter(e => e.type === "rollback").map(e => e.target);
    expect(rollbackTargets).toContain("n2");
  });

  it("rejects non-positive window size", () => {
    expect(() => buildVCFG("skip", 0)).toThrow("windowSize");
  });

  it("throws when jmp target cannot be resolved", () => {
    expect(() => buildVCFG("jmp target", 2)).toThrow(ParseError);
  });

  it("windowSize=1 triggers immediate rollback on both mispredict paths", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      1,
    );
    const specIds = graph.nodes.filter(n => n.type === "spec").map(n => n.id).sort();
    expect(specIds).toEqual(["n1@spec0", "n2@spec1"]);
    const rollbackEdges = graph.edges.filter(e => e.type === "rollback");
    expect(rollbackEdges).toHaveLength(2);
    expect(new Set(rollbackEdges.map(e => e.target))).toEqual(new Set(["n1", "n2"]));
  });

  it("does not emit rollback to non-existent fallthrough after terminal branch", () => {
    const graph = buildVCFG(
      `
Loop:
  load z, a
  load a, c
  beqz y, Loop
`,
      2,
    );

    // 3 つの通常ノードのみ
    expect(graph.nodes.filter(n => n.type === "ns").map(n => n.id)).toEqual(["n0", "n1", "n2"]);

    // rollback の target に n3 が含まれないこと
    const rollbackTargets = new Set(graph.edges.filter(e => e.type === "rollback").map(e => e.target));
    expect(rollbackTargets.has("n3")).toBe(false);

    // 投機開始 PC が存在しない場合、NS→NS の rollback を出さない
    const rollbackEdges = graph.edges.filter(e => e.type === "rollback");
    expect(rollbackEdges).toHaveLength(0);
  });

  it("spec nodes remain unique per speculation context", () => {
    const graph = buildVCFG(
      `
beqz x, L
skip
L: skip
`,
      2,
    );
    const specIds = graph.nodes.filter(n => n.type === "spec").map(n => n.id);
    expect(new Set(specIds).size).toBe(specIds.length);
    expect(specIds.some(id => id.endsWith("@spec0"))).toBe(true);
    expect(specIds.some(id => id.endsWith("@spec1"))).toBe(true);
  });

  it("rollback edges originate only from speculative nodes", () => {
    const graph = buildVCFG(
      `
beqz x, L
spbarr
L: skip
`,
      3,
    );

    const nodeType = new Map(graph.nodes.map(n => [n.id, n.type]));
    const rollbackEdges = graph.edges.filter(e => e.type === "rollback");

    expect(rollbackEdges.length).toBeGreaterThan(0);
    for (const edge of rollbackEdges) {
      expect(nodeType.get(edge.source)).toBe("spec");
    }
  });
});
