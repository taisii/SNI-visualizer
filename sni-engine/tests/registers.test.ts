import { describe, it, expect } from "vitest";
import type { StaticGraph } from "@/lib/analysis-schema";
import { collectRegisterNames } from "../lib/analysis/registers";

describe("collectRegisterNames", () => {
  it("collects registers from instructionAst and ignores ints", () => {
    const graph: StaticGraph = {
      nodes: [
        {
          id: "n0",
          pc: 0,
          type: "ns",
          label: "0: x <- b + 1",
          instructionAst: {
            op: "assign",
            dest: "x",
            expr: {
              kind: "binop",
              op: "+",
              left: { kind: "reg", name: "b" },
              right: { kind: "int", value: 1 },
            },
            text: "x <- b + 1",
          },
        },
      ],
      edges: [],
    };

    const regs = collectRegisterNames(graph);
    expect([...regs].sort()).toEqual(["b", "x"]);
  });

  it("falls back to text tokens only when allowed", () => {
    const graph: StaticGraph = {
      nodes: [
        {
          id: "n0",
          pc: 0,
          type: "ns",
          label: "0: assign x y",
          instruction: "assign x y",
        },
      ],
      edges: [],
    };

    expect([...collectRegisterNames(graph)]).toEqual(["x", "y"]);
    expect([
      ...collectRegisterNames(graph, { allowTextFallback: false }),
    ]).toEqual([]);
  });
});
