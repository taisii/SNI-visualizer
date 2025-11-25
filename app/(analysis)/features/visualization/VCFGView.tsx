/* eslint-disable @next/next/no-img-element */
"use client";

import {
  Background,
  Controls,
  type Edge,
  type FitViewOptions,
  type Node,
  ReactFlow,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkEdgeSection, ElkExtendedEdge } from "elkjs";
import type { StaticGraph, TraceStep } from "@/lib/analysis-schema";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  buildElkGraph,
  createEdgeId,
  elkLayoutOptions,
} from "./elkLayout";
import { ElkEdge, type ElkEdgeData } from "./ElkEdge";

type Props = {
  graph: StaticGraph | null;
  activeNodeId: string | null;
  activeMode?: TraceStep["executionMode"];
  title?: string;
  actionSlot?: ReactNode;
};

const fitViewOptions: FitViewOptions<VisualizationNode> = {
  padding: 0.2,
  includeHiddenNodes: true,
};

const nodeColors = {
  ns: "#2563eb", // blue
  spec: "#f59e0b", // amber
} as const;

const activeColors: Record<
  TraceStep["executionMode"],
  { border: string; bg: string; shadow: string }
> = {
  NS: {
    border: "#60a5fa", // blue-400
    bg: "#dbeafe", // blue-100
    shadow: "rgba(96,165,250,0.3)",
  },
  Speculative: {
    border: "#fbbf24", // amber-400
    bg: "#fef3c7", // amber-100
    shadow: "rgba(251,191,36,0.3)",
  },
};

const edgeColors = {
  ns: "#94a3b8",
  spec: "#f59e0b",
} as const;

type VisualizationNode = Node<{
  label: string;
  nodeType: StaticGraph["nodes"][number]["type"];
}>;

type VisualizationEdge = Edge<ElkEdgeData>;

function toNodes(graph: StaticGraph): VisualizationNode[] {
  return graph.nodes.map((node, idx) => {
    return {
      id: node.id,
      data: { label: node.label, nodeType: node.type },
      position: {
        x: node.x ?? (node.type === "spec" ? 260 : 40),
        y: node.y ?? idx * 120,
      },
      style: baseNodeStyle(node.type, false),
    } satisfies VisualizationNode;
  });
}

function baseNodeStyle(
  type: StaticGraph["nodes"][number]["type"],
  active: boolean,
  activeMode?: TraceStep["executionMode"],
) {
  const activeStyle = active
    ? activeMode
      ? activeColors[activeMode]
      : activeColors.NS
    : null;

  return {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    border: `2px solid ${activeStyle ? activeStyle.border : nodeColors[type]}`,
    background: activeStyle ? activeStyle.bg : "#ffffff",
    color: "#0f172a",
    padding: 8,
    borderRadius: 8,
    fontSize: 12,
    boxShadow: activeStyle ? `0 0 0 3px ${activeStyle.shadow}` : "none",
  } as const;
}

function toEdges(graph: StaticGraph): VisualizationEdge[] {
  return graph.edges.map((edge, idx) => {
    const color = edgeColors[edge.type];
    return {
      id: createEdgeId(edge, idx),
      source: edge.source,
      target: edge.target,
      label: edge.label ?? edge.type,
      style: { stroke: color, strokeWidth: 2 },
      labelStyle: { fill: color, fontSize: 11, fontWeight: 600 },
      animated: edge.type === "spec",
      type: "elk",
      data: {},
    } satisfies VisualizationEdge;
  });
}

export function VCFGView({
  graph,
  activeNodeId,
  activeMode,
  title = "VCFG",
  actionSlot,
}: Props) {
  const fallbackNodes = useMemo(() => (graph ? toNodes(graph) : []), [graph]);
  const fallbackEdges = useMemo(() => (graph ? toEdges(graph) : []), [graph]);
  const nodeById = useMemo(() => {
    if (!graph) return new Map<string, StaticGraph["nodes"][number]>();
    return new Map(graph.nodes.map((node) => [node.id, node]));
  }, [graph]);

  const [nodes, setNodes, onNodesChange] =
    useNodesState<VisualizationNode>(fallbackNodes);
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<VisualizationEdge>(fallbackEdges);
  const rfRef = useRef<ReactFlowInstance<
    VisualizationNode,
    VisualizationEdge
  > | null>(null);
  const activeNodeRef = useRef<string | null>(activeNodeId ?? null);
  const activeModeRef = useRef<TraceStep["executionMode"] | null>(
    activeMode ?? null,
  );
  const edgeTypes = useMemo(() => ({ elk: ElkEdge }), []);
  const elk = useMemo(() => new ELK(), []);

  useEffect(() => {
    activeNodeRef.current = activeNodeId;
    if (!graph) return;
    setNodes((prev) =>
      applyActiveStyles(prev, activeNodeId, activeModeRef.current ?? undefined),
    );
  }, [activeNodeId, graph, setNodes]);

  useEffect(() => {
    activeModeRef.current = activeMode ?? null;
    if (!graph) return;
    setNodes((prev) =>
      applyActiveStyles(
        prev,
        activeNodeRef.current,
        activeModeRef.current ?? undefined,
      ),
    );
  }, [activeMode, graph, setNodes]);

  useEffect(() => {
    setEdges(fallbackEdges);
  }, [fallbackEdges, setEdges]);

  // graph 変更時に ELK でレイアウトを再計算（activeNode 変更では再計算しない）
  useEffect(() => {
    if (!graph) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const elkGraph = buildElkGraph(graph);
    const syncFallbackNodes = () =>
      setNodes(
        applyActiveStyles(
          fallbackNodes,
          activeNodeRef.current,
          activeModeRef.current ?? undefined,
        ),
      );
    syncFallbackNodes();

    let cancelled = false;
    elk
      .layout(elkGraph, { layoutOptions: elkLayoutOptions })
      .then((res) => {
        if (cancelled || !res.children) return;
        const nextNodes: VisualizationNode[] = res.children.map((child) => {
          const original = nodeById.get(child.id);
          return {
            id: child.id,
            data: {
              label: original?.label ?? child.id,
              nodeType: original?.type ?? "ns",
            },
            position: {
              x: child.x ?? 0,
              y: child.y ?? 0,
            },
            style: baseNodeStyle(
              original?.type ?? "ns",
              child.id === activeNodeRef.current,
              child.id === activeNodeRef.current
                ? (activeModeRef.current ?? undefined)
                : undefined,
            ),
          } satisfies VisualizationNode;
        });
        setNodes(nextNodes);
        const nextEdges = attachSections(fallbackEdges, res.edges ?? []);
        setEdges(nextEdges);
        // レイアウト確定後にビューをフィット
        queueMicrotask(() => {
          rfRef.current?.fitView(fitViewOptions);
        });
      })
      .catch(() => {
        if (cancelled) return;
        // フォールバック: 既存のプレーン座標を使用
        syncFallbackNodes();
        setEdges(fallbackEdges);
      });

    return () => {
      cancelled = true;
    };
  }, [elk, fallbackNodes, fallbackEdges, graph, nodeById, setEdges, setNodes]);

  useEffect(() => {
    return () => {
      elk.terminateWorker?.();
    };
  }, [elk]);

  const handleInit = useCallback(
    (instance: ReactFlowInstance<VisualizationNode, VisualizationEdge>) => {
      rfRef.current = instance;
      instance.fitView(fitViewOptions);
    },
    [],
  );

  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-dashed border-neutral-200 bg-white text-sm text-neutral-500">
        解析結果がここに表示されます
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 rounded border border-neutral-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-neutral-800">{title}</div>
        {actionSlot ?? null}
      </div>
      <div className="flex-1 min-h-[420px] w-full rounded border border-neutral-100">
        <ReactFlow<VisualizationNode, VisualizationEdge>
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodesDraggable={false}
          fitView
          fitViewOptions={fitViewOptions}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ markerEnd: { type: "arrowclosed" } }}
          onInit={handleInit}
          edgeTypes={edgeTypes}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

function applyActiveStyles(
  targetNodes: VisualizationNode[],
  activeNodeId: string | null,
  activeMode?: TraceStep["executionMode"],
): VisualizationNode[] {
  return targetNodes.map((node) => ({
    ...node,
    style: baseNodeStyle(
      node.data?.nodeType ?? "ns",
      node.id === activeNodeId,
      node.id === activeNodeId ? activeMode : undefined,
    ),
  }));
}

function attachSections(
  baseEdges: VisualizationEdge[],
  layoutEdges: ElkExtendedEdge[],
) {
  const sectionsById = new Map(
    layoutEdges.map<[string, ElkEdgeSection[] | undefined]>((edge) => [
      edge.id,
      edge.sections,
    ]),
  );
  return baseEdges.map((edge) => ({
    ...edge,
    data: {
      ...edge.data,
      sections: sectionsById.get(edge.id),
    },
  }));
}

export const __testables = {
  baseNodeStyle,
  applyActiveStyles,
};
