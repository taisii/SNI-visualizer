import { describe, it, expect } from "vitest";
import { buildVCFG, buildVCFGFromProgram } from "..";
import { ParseError, parse } from "@/muasm-ast";

describe("buildVCFG core/API", () => {
  it("buildVCFG signature aligns with StaticGraph output", () => {
    expect(typeof buildVCFG).toBe("function");
    expect(typeof buildVCFGFromProgram).toBe("function");
  });

  it("linear program yields only ns edges", () => {
    const graph = buildVCFG("skip\nskip");
    expect(graph.nodes.filter((n) => n.type === "spec")).toHaveLength(0);
    expect(graph.edges).toEqual([{ source: "n0", target: "n1", type: "ns" }]);
  });

  it("buildVCFGFromProgram accepts already-parsed Program", () => {
    const program = parse("skip\nskip");
    const graph = buildVCFGFromProgram(program, {});
    expect(graph.edges).toEqual([{ source: "n0", target: "n1", type: "ns" }]);
  });

  it("throws when jmp target cannot be resolved", () => {
    expect(() => buildVCFG("jmp target", {})).toThrow(ParseError);
  });
});
