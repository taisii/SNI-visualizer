import type { StaticGraph } from "@/lib/analysis-schema";
import type { Program } from "@/muasm-ast";
import { parse } from "@/muasm-ast";
import type { BuildOptions } from "../types";
import { normalizeOptions } from "./options";
import { createProgramContext } from "./program-context";
import { GraphBuilder } from "./graph-builder";
import { buildMeta } from "./modes/meta";
import { buildLight } from "./modes/light";

export type { BuildOptions } from "../types";
export type { BuildMode } from "../types";

export function buildVCFG(
  sourceCode: string,
  options: BuildOptions = 20,
): StaticGraph {
  const program = parse(sourceCode);
  return buildVCFGFromProgram(program, options);
}

export function buildVCFGFromProgram(
  program: Program,
  options: BuildOptions = 20,
): StaticGraph {
  const { windowSize, speculationMode, mode } = normalizeOptions(options);
  const ctx = createProgramContext(program);
  const graph = new GraphBuilder();

  emitBaseNodes(ctx, graph);

  if (mode === "light") {
    buildLight(ctx, graph, speculationMode);
  } else {
    buildMeta(ctx, graph, windowSize ?? 20, speculationMode);
  }

  return graph.toGraph();
}

function emitBaseNodes(
  ctx: ReturnType<typeof createProgramContext>,
  graph: GraphBuilder,
) {
  for (const item of ctx.program.instructions) {
    graph.addNode({
      id: `n${item.pc}`,
      pc: item.pc,
      label: `${item.pc}: ${item.instr.text}`,
      instruction: item.instr.text,
      instructionAst: item.instr,
      type: "ns",
      sourceLine: item.sourceLine,
    });
  }
}
