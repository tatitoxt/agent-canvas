import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import type { DelegationEdgeData } from "./types";

/**
 * Edges are quiet hairlines with a small glass label — the record of a
 * delegation (task down, result back), not decorative wires.
 */
const STATE_STYLE = {
  delegated: { stroke: "rgba(201,162,107,0.55)", chip: "task" },
  returned: { stroke: "rgba(123,163,137,0.6)", chip: "result" },
  failed: { stroke: "rgba(176,106,94,0.6)", chip: "failed" },
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
        className={data?.state === "delegated" ? "edge-delegated" : undefined}
        style={{ stroke: style.stroke, strokeWidth: 1.25 }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="glass-pill nodrag nopan pointer-events-auto absolute max-w-52 -translate-x-1/2 -translate-y-1/2 px-2.5 py-1 text-[10.5px] leading-snug"
            style={{ left: labelX, top: labelY }}
          >
            <span className="mr-1.5" style={{ color: style.stroke }}>
              {style.chip}
            </span>
            <span style={{ color: "var(--cv-ink-dim)" }}>{label}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
