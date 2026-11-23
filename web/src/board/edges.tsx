import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { DelegationEdgeData } from "./types";

const STATE_STYLE = {
  delegated: { stroke: "var(--cv-accent)", chip: "task →" },
  returned: { stroke: "var(--cv-done)", chip: "← result" },
  failed: { stroke: "var(--cv-blocked)", chip: "✕ failed" },
} as const;

export function DelegationEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<Edge<DelegationEdgeData>>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const style = STATE_STYLE[data?.state ?? "delegated"];
  const label = data?.state === "returned" ? data.result : data?.task;

  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        className={data?.state === "delegated" ? "edge-task" : undefined}
        style={{ stroke: style.stroke, strokeWidth: 1.6, opacity: 0.85 }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute max-w-56 -translate-x-1/2 -translate-y-1/2 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug"
            style={{
              left: labelX,
              top: labelY,
              borderColor: style.stroke,
              background: "var(--cv-surface)",
              color: "var(--cv-ink)",
            }}
          >
            <span className="mr-1 font-semibold" style={{ color: style.stroke }}>
              {style.chip}
            </span>
            <span className="text-[var(--cv-ink-dim)]">{label}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
