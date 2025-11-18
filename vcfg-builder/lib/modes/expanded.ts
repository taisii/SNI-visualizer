import type { ProgramContext } from "../program-context";
import { ParseError } from "@/muasm-ast";
import type { GraphBuilder } from "../graph-builder";

export function buildExpanded(
  ctx: ProgramContext,
  graph: GraphBuilder,
  windowSize: number,
  createSpecContextId: () => string,
) {
  const { program, resolveJump, resolveLabel, hasPc } = ctx;

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

    if (inst.op === "beqz") {
      const takenTarget = resolveLabel(inst.target);
      graph.addEdge({
        source: currentNodeId,
        target: `n${takenTarget}`,
        type: "ns",
        label: "taken",
      });
      if (idx + 1 < program.instructions.length) {
        graph.addEdge({
          source: currentNodeId,
          target: `n${idx + 1}`,
          type: "ns",
          label: "not-taken",
        });
      }

      traceSpeculativeExpanded(
        idx + 1,
        takenTarget,
        windowSize,
        currentNodeId,
        createSpecContextId(),
      );
      traceSpeculativeExpanded(
        takenTarget,
        idx + 1,
        windowSize,
        currentNodeId,
        createSpecContextId(),
      );
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

  function traceSpeculativeExpanded(
    currentIndex: number,
    rollbackIndex: number,
    budget: number,
    fromNodeId: string,
    specContextId: string,
  ) {
    const isSpecSource = fromNodeId.includes("@");

    if (budget <= 0) {
      if (isSpecSource && hasPc(rollbackIndex)) {
        graph.addEdge({
          source: fromNodeId,
          target: `n${rollbackIndex}`,
          type: "rollback",
        });
      }
      return;
    }

    const currentItem = program.instructions[currentIndex];
    if (!currentItem) {
      if (isSpecSource && hasPc(rollbackIndex)) {
        graph.addEdge({
          source: fromNodeId,
          target: `n${rollbackIndex}`,
          type: "rollback",
        });
      }
      return;
    }

    const targetNodeId = `n${currentItem.pc}@${specContextId}`;

    graph.addNode({
      id: targetNodeId,
      pc: currentItem.pc,
      label: `${currentItem.pc}: ${currentItem.instr.text}`,
      instruction: currentItem.instr.text,
      instructionAst: currentItem.instr,
      type: "spec",
      sourceLine: currentItem.sourceLine,
      specOrigin: fromNodeId,
    });

    graph.addEdge({ source: fromNodeId, target: targetNodeId, type: "spec" });

    const nextBudget = budget - 1;
    if (nextBudget <= 0 || currentItem.instr.op === "spbarr") {
      if (hasPc(rollbackIndex)) {
        graph.addEdge({
          source: targetNodeId,
          target: `n${rollbackIndex}`,
          type: "rollback",
        });
      }
      return;
    }

    const inst = currentItem.instr;
    if (inst.op === "beqz") {
      const takenTarget = resolveLabel(inst.target);
      traceSpeculativeExpanded(
        takenTarget,
        rollbackIndex,
        nextBudget,
        targetNodeId,
        specContextId,
      );
      traceSpeculativeExpanded(
        currentIndex + 1,
        rollbackIndex,
        nextBudget,
        targetNodeId,
        specContextId,
      );
      return;
    }

    if (inst.op === "jmp") {
      const res = resolveJump(inst.target);
      if (res.kind !== "pc") {
        throw new ParseError("jmp ターゲットを静的に解決できません", {
          target: inst.target,
        });
      }
      traceSpeculativeExpanded(
        res.pc,
        rollbackIndex,
        nextBudget,
        targetNodeId,
        specContextId,
      );
      return;
    }

    traceSpeculativeExpanded(
      currentIndex + 1,
      rollbackIndex,
      nextBudget,
      targetNodeId,
      specContextId,
    );
  }
}
