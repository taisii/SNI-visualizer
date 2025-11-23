import type { ProgramContext } from "../program-context";
import { ParseError } from "@/muasm-ast";
import type { GraphBuilder } from "../graph-builder";

/**
 * 投機ウィンドウを展開せず、投機開始/終了メタノードだけを付与する軽量モード。
 * - NS エッジは通常の CFG と同じ形で張る。
 * - 分岐ごとに spec-begin / spec-end を 1 組だけ生成し、投機の開始点をマーキングする。
 * - 投機長の管理は解析エンジン側 (specWindow) に委譲する。
 */
export function buildLight(
  ctx: ProgramContext,
  graph: GraphBuilder,
  speculationMode: "discard" | "stack-guard",
) {
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
      const endId = addMetaNode(
        `${currentNodeId}:spec-end`,
        `spec-end ${condLabelTaken}/${condLabelNotTaken}`,
        "end",
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
      // 明示的に「今すぐロールバックする」経路も 1 本持たせておく
      graph.addEdge({ source: beginId, target: endId, type: "spec" });
      if (speculationMode !== "discard") {
        graph.addEdge({
          source: endId,
          target: currentNodeId,
          type: "rollback",
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
