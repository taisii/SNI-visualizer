import { describe, it, expect } from "vitest";
import { parse, ParseError, tryResolveJump } from "..";

describe("API surface/type shape", () => {
  it("parse signature returns Program", () => {
    expect(typeof parse).toBe("function");
    const program = parse("skip");
    expect(Array.isArray(program.instructions)).toBe(true);
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

  it("treats % as a comment delimiter", () => {
    const program = parse(`
load x,0 % inline comment
% full line comment
x<-v<y % cmp
    `);
    expect(program.instructions).toHaveLength(2);
    const assign = program.instructions[1]?.instr;
    if (!assign || assign.op !== "assign") throw new Error("expected assign");
    expect(assign.expr).toMatchObject({
      kind: "binop",
      op: "<",
    });
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

  it("parses cmov keyword form with comparison operators", () => {
    const program = parse("cmov v>=y,u<-0");
    const instr = program.instructions[0]?.instr;
    if (!instr || instr.op !== "cmov") throw new Error("expected cmov");
    expect(instr.dest).toBe("u");
    expect(instr.cond).toEqual({
      kind: "binop",
      op: ">=",
      left: { kind: "reg", name: "v" },
      right: { kind: "reg", name: "y" },
    });
    expect(instr.value).toEqual({ kind: "int", value: 0 });
  });

  it("parses inequality operator !=", () => {
    const program = parse("x <- a != b");
    const instr = program.instructions[0]?.instr;
    if (!instr || instr.op !== "assign") throw new Error("expected assign");
    expect(instr.expr).toEqual({
      kind: "binop",
      op: "!=",
      left: { kind: "reg", name: "a" },
      right: { kind: "reg", name: "b" },
    });
  });

  it("allows numeric register names in load/store", () => {
    const program = parse("load 1,x");
    const instr = program.instructions[0]?.instr;
    if (!instr || instr.op !== "load") throw new Error("expected load");
    expect(instr.dest).toBe("1");
    expect(instr.addr).toEqual({ kind: "reg", name: "x" });
  });

  it("parses bnez and resolves its label", () => {
    const program = parse(`
bnez flag, Exit
Exit: skip
    `);
    const instr = program.instructions[0]?.instr;
    if (!instr || instr.op !== "bnez") throw new Error("expected bnez");
    expect(instr.targetPc).toBe(1);
    expect(instr.cond).toBe("flag");
  });

  it("supports hex literals and division with stray backslashes", () => {
    const program = parse("load x,(v/\\1)\nx<-0xfffffff");
    const loadInstr = program.instructions[0]?.instr;
    if (!loadInstr || loadInstr.op !== "load") throw new Error("expected load");
    expect(loadInstr.addr).toEqual({
      kind: "binop",
      op: "/",
      left: { kind: "reg", name: "v" },
      right: { kind: "int", value: 1 },
    });
    const assign = program.instructions[1]?.instr;
    if (!assign || assign.op !== "assign") throw new Error("expected assign");
    expect(assign.expr).toEqual({ kind: "int", value: 0xfffffff });
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

  it("inserts a terminal skip if the program ends with a label", () => {
    const program = parse(`
start:
  load r1, x
end:
    `);
    // start: load ... -> pc=0
    // end: -> pc=1 (skip inserted)
    expect(program.instructions).toHaveLength(2);
    expect(program.labels.get("end")).toBe(1);
    const last = program.instructions[1]?.instr;
    expect(last?.op).toBe("skip");
  });
});
