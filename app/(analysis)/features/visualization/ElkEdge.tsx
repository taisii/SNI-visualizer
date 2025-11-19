import {
  BaseEdge,
  EdgeLabelRenderer,
  type Edge,
  type EdgeProps,
  getStraightPath,
} from "@xyflow/react";
import type { ElkEdgeSection } from "elkjs";

export type ElkEdgeData = {
  sections?: ElkEdgeSection[];
};

type ElkReactFlowEdge = Edge<ElkEdgeData>;
type ElkEdgeProps = EdgeProps<ElkReactFlowEdge>;

export function ElkEdge(props: ElkEdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    markerEnd,
    style,
    data,
    label,
  } = props;

  const [fallbackPath, labelX, labelY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  const path = buildPathFromSections(data?.sections) ?? fallbackPath;
  const labelPoint =
    getLabelPointFromSections(data?.sections) ?? ({ x: labelX, y: labelY } as const);

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)`,
              pointerEvents: "all",
              background: "white",
              padding: "2px 4px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              color: style?.stroke ?? "#0f172a",
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function buildPathFromSections(sections?: ElkEdgeSection[]) {
  if (!sections || sections.length === 0) {
    return null;
  }

  const commands: string[] = [];
  let initialized = false;

  for (const point of flattenSectionPoints(sections)) {
    const instruction = initialized ? "L" : "M";
    commands.push(`${instruction} ${point.x} ${point.y}`);
    initialized = true;
  }

  return commands.join(" ");
}

function getLabelPointFromSections(sections?: ElkEdgeSection[]) {
  const points = flattenSectionPoints(sections);
  if (points.length < 2) {
    return null;
  }

  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += segmentLength(points[i - 1], points[i]);
  }
  if (total === 0) {
    return points[0];
  }

  let cursor = total / 2;
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1];
    const end = points[i];
    const segment = segmentLength(start, end);
    if (cursor <= segment) {
      const ratio = cursor / segment;
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      } as const;
    }
    cursor -= segment;
  }

  return points[points.length - 1];
}

function flattenSectionPoints(sections?: ElkEdgeSection[]) {
  const flattened: { x: number; y: number }[] = [];
  if (!sections) return flattened;

  for (const section of sections) {
    const points = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ];

    for (const point of points) {
      const last = flattened[flattened.length - 1];
      if (!last || last.x !== point.x || last.y !== point.y) {
        flattened.push({ x: point.x, y: point.y });
      }
    }
  }

  return flattened;
}

function segmentLength(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
