/* eslint-disable @next/next/no-img-element */
"use client";

import { Background, Controls, Edge, FitViewOptions, Node, ReactFlow, useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo } from "react";
import type { StaticGraph } from "../types/analysis-result";

type Props = {
  graph: StaticGraph | null;
  activeNodeId: string | null;
};

const fitViewOptions: FitViewOptions = { padding: 0.2, includeHiddenNodes: true };

const nodeColors = {
  ns: "#2563eb", // blue
  spec: "#f59e0b", // amber
} as const;

const edgeColors = {
  ns: "#94a3b8",
  spec: "#f59e0b",
  rollback: "#ef4444",
} as const;

function toNodes(graph: StaticGraph): Node[] {
  return graph.nodes.map((node, idx) => {
    return {
      id: node.id,
      data: { label: node.label },
      position: {
        x: node.x ?? (node.type === "spec" ? 260 : 40),
        y: node.y ?? idx * 120,
      },
      style: baseNodeStyle(node.type, false),
    } satisfies Node;
  });
}

function baseNodeStyle(type: StaticGraph["nodes"][number]["type"], active: boolean) {
  return {
    border: `2px solid ${active ? "#60a5fa" : nodeColors[type]}`,
    background: active ? "#dbeafe" : "#ffffff",
    color: "#0f172a",
    padding: 8,
    borderRadius: 8,
    fontSize: 12,
    boxShadow: active ? "0 0 0 3px rgba(96,165,250,0.3)" : "none",
  } as const;
}

function toEdges(graph: StaticGraph): Edge[] {
  return graph.edges.map((edge, idx) => {
    const color = edgeColors[edge.type];
    return {
      id: `${edge.source}-${edge.target}-${idx}`,
      source: edge.source,
      target: edge.target,
      label: edge.type === "rollback" ? "rollback" : edge.label ?? edge.type,
      style: { stroke: color, strokeWidth: 2 },
      labelStyle: { fill: color, fontSize: 11, fontWeight: 600 },
      animated: edge.type === "spec",
      type: edge.type === "rollback" ? "step" : "default",
    } satisfies Edge;
  });
}

export function VCFGView({ graph, activeNodeId }: Props) {
  const initialNodes = useMemo(() => (graph ? toNodes(graph) : []), [graph]);
  const initialEdges = useMemo(() => (graph ? toEdges(graph) : []), [graph]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // graph 変更時にノードも同期（解析開始時に空のままになるのを防ぐ）
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  // activeNode 変更時に style のみ更新（position を維持）
  useEffect(() => {
    if (!graph) return;
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        style: baseNodeStyle(graph.nodes.find((g) => g.id === n.id)?.type ?? "ns", n.id === activeNodeId),
      })),
    );
  }, [graph, activeNodeId, setNodes]);

  // graph 変更時にエッジも同期
  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

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
        <div className="text-sm font-semibold text-neutral-800">VCFG</div>
        <div className="text-[11px] text-neutral-500">ドラッグで移動、ホイールでズーム</div>
      </div>
      <div className="h-[360px] w-full rounded border border-neutral-100">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={fitViewOptions}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ markerEnd: { type: "arrowclosed" } }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
