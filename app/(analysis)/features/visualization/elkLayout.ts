import type { StaticGraph } from "@/lib/analysis-schema";
import type { ElkExtendedEdge, ElkNode, ElkPort } from "elkjs";

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 60;

export const elkLayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.insideSelfLoops.activate": "true",
  "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.nodePlacement.favorStraightEdges": "true",
  "elk.layered.spacing.edgeNodeBetweenLayers": "25",
  "elk.layered.mergeEdges": "true",
  "elk.spacing.nodeNode": "50",
  // 複数コンポーネントを同じ文脈で積む
  separateConnectedComponents: "false",
  // デフォルトでもポート制約を有効化
  "org.eclipse.elk.portConstraints": "FIXED_SIDE",
  // crossing minimization でノード順再編を禁止
  "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
  // ns ノードの入力順（pc順）を厳密に尊重
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  // cycle breaking でもモデル順を崩さない
  "elk.layered.considerModelOrder.components": "MODEL_ORDER",
} as const;

export function buildElkGraph(graph: StaticGraph) {
  const orderedNodes = orderNodes(graph);
  const elkNodes: ElkNode[] = orderedNodes.map((n) => ({
    id: n.id,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    labels: [{ text: n.label }],
    layoutOptions: {
      "org.eclipse.elk.portConstraints": "FIXED_SIDE",
    },
    ports: buildPorts(n),
  }));

  const elkEdges: ElkExtendedEdge[] = graph.edges.map((edge, index) => ({
    id: createEdgeId(edge, index),
    sources: [portId(edge.source, "out")],
    targets: [portId(edge.target, "in")],
    layoutOptions: {
      "org.eclipse.elk.priority": edge.type === "ns" ? "10" : "1",
    },
  }));

  return {
    id: "root",
    layoutOptions: elkLayoutOptions,
    children: elkNodes,
    edges: elkEdges,
  } as const;
}

export function createEdgeId(
  edge: StaticGraph["edges"][number],
  index: number,
) {
  return `${edge.source}-${edge.target}-${index}`;
}

function buildPorts(node: StaticGraph["nodes"][number]): ElkPort[] {
  return [
    {
      id: portId(node.id, "in"),
      layoutOptions: {
        "org.eclipse.elk.port.side": "NORTH",
      },
    },
    {
      id: portId(node.id, "out"),
      layoutOptions: {
        "org.eclipse.elk.port.side": "SOUTH",
      },
    },
  ];
}

function portId(nodeId: string, type: "in" | "out") {
  return `${nodeId}:${type}`;
}

function orderNodes(graph: StaticGraph) {
  const nsNodes = graph.nodes
    .filter((node) => node.type === "ns")
    .sort((a, b) => a.pc - b.pc);

  const specChildren = new Map<string, StaticGraph["nodes"][number][]>();
  for (const node of graph.nodes) {
    if (node.type !== "spec" || !node.specOrigin) continue;
    const siblings = specChildren.get(node.specOrigin) ?? [];
    siblings.push(node);
    specChildren.set(node.specOrigin, siblings);
  }

  const ordered: StaticGraph["nodes"][number][] = [];
  const visited = new Set<string>();

  const visit = (node: StaticGraph["nodes"][number]) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    ordered.push(node);
    const children = specChildren.get(node.id);
    if (!children) return;
    children.sort((a, b) => {
      if (a.pc !== b.pc) return a.pc - b.pc;
      return a.id.localeCompare(b.id);
    });
    for (const child of children) {
      visit(child);
    }
  };

  for (const nsNode of nsNodes) {
    visit(nsNode);
  }

  for (const node of graph.nodes) {
    if (visited.has(node.id)) continue;
    visit(node);
  }

  return ordered;
}
