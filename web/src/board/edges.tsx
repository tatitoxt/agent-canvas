import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import type { DelegationEdgeData } from "./types";
import { useBoard } from "../store/board";
import { countRender } from "../lib/renderProbe";

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
type PositionNode = { id: string; parentId?: string; position: Point; internals?: { positionAbsolute?: Point } };

export function absoluteNodePosition(node: PositionNode, nodesById: Map<string, PositionNode>, seen = new Set<string>()): Point {
  const internal = node.internals?.positionAbsolute;
  if (internal) return internal;
  if (!node.parentId || seen.has(node.id)) return node.position;
  seen.add(node.id);
  const parent = nodesById.get(node.parentId);
  if (!parent) return node.position;
  const parentPosition = absoluteNodePosition(parent, nodesById, seen);
  return { x: parentPosition.x + node.position.x, y: parentPosition.y + node.position.y };
}

const pad = 14;
type Point = { x: number; y: number };

function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const left = r.x - pad, right = r.x + r.w + pad;
  const top = r.y - pad, bottom = r.y + r.h + pad;
  if (Math.abs(a.x - b.x) < 0.01) {
    return a.x >= left && a.x <= right && Math.max(Math.min(a.y, b.y), top) <= Math.min(Math.max(a.y, b.y), bottom);
  }
  if (Math.abs(a.y - b.y) < 0.01) {
    return a.y >= top && a.y <= bottom && Math.max(Math.min(a.x, b.x), left) <= Math.min(Math.max(a.x, b.x), right);
  }
  // Cubic clear-path check; sample at a density based on its length so a
  // narrow crossing cannot slip between fixed, widely spaced samples.
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(24, Math.ceil(length / 8));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x >= left && x <= right && y >= top && y <= bottom) return true;
  }
  return false;
}

function pathClear(points: Point[], obstacles: Rect[]): boolean {
  for (let i = 1; i < points.length; i++) {
    if (obstacles.some((r) => segmentHitsRect(points[i - 1], points[i], r))) return false;
  }
  return true;
}

function pathLength(points: Point[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
}

/** Route around every intervening card. Try compact horizontal and vertical
 * lanes first, then outer lanes around the complete obstacle bounds. */
export function detourPath(
  sx: number, sy: number, tx: number, ty: number, obstacles: Rect[], labelWidth = 0,
  labelObstacles: Rect[] = obstacles,
): { path: string; lx: number; ly: number } {
  const start = { x: sx, y: sy }, end = { x: tx, y: ty };
  const mx = (sx + tx) / 2, my = (sy + ty) / 2;
  const labelFits = (x: number, y: number) => {
    if (labelWidth <= 0) return true;
    const label = { x: x - labelWidth / 2, y: y - 13, w: labelWidth, h: 26 };
    return labelObstacles.every((r) =>
      label.x + label.w < r.x - 4 || label.x > r.x + r.w + 4 ||
      label.y + label.h < r.y - 4 || label.y > r.y + r.h + 4,
    );
  };
  const routeLabel = (points: Point[]) => {
    const choices = points.slice(1).flatMap((to, i) => {
      const from = points[i];
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const horizontal = Math.abs(to.y - from.y) < 0.01;
      const offsets = [0, -22, 22, -44, 44];
      return [0.1, 0.25, 0.5, 0.75, 0.9].flatMap((t) => offsets.map((offset) => ({
        x: from.x + (to.x - from.x) * t + (horizontal ? 0 : offset),
        y: from.y + (to.y - from.y) * t + (horizontal ? offset : 0),
        length,
        horizontal,
        rank: Number(horizontal) * 1000 + Math.min(length, Math.max(labelWidth, 1) * 2) * 2 -
          Math.abs(offset) * 3 - Math.abs(t - 0.5) * 20,
      })));
    }).filter((point) => labelFits(point.x, point.y));
    return choices.sort((a, b) => b.rank - a.rank)[0];
  };
  const cubicHit = obstacles.some((r) => {
    let prev = start;
    for (let i = 1; i <= 48; i++) {
      const t = i / 48, u = 1 - t;
      const p = {
        x: u ** 3 * sx + 3 * u ** 2 * t * mx + 3 * u * t ** 2 * mx + t ** 3 * tx,
        y: u ** 3 * sy + 3 * u ** 2 * t * sy + 3 * u * t ** 2 * ty + t ** 3 * ty,
      };
      if (segmentHitsRect(prev, p, r)) return true;
      prev = p;
    }
    return false;
  });
  if (!cubicHit) {
    if (labelWidth > 0) {
      const choices = [0.5, 0.38, 0.62].map((t) => {
        const u = 1 - t;
        return {
          x: u ** 3 * sx + 3 * u ** 2 * t * mx + 3 * u * t ** 2 * mx + t ** 3 * tx,
          y: u ** 3 * sy + 3 * u ** 2 * t * sy + 3 * u * t ** 2 * ty + t ** 3 * ty,
          t,
        };
      });
      const point = choices.find((p) => labelFits(p.x, p.y)) ?? choices[0];
      return { path: `M ${sx},${sy} C ${mx},${sy} ${mx},${ty} ${tx},${ty}`, lx: point.x, ly: point.y };
    }
    return { path: `M ${sx},${sy} C ${mx},${sy} ${mx},${ty} ${tx},${ty}`, lx: mx, ly: my };
  }

  const clearance = pad + 22;
  const minY = Math.min(sy, ty, ...obstacles.map((r) => r.y - clearance));
  const maxY = Math.max(sy, ty, ...obstacles.map((r) => r.y + r.h + clearance));
  const minX = Math.min(sx, tx, ...obstacles.map((r) => r.x - clearance));
  const maxX = Math.max(sx, tx, ...obstacles.map((r) => r.x + r.w + clearance));
  const yLanes = [...new Set([
    my, minY, maxY,
    ...obstacles.flatMap((r) => [r.y - clearance, r.y + r.h + clearance]),
  ])];
  const xLanes = [...new Set([
    mx, minX, maxX,
    ...obstacles.flatMap((r) => [r.x - clearance, r.x + r.w + clearance]),
  ])];
  const candidates: Point[][] = [];
  for (const y of yLanes) candidates.push([start, { x: sx, y }, { x: tx, y }, end]);
  for (const x of xLanes) candidates.push([start, { x, y: sy }, { x, y: ty }, end]);
  const routes = candidates
    .filter((points) => pathClear(points, obstacles))
    .map((points) => points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y))
    .sort((a, b) => pathLength(a) - pathLength(b));
  const route = routes.find((points) => routeLabel(points)) ?? routes[0];

  if (!route) {
    // A final broad lane encloses the whole obstacle field. In normal boards
    // one of the compact candidates above succeeds; this is a defensive path.
    const y = Math.abs(my - minY) < Math.abs(my - maxY) ? minY - clearance : maxY + clearance;
    return { path: `M ${sx},${sy} L ${sx},${y} L ${tx},${y} L ${tx},${ty}`, lx: mx, ly: y };
  }
  const path = route.map((p, i) => `${i ? "L" : "M"} ${p.x},${p.y}`).join(" ");
  const labelPoint = routeLabel(route);
  if (labelPoint) return { path, lx: labelPoint.x, ly: labelPoint.y };
  const horizontal = route.find((p, i) => i > 0 && Math.abs(p.y - route[i - 1].y) < 0.01 && Math.abs(p.x - route[i - 1].x) > 1);
  const labelIndex = horizontal ? route.indexOf(horizontal) : 1;
  const labelFrom = route[Math.max(0, labelIndex - 1)];
  const labelTo = route[Math.min(route.length - 1, labelIndex)];
  return { path, lx: (labelFrom.x + labelTo.x) / 2, ly: (labelFrom.y + labelTo.y) / 2 };
}

export function DelegationEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<Edge<DelegationEdgeData>>) {
  countRender("DelegationEdge");
  // Orthogonal routing with node avoidance from main, enhanced with the
  // recent detour router so paths can clear multiple intervening nodes.
  const { getNodes } = useReactFlow();
  const nodes = getNodes();
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const otherNodes = nodes.filter((n) => n.type !== "workspace");
  // React Flow's edge anchors are absolute even for children nested in a
  // workspace. Build both path and label obstacles from the same measured,
  // absolute node geometry; store coordinates are board-relative and drift
  // from anchors for nested demo/live nodes.
  const allNodeRects = otherNodes.map((n) => {
    const p = absoluteNodePosition(n, nodesById);
    const w = n.measured?.width ?? (n.width as number) ?? 380;
    const h = n.measured?.height ?? (n.height as number) ?? 200;
    return { id: n.id, x: p.x - 8, y: p.y - 8, w: w + 16, h: h + 16 };
  });
  const nodeObstacles = allNodeRects
    .filter((n) => n.id !== source && n.id !== target)
    .map(({ x, y, w, h }) => ({ x, y, w, h }));
  // Labels must avoid endpoints too. Compute parent-relative workspace cards
  // in absolute flow coordinates so chips do not land on their own terminal.
  const labelObstacles = allNodeRects;
  const label =
    data?.state === "returned"
      ? `${data.result ?? ""}${data.files ? ` · ${data.files} file${data.files === 1 ? "" : "s"}` : ""}`
      : data?.task;
  const labelWidth = Math.min(208, Math.max(96, (label?.length ?? 0) * 6.1 + 44));
  const routed = detourPath(
    sourceX, sourceY, targetX, targetY,
    nodeObstacles, labelWidth,
    labelObstacles,
  );
  const [bezierPath] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      });
  const path = nodeObstacles.length ? routed.path : bezierPath;
  const labelX = routed.lx;
  const labelY = routed.ly;
  const style = STATE_STYLE[data?.state ?? "delegated"];

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
            style={{ left: labelX, top: labelY, zIndex: 10 }}
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
