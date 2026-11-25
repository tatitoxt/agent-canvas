import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import type { DelegationEdgeData } from "./types";
import { useBoard } from "../store/board";

/**
 * Edges are quiet hairlines with a small glass label — the record of a
 * delegation (task down, result back), not decorative wires.
 */
const STATE_STYLE = {
  delegated: { stroke: "color-mix(in srgb, var(--cv-accent) 55%, transparent)", chip: "task" },
  returned: { stroke: "color-mix(in srgb, var(--cv-done) 55%, transparent)", chip: "result" },
  failed: { stroke: "color-mix(in srgb, var(--cv-blocked) 55%, transparent)", chip: "failed" },
} as const;

type Rect = { x: number; y: number; w: number; h: number };

/** Cards the cable must not cross — agents (redesign size), panels, terms.
 * Cheap obstacle set for the re-router; positions come from the board store. */
function obstacleRects(exclude: string[]): Rect[] {
  const st = useBoard.getState();
  const rects: Rect[] = [];
  for (const [id, pos] of Object.entries(st.positions)) {
    if (exclude.includes(id)) continue;
    const sz = st.agentSizes?.[id];
    rects.push({ x: pos.x, y: pos.y, w: sz?.w ?? 460, h: sz?.h ?? 260 });
  }
  const board = st.activeBoard;
  for (const [id, n] of Object.entries(st.panelNodes[board] ?? {})) {
    if (exclude.includes(id)) continue;
    rects.push({ x: n.x, y: n.y, w: n.w ?? 320, h: n.h ?? 420 });
  }
  for (const [id, n] of Object.entries(st.termNodes[board] ?? {})) {
    if (exclude.includes(id)) continue;
    if (n.collapsed) continue;
    rects.push({ x: n.x, y: n.y, w: n.w ?? 560, h: n.h ?? 320 });
  }
  return rects;
}

const pad = 14;
function hits(r: Rect, x: number, y: number) {
  return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
}

/** Sample the straight segment; when it crosses a card, insert a two-point
 * detour around the offending obstacle — the cable bends below (or above)
 * the card instead of slicing through it. */
function detourPath(
  sx: number, sy: number, tx: number, ty: number, obstacles: Rect[],
): { path: string; lx: number; ly: number } {
  const samples = 24;
  let hitRect: Rect | null = null;
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const x = sx + (tx - sx) * t;
    const y = sy + (ty - sy) * t;
    for (const r of obstacles) {
      if (hits(r, x, y)) { hitRect = r; break; }
    }
    if (hitRect) break;
  }
  if (!hitRect) {
    // clear — gentle single curve
    const mx = (sx + tx) / 2;
    return { path: `M ${sx},${sy} C ${mx},${sy} ${mx},${ty} ${tx},${ty}`, lx: (sx + tx) / 2, ly: (sy + ty) / 2 };
  }
  // detour below or above the obstacle — pick whichever edge is nearer the line
  const midY = (sy + ty) / 2;
  const below = hitRect.y + hitRect.h + 34;
  const above = hitRect.y - 34;
  const dy = Math.abs(midY - below) <= Math.abs(midY - above) ? below : above;
  const x1 = Math.min(sx, tx) + Math.abs(tx - sx) * 0.25;
  const x2 = Math.min(sx, tx) + Math.abs(tx - sx) * 0.75;
  const path = `M ${sx},${sy} C ${x1},${sy} ${x1},${dy} ${x1},${dy} L ${x2},${dy} C ${x2},${dy} ${x2},${ty} ${tx},${ty}`;
  return { path, lx: (x1 + x2) / 2, ly: dy };
}

export function DelegationEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<Edge<DelegationEdgeData>>) {
  const obstacles = obstacleRects([source, target]);
  const routed = detourPath(sourceX, sourceY, targetX, targetY, obstacles);
  const [path, labelX, labelY] = obstacles.length
    ? [routed.path, routed.lx, routed.ly]
    : getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      });
  const style = STATE_STYLE[data?.state ?? "delegated"];
  const label =
    data?.state === "returned"
      ? `${data.result ?? ""}${data.files ? ` · ${data.files} file${data.files === 1 ? "" : "s"}` : ""}`
      : data?.task;

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
            className="glass-pill nodrag nopan pointer-events-auto absolute max-w-52 -translate-x-1/2 -translate-y-1/2 cursor-pointer px-2.5 py-1 text-[12px] leading-snug font-medium"
            style={{ left: labelX, top: labelY }}
            title="Open this delegation's full record"
            onClick={() => useBoard.getState().setEdgeDetail(id)}
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
