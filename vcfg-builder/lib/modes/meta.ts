import type { ProgramContext } from "../program-context";
import { ParseError } from "@/muasm-ast";
import type { GraphBuilder } from "../graph-builder";

export function buildMeta(
  ctx: ProgramContext,
  graph: GraphBuilder,
  windowSize: number,
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
    specPhase?: "begin" | "end",
    specContextId?: string,
  ): string => {
    graph.addNode({
      id,
      pc: nextVirtualPc(),
      label,
      instruction: "skip",
      instructionAst: { op: "skip", text: "skip" },
      type: "spec",
      specContext:
        specPhase && specContextId
          ? { id: specContextId, phase: specPhase }
          : undefined,
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
      const takenTarget = resolveLabel(inst.target);
      const fallthroughIndex = idx + 1;
      if (hasPc(takenTarget)) {
        graph.addEdge({
          source: currentNodeId,
          target: `n${takenTarget}`,
          type: "ns",
          label: "taken",
        });
      }
      if (fallthroughIndex < program.instructions.length) {
        graph.addEdge({
          source: currentNodeId,
          target: `n${fallthroughIndex}`,
          type: "ns",
          label: "not-taken",
        });
      }

      const condLabelTaken =
        inst.op === "beqz" ? `${inst.cond} == 0` : `${inst.cond} != 0`;
      const condLabelNotTaken =
        inst.op === "beqz" ? `${inst.cond} != 0` : `${inst.cond} == 0`;

      traceSpeculativeMeta(
        fallthroughIndex,
        takenTarget,
        windowSize,
        currentNodeId,
        `spec: ${condLabelNotTaken}`,
        addMetaNode,
      );
      traceSpeculativeMeta(
        takenTarget,
        fallthroughIndex,
        windowSize,
        currentNodeId,
        `spec: ${condLabelTaken}`,
        addMetaNode,
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

  function traceSpeculativeMeta(
    currentIndex: number,
    rollbackIndex: number,
    budget: number,
    branchNodeId: string,
    label: string,
    addMeta: (
      id: string,
      label: string,
      phase?: "begin" | "end",
      contextId?: string,
    ) => string,
  ) {
    if (budget <= 0 || !hasPc(currentIndex)) {
      // Skip empty speculative paths (spec-begin would immediately hit spec-end)
      return;
    }

    const contextId = nextSpecContextId();

    const beginId = addMeta(
      `${branchNodeId}:${label}:begin`,
      `spec-begin ${label}`,
      "begin",
      contextId,
    );
    graph.addEdge({
      source: branchNodeId,
      target: beginId,
      type: "spec",
      label,
    });

    walkSpec(
      currentIndex,
      rollbackIndex,
      budget,
      beginId,
      label,
      addMeta,
      contextId,
    );
  }

  function walkSpec(
    currentIndex: number,
    rollbackIndex: number,
    budget: number,
    prevNodeId: string,
    label: string,
    addMeta: (
      id: string,
      label: string,
      phase?: "begin" | "end",
      contextId?: string,
    ) => string,
    contextId: string,
  ) {
    if (budget <= 0) {
      if (hasPc(rollbackIndex)) {
        const endId = addMeta(
          `${prevNodeId}:${label}:end@${budget}`,
          `spec-end ${label}`,
          "end",
          contextId,
        );
        graph.addEdge({ source: prevNodeId, target: endId, type: "spec" });
        if (speculationMode !== "discard") {
          graph.addEdge({
            source: endId,
            target: `n${rollbackIndex}`,
            type: "rollback",
          });
        }
      }
      return;
    }

    const currentItem = program.instructions[currentIndex];
    if (!currentItem) {
      if (hasPc(rollbackIndex)) {
        const endId = addMeta(
          `${prevNodeId}:${label}:end@EOF`,
          `spec-end ${label}`,
          "end",
          contextId,
        );
        graph.addEdge({ source: prevNodeId, target: endId, type: "spec" });
        if (speculationMode !== "discard") {
          graph.addEdge({
            source: endId,
            target: `n${rollbackIndex}`,
            type: "rollback",
          });
        }
      }
      return;
    }

    const instrNodeId = `n${currentItem.pc}`;
    graph.addEdge({ source: prevNodeId, target: instrNodeId, type: "spec" });

    const nextBudget = budget - 1;
    const inst = currentItem.instr;

    if (nextBudget <= 0 || inst.op === "spbarr") {
      if (hasPc(rollbackIndex)) {
        const endId = addMeta(
          `${instrNodeId}:${label}:end@${nextBudget}`,
          `spec-end ${label}`,
          "end",
          contextId,
        );
        graph.addEdge({ source: instrNodeId, target: endId, type: "spec" });
        if (speculationMode !== "discard") {
          graph.addEdge({
            source: endId,
            target: `n${rollbackIndex}`,
            type: "rollback",
          });
        }
      }
      return;
    }

    if (inst.op === "beqz" || inst.op === "bnez") {
      const takenTarget = resolveLabel(inst.target);
      walkSpec(
        takenTarget,
        rollbackIndex,
        nextBudget,
        instrNodeId,
        label,
        addMeta,
        contextId,
      );
      walkSpec(
        currentIndex + 1,
        rollbackIndex,
        nextBudget,
        instrNodeId,
        label,
        addMeta,
        contextId,
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
      walkSpec(
        res.pc,
        rollbackIndex,
        nextBudget,
        instrNodeId,
        label,
        addMeta,
        contextId,
      );
      return;
    }

    walkSpec(
      currentIndex + 1,
      rollbackIndex,
      nextBudget,
      instrNodeId,
      label,
      addMeta,
      contextId,
    );
  }
}
