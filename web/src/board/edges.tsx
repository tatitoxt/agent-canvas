import {
  BaseEdge,
  EdgeLabelRenderer,
  useReactFlow,
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
  delegated: { stroke: "rgba(201,162,107,0.55)", chip: "task" },
  returned: { stroke: "rgba(123,163,137,0.6)", chip: "result" },
  failed: { stroke: "rgba(176,106,94,0.6)", chip: "failed" },
} as const;

export function DelegationEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerEnd,
}: EdgeProps<Edge<DelegationEdgeData>>) {
  // Orthogonal routing with node avoidance: right-angle cables, and when
  // the straight 3-segment path crosses an intermediate card the midline
  // slides perpendicular until it clears — cables route AROUND cards.
  const { getNodes } = useReactFlow();
  const obstacles = getNodes()
    .filter((n) => n.id !== source && n.id !== target && n.type !== "workspace")
    .map((n) => {
      const p = ((n as { internals?: { positionAbsolute?: { x: number; y: number } } }).internals?.positionAbsolute ?? n.position) as { x: number; y: number };
      const w = n.measured?.width ?? (n.width as number) ?? 380;
      const h = n.measured?.height ?? (n.height as number) ?? 200;
      return { x: p.x - 8, y: p.y - 8, w: w + 16, h: h + 16 };
    });

  const horizontal = Math.abs(targetX - sourceX) >= Math.abs(targetY - sourceY);
  const hit = (x1: number, y1: number, x2: number, y2: number) =>
    obstacles.some((r) => {
      // segment-vs-rect: coarse but right for axis-aligned segments
      if (x1 === x2) {
        const x = x1, yA = Math.min(y1, y2), yB = Math.max(y1, y2);
        return x >= r.x && x <= r.x + r.w && yB >= r.y && yA <= r.y + r.h;
      }
      if (y1 === y2) {
        const y = y1, xA = Math.min(x1, x2), xB = Math.max(x1, x2);
        return y >= r.y && y <= r.y + r.h && xB >= r.x && xA <= r.x + r.w;
      }
      // diagonal fallback: treat as bounding box overlap
      const xA = Math.min(x1, x2), xB = Math.max(x1, x2), yA = Math.min(y1, y2), yB = Math.max(y1, y2);
      return xB >= r.x && xA <= r.x + r.w && yB >= r.y && yA <= r.y + r.h;
    });

  const path3 = (mid: number) => {
    if (horizontal) {
      return {
        d: `M ${sourceX},${sourceY} L ${mid},${sourceY} L ${mid},${targetY} L ${targetX},${targetY}`,
        blocked: hit(sourceX, sourceY, mid, sourceY) || hit(mid, sourceY, mid, targetY) || hit(mid, targetY, targetX, targetY),
        lx: mid, ly: (sourceY + targetY) / 2,
      };
    }
    return {
      d: `M ${sourceX},${sourceY} L ${sourceX},${mid} L ${targetX},${mid} L ${targetX},${targetY}`,
      blocked: hit(sourceX, sourceY, sourceX, mid) || hit(sourceX, mid, targetX, mid) || hit(targetX, mid, targetX, targetY),
      lx: (sourceX + targetX) / 2, ly: mid,
    };
  };

  const base = horizontal ? (sourceX + targetX) / 2 : (sourceY + targetY) / 2;
  let best = path3(base);
  if (best.blocked) {
    // slide the midline both ways in steps until every segment clears
    outer: for (const step of [48, 96, 160, 240, 340]) {
      for (const dir of [1, -1]) {
        const cand = path3(base + step * dir);
        if (!cand.blocked) { best = cand; break outer; }
      }
    }
  }
  const path = best.d, labelX = best.lx, labelY = best.ly;
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
            className="nodrag nopan pointer-events-auto absolute max-w-52 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border border-white/10 px-2.5 py-1 text-[10.5px] leading-snug"
            style={{ left: labelX, top: labelY, background: "color-mix(in srgb, var(--cv-base) 96%, transparent)", zIndex: 10 }}
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
