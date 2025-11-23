import { describe, expect, it } from "vitest";

import type { StaticGraph } from "@/lib/analysis-schema";
import { analyze } from "@/lib/analysis-engine";
import { __testables } from "./VCFGView";

const { baseNodeStyle, applyActiveStyles } = __testables;
type TestNode = Parameters<typeof applyActiveStyles>[0][number];

function createNode(id: string, nodeType: "ns" | "spec"): TestNode {
  return {
    id,
    data: { label: id, nodeType },
    position: { x: 0, y: 0 },
    style: {},
  } as TestNode;
}

function createVisualizationNodes(graph: StaticGraph): TestNode[] {
  return graph.nodes.map((node, idx) => ({
    id: node.id,
    data: { label: node.label, nodeType: node.type },
    position: { x: node.x ?? 0, y: node.y ?? idx * 120 },
    style: baseNodeStyle(node.type, false),
  })) as TestNode[];
}

const DEFAULT_PROGRAM = `Loop:
  load z, a
  load a, c
  beqz y, Loop`;

describe("VCFGView の色分けロジック", () => {
  it("アクティブでない ns ノードはデフォルトの枠色/背景になる", () => {
    const style = baseNodeStyle("ns", false);
    expect(style.border).toBe("2px solid #2563eb");
    expect(style.background).toBe("#ffffff");
    expect(style.boxShadow).toBe("none");
  });

  it("activeMode が未指定の場合は NS 用のハイライトを使う", () => {
    const nodes = [createNode("n0", "ns"), createNode("n1", "spec")];

    const styled = applyActiveStyles(nodes, "n1");
    const specNode = styled[1];
    if (!specNode || !specNode.style) {
      throw new Error("spec ノードのスタイルが設定されていません");
    }
    expect(specNode.style.border).toBe("2px solid #60a5fa");
    expect(specNode.style.background).toBe("#dbeafe");
    expect(specNode.style.boxShadow).toBe("0 0 0 3px rgba(96,165,250,0.3)");
  });

  it("activeMode=Speculative では投機用の色になる", () => {
    const nodes = [createNode("n0", "ns")];

    const styled = applyActiveStyles(nodes, "n0", "Speculative");
    const nsNode = styled[0];
    if (!nsNode || !nsNode.style) {
      throw new Error("NS ノードのスタイルが設定されていません");
    }
    expect(nsNode.style.border).toBe("2px solid #fbbf24");
    expect(nsNode.style.background).toBe("#fef3c7");
    expect(nsNode.style.boxShadow).toBe("0 0 0 3px rgba(251,191,36,0.3)");
  });

  it("デフォルト VCFG のステップ 1〜3 は NS の色で表示されるべき", async () => {
    const analysis = await analyze(DEFAULT_PROGRAM, {
      traceMode: "single-path",
    });
    const nodes = createVisualizationNodes(analysis.graph);
    const nsHighlight = baseNodeStyle("ns", true, "NS");
    const executionSteps = analysis.trace.steps.filter((step) => step.nodeId);
    const firstThree = executionSteps.slice(0, 3);
    expect(firstThree).toHaveLength(3);

    firstThree.forEach((step, idx) => {
      if (step.executionMode !== "NS") {
        throw new Error(
          `ステップ${idx + 1} (${step.nodeId}) の executionMode=${step.executionMode} で、NS のままではありません`,
        );
      }

      const styled = applyActiveStyles(nodes, step.nodeId, step.executionMode);
      const activeNode = styled.find((node) => node.id === step.nodeId);
      expect(activeNode).toBeDefined();
      expect(activeNode?.style).toMatchObject({
        border: nsHighlight.border,
        background: nsHighlight.background,
        boxShadow: nsHighlight.boxShadow,
      });
    });
  });
});
