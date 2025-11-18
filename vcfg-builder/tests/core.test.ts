import { describe, it, expect, expectTypeOf } from "vitest";
import { buildVCFG, buildVCFGFromProgram } from "..";
import { ParseError, parse } from "@/muasm-ast";
import type { StaticGraph } from "@/lib/analysis-schema";

describe("buildVCFG core/API", () => {
  it("buildVCFG signature aligns with StaticGraph output", () => {
    expectTypeOf(buildVCFG).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(buildVCFG)
      .parameter(1)
      .toEqualTypeOf<number | import("..").BuildOptions | undefined>();
    expectTypeOf(buildVCFG).returns.toMatchTypeOf<StaticGraph>();
  });

  it("linear program yields only ns edges", () => {
    const graph = buildVCFG("skip\nskip", 2);
    expect(graph.nodes.filter((n) => n.type === "spec")).toHaveLength(0);
    expect(graph.edges).toEqual([{ source: "n0", target: "n1", type: "ns" }]);
  });

  it("buildVCFGFromProgram accepts already-parsed Program", () => {
    const program = parse("skip\nskip");
    const graph = buildVCFGFromProgram(program, 2);
    expect(graph.edges).toEqual([{ source: "n0", target: "n1", type: "ns" }]);
  });

  it("rejects non-positive window size", () => {
    expect(() => buildVCFG("skip", 0)).toThrow("windowSize");
  });

  it("throws when jmp target cannot be resolved", () => {
    expect(() => buildVCFG("jmp target", 2)).toThrow(ParseError);
  });
});
