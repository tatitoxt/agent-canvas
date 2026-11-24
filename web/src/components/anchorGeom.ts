/** Geometry for anchor cables — screen-space rect/segment math shared by
 * PinBtn (pick a clean drop spot) and AnchorCables (draw free lines only). */

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Point on the rect border closest to `toward` (midpoint of the facing edge). */
export function edgePoint(r: Rect, toward: Pt): Pt {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx !== 0 ? (r.w / 2) / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? (r.h / 2) / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

function segsCross(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const d = (o: Pt, p: Pt, q: Pt) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = d(a1, a2, b1);
  const d2 = d(a1, a2, b2);
  const d3 = d(b1, b2, a1);
  const d4 = d(b1, b2, a2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Does segment a→b cross rect r? (Touching a corner/edge doesn't count as
 * crossing — the line is allowed to end ON the two endpoint rects.) */
export function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  const corners: Pt[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  // strictly inside
  const inside = (p: Pt) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  if (inside(a) && inside(b)) return true;
  for (let i = 0; i < 4; i++) {
    if (segsCross(a, b, corners[i], corners[(i + 1) % 4])) return true;
  }
  return false;
}

/** Rects of every rendered node + open panel, minus `excludeSel` matches. */
export function obstacleRects(excludeSel: string[]): Rect[] {
  const rects: Rect[] = [];
  const els = document.querySelectorAll(".react-flow__node, [data-panel]");
  for (const el of els) {
    if (excludeSel.some((sel) => el.matches(sel) || el.closest(sel))) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return rects;
}
