import type { ProgramContext } from "../program-context";
import { ParseError } from "@/muasm-ast";
import type { GraphBuilder } from "../graph-builder";

/**
 * 投機ウィンドウを展開せず、分岐ごとに 1 つの spec-begin メタノードだけを付与する軽量モード。
 * - NS エッジは通常の CFG と同じ形で張る。
 * - rollback / spec-end ノードは生成しない（Pruning は解析エンジン側の specWindow で制御）。
 */
export function buildLight(ctx: ProgramContext, graph: GraphBuilder) {
  const { program, resolveJump, resolveLabel, hasPc } = ctx;

  let virtualPc = -1;
  const nextVirtualPc = () => {
    const pc = virtualPc;
    virtualPc -= 1;
    return pc;
  };

  let specContextSeq = 0;
  const nextSpecContextId = () => {
    specContextSeq += 1;
    return `specctx${specContextSeq}`;
  };

  const addMetaNode = (
    id: string,
    label: string,
    specPhase: "begin" | "end",
    specContextId: string,
  ): string => {
    graph.addNode({
      id,
      pc: nextVirtualPc(),
      label,
      instruction: "skip",
      instructionAst: { op: "skip", text: "skip" },
      type: "spec",
      specContext: { id: specContextId, phase: specPhase },
    });
    return id;
  };

  for (let idx = 0; idx < program.instructions.length; idx += 1) {
    const item = program.instructions[idx];
    const currentNodeId = `n${item.pc}`;
    const inst = item.instr;

    if (inst.op === "jmp") {
      const res = resolveJump(inst.target);
      if (res.kind !== "pc") {
        throw new ParseError("jmp ターゲットを静的に解決できません", {
          target: inst.target,
        });
      }
      graph.addEdge({
        source: currentNodeId,
        target: `n${res.pc}`,
        type: "ns",
      });
      continue;
    }

    if (inst.op === "beqz" || inst.op === "bnez") {
      const condLabelTaken =
        inst.op === "beqz" ? `${inst.cond} == 0` : `${inst.cond} != 0`;
      const condLabelNotTaken =
        inst.op === "beqz" ? `${inst.cond} != 0` : `${inst.cond} == 0`;

      const takenTarget = resolveLabel(inst.target);
      const fallthroughIndex = idx + 1;

      if (hasPc(takenTarget)) {
        graph.addEdge({
          source: currentNodeId,
          target: `n${takenTarget}`,
          type: "ns",
          label: condLabelTaken,
        });
      }
      if (fallthroughIndex < program.instructions.length) {
        graph.addEdge({
          source: currentNodeId,
          target: `n${fallthroughIndex}`,
          type: "ns",
          label: condLabelNotTaken,
        });
      }

      const specContextId = nextSpecContextId();
      const beginId = addMetaNode(
        `${currentNodeId}:spec-begin`,
        `spec-begin ${condLabelTaken}/${condLabelNotTaken}`,
        "begin",
        specContextId,
      );
      graph.addEdge({
        source: currentNodeId,
        target: beginId,
        type: "spec",
        label: `spec: ${condLabelTaken}/${condLabelNotTaken}`,
      });
      if (fallthroughIndex < program.instructions.length) {
        graph.addEdge({
          source: beginId,
          target: `n${fallthroughIndex}`,
          type: "spec",
          label: condLabelNotTaken,
        });
      }
      if (hasPc(takenTarget)) {
        graph.addEdge({
          source: beginId,
          target: `n${takenTarget}`,
          type: "spec",
          label: condLabelTaken,
        });
      }
      continue;
    }

    if (idx + 1 < program.instructions.length) {
      graph.addEdge({
        source: currentNodeId,
        target: `n${idx + 1}`,
        type: "ns",
      });
    }
  }
}
