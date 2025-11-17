import type { StaticGraph } from "../../app/types/analysis-result";
import { parse, ParseError, tryResolveJump } from "./parser";
import type { Expr, Identifier } from "./types";

export function buildVCFG(sourceCode: string, windowSize = 20): StaticGraph {
  if (windowSize <= 0) {
    throw new Error("windowSize は 1 以上である必要があります");
  }

  const program = parse(sourceCode);
  const nodes: StaticGraph["nodes"] = [];
  const edges: StaticGraph["edges"] = [];

  const nodeSet = new Set<string>();
  const edgeSet = new Set<string>();

  const addNode = (node: StaticGraph["nodes"][number]) => {
    if (nodeSet.has(node.id)) return;
    nodeSet.add(node.id);
    nodes.push(node);
  };

  const addEdge = (edge: StaticGraph["edges"][number]) => {
    const key = `${edge.source}->${edge.target}:${edge.type}:${edge.label ?? ""}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push(edge);
  };

  const resolveLabel = (label: Identifier) => {
    const target = program.labels.get(label);
    if (target === undefined) {
      throw new ParseError(`ラベル '${label}' を解決できませんでした`);
    }
    return target;
  };

  const resolveJumpTarget = (expr: Expr): number => {
    const resolved = tryResolveJump(expr, program.labels);
    if (resolved === undefined) {
      throw new ParseError("jmp ターゲットを解決できません", { expr });
    }
    return resolved;
  };

  let specCounter = 0;
  const createSpecContextId = () => {
    const id = `spec${specCounter}`;
    specCounter += 1;
    return id;
  };

  // NS ノード生成
  for (const item of program.instructions) {
    addNode({
      id: `n${item.pc}`,
      pc: item.pc,
      label: `${item.pc}: ${item.instr.text}`,
      instruction: item.instr.text,
      type: "ns",
      sourceLine: item.sourceLine,
    });
  }

  // NS エッジ構築と投機開始点
  for (let idx = 0; idx < program.instructions.length; idx += 1) {
    const item = program.instructions[idx];
    const currentNodeId = `n${item.pc}`;
    const inst = item.instr;

    if (inst.op === "jmp") {
      const targetIndex = resolveJumpTarget(inst.target);
      addEdge({ source: currentNodeId, target: `n${targetIndex}`, type: "ns" });
      continue;
    }

    if (inst.op === "beqz") {
      const takenTarget = resolveLabel(inst.target);
      addEdge({
        source: currentNodeId,
        target: `n${takenTarget}`,
        type: "ns",
        label: "taken",
      });
      if (idx + 1 < program.instructions.length) {
        addEdge({
          source: currentNodeId,
          target: `n${idx + 1}`,
          type: "ns",
          label: "not-taken",
        });
      }

      // Always-mispredict: 2 系統をそれぞれ別 spec コンテキストで展開
      traceSpeculative(idx + 1, takenTarget, windowSize, currentNodeId, createSpecContextId());
      traceSpeculative(takenTarget, idx + 1, windowSize, currentNodeId, createSpecContextId());
      continue;
    }

    // 通常の fallthrough
    if (idx + 1 < program.instructions.length) {
      addEdge({
        source: currentNodeId,
        target: `n${idx + 1}`,
        type: "ns",
      });
    }
  }

  // 投機パスの再帰展開
  function traceSpeculative(
    currentIndex: number,
    rollbackIndex: number,
    budget: number,
    fromNodeId: string,
    specContextId: string,
  ) {
    if (budget <= 0) {
      addEdge({ source: fromNodeId, target: `n${rollbackIndex}`, type: "rollback" });
      return;
    }

    const currentItem = program.instructions[currentIndex];
    if (!currentItem) {
      addEdge({ source: fromNodeId, target: `n${rollbackIndex}`, type: "rollback" });
      return;
    }

    const targetNodeId = `n${currentItem.pc}@${specContextId}`;

    addNode({
      id: targetNodeId,
      pc: currentItem.pc,
      label: `${currentItem.pc}: ${currentItem.instr.text}`,
      instruction: currentItem.instr.text,
      type: "spec",
      sourceLine: currentItem.sourceLine,
      specOrigin: fromNodeId,
    });

    addEdge({ source: fromNodeId, target: targetNodeId, type: "spec" });

    const nextBudget = budget - 1;
    if (nextBudget <= 0 || currentItem.instr.op === "spbarr") {
      addEdge({ source: targetNodeId, target: `n${rollbackIndex}`, type: "rollback" });
      return;
    }

    const inst = currentItem.instr;
    if (inst.op === "beqz") {
      const takenTarget = resolveLabel(inst.target);
      traceSpeculative(takenTarget, rollbackIndex, nextBudget, targetNodeId, specContextId);
      traceSpeculative(currentIndex + 1, rollbackIndex, nextBudget, targetNodeId, specContextId);
      return;
    }

    if (inst.op === "jmp") {
      const target = resolveJumpTarget(inst.target);
      traceSpeculative(target, rollbackIndex, nextBudget, targetNodeId, specContextId);
      return;
    }

    traceSpeculative(currentIndex + 1, rollbackIndex, nextBudget, targetNodeId, specContextId);
  }

  return { nodes, edges };
}
