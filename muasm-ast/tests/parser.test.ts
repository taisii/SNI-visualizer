import { describe, it, expect, expectTypeOf } from "vitest";
import { parse, ParseError, tryResolveJump, type Program } from "..";

describe("API surface/type shape", () => {
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
    const program = parse(
      "load r1, base // comment\n// full line comment\nskip",
    );
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
      op: "&",
      left: {
        kind: "binop",
        op: "+",
        left: { kind: "int", value: 1 },
        right: {
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
      },
      right: { kind: "int", value: 5 },
    });
  });

  it("tryResolveJump handles ints, labels, and unresolved regs", () => {
    const labels = new Map([["lbl", 5]]);
    expect(tryResolveJump({ kind: "int", value: -3 }, labels)).toBe(-3);
    expect(tryResolveJump({ kind: "reg", name: "lbl" }, labels)).toBe(5);
    expect(
      tryResolveJump({ kind: "reg", name: "missing" }, labels),
    ).toBeUndefined();
  });
});
