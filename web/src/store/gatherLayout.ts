/** Geometry planner for Gather — pure and unit-testable. The store supplies
 * loose cards in flow coordinates plus the obstacles that must stay visible. */

export type GatherItem = { id: string; x: number; y: number; w: number; h: number };
export type GatherRect = { x: number; y: number; w: number; h: number };
export type GatherViewport = { left: number; top: number; right: number; bottom: number };
export type GatherSafeInsets = { left: number; top: number; right: number; bottom: number };

export type GatherPlacement = { id: string; x: number; y: number; row: number; col: number };
export type GatherPlan = {
  placements: GatherPlacement[];
  frame: GatherRect;
  cols: number;
  rows: number;
};

/* Deska spacing scale: 24px air between windows, 24px side/bottom padding,
 * and a 52px header band inside the region for its label. */
export const GATHER_GAP = 24;
export const GATHER_PAD_X = 24;
export const GATHER_PAD_TOP = 52;
export const GATHER_PAD_BOTTOM = 24;

/* Floating chrome overlays the canvas. In flow units these insets land at
 * roughly 50–80 screen px across the zoom range where gather is used. */
const DEFAULT_SAFE_INSETS: GatherSafeInsets = { left: 72, top: 104, right: 56, bottom: 88 };
const OBSTACLE_AIR = 14;

const finite = (n: number | undefined) => typeof n === "number" && Number.isFinite(n);

function overlapArea(a: GatherRect, b: GatherRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function insetViewport(vp: GatherViewport, safe: GatherSafeInsets): GatherRect {
  const x = vp.left + safe.left;
  const y = vp.top + safe.top;
  return {
    x,
    y,
    w: Math.max(280, vp.right - vp.left - safe.left - safe.right),
    h: Math.max(220, vp.bottom - vp.top - safe.top - safe.bottom),
  };
}

/** Reading order, tolerant of cards whose tops are almost aligned. The row
 * band is intentionally smaller than a normal card so genuinely separate
 * rows keep their vertical order while a hand-dragged row stays left→right. */
function readingOrder(items: GatherItem[]): GatherItem[] {
  const band = (it: GatherItem) => Math.round(it.y / 160);
  return [...items].sort((a, b) => {
    const rows = band(a) - band(b);
    if (rows) return rows;
    const ax = a.x + a.w / 2;
    const bx = b.x + b.w / 2;
    if (ax !== bx) return ax - bx;
    if (a.y !== b.y) return a.y - b.y;
    return a.id.localeCompare(b.id);
  });
}

function tupleCompare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const d = a[i] - b[i];
    if (Math.abs(d) > 0.001) return d;
  }
  return 0;
}

/**
 * Plan a compact row/column window grid and a group frame around it.
 *
 * Unlike a fixed-cell grid, column widths and row heights are measured per
 * column/row. Small cards do not inherit the largest card's footprint, which
 * keeps mixed panels/terminals tight without losing aligned headers.
 */
export function planGatherLayout(
  items: GatherItem[],
  viewport: GatherViewport | null,
  obstacles: GatherRect[] = [],
  safeInsets: GatherSafeInsets = DEFAULT_SAFE_INSETS,
): GatherPlan | null {
  if (!items.length) return null;
  const ordered = readingOrder(items);
  const idealCols = Math.ceil(Math.sqrt(ordered.length));

  const avail = viewport ? insetViewport(viewport, safeInsets) : null;
  const metricsFor = (candidateCols: number) => {
    const candidateRows = Math.ceil(ordered.length / candidateCols);
    const widths = Array.from({ length: candidateCols }, () => 0);
    const heights = Array.from({ length: candidateRows }, () => 0);
    ordered.forEach((it, i) => {
      const col = i % candidateCols;
      const row = Math.floor(i / candidateCols);
      widths[col] = Math.max(widths[col], it.w);
      heights[row] = Math.max(heights[row], it.h);
    });
    const cw = widths.reduce((a, b) => a + b, 0) + (candidateCols - 1) * GATHER_GAP;
    const ch = heights.reduce((a, b) => a + b, 0) + (candidateRows - 1) * GATHER_GAP;
    return {
      rows: candidateRows,
      colW: widths,
      rowH: heights,
      frameW: cw + GATHER_PAD_X * 2,
      frameH: ch + GATHER_PAD_TOP + GATHER_PAD_BOTTOM,
    };
  };

  // Prefer the near-square column count, but test the ACTUAL measured column
  // widths rather than assuming every column is as wide as the largest card.
  // Mixed panels often fit two columns where the conservative max-width test
  // would collapse them into a needlessly tall strip.
  let cols = idealCols;
  let metrics = metricsFor(cols);
  if (avail) {
    while (cols > 1 && metrics.frameW > avail.w) {
      cols -= 1;
      metrics = metricsFor(cols);
    }
  }
  const { rows, colW, rowH, frameW, frameH } = metrics;

  let idealX: number;
  let idealY: number;
  if (avail) {
    idealX = avail.x + (avail.w - frameW) / 2;
    idealY = avail.y + (avail.h - frameH) / 2;
  } else {
    // Without viewport information keep the group near the cards' current
    // centroid rather than jumping to an arbitrary canvas origin.
    const cx = ordered.reduce((n, it) => n + it.x + it.w / 2, 0) / ordered.length;
    const cy = ordered.reduce((n, it) => n + it.y + it.h / 2, 0) / ordered.length;
    idealX = cx - frameW / 2;
    idealY = cy - frameH / 2;
  }

  const cleanObstacles = obstacles.filter((r) => finite(r.x) && finite(r.y) && finite(r.w) && finite(r.h) && r.w > 0 && r.h > 0);
  const penalty = (frame: GatherRect): [number, number, number] => {
    let area = 0;
    let count = 0;
    for (const o0 of cleanObstacles) {
      // Keep a little visible air around stationary content — touching a
      // workspace edge reads as a collision even when the rects barely miss.
      const o = { x: o0.x - OBSTACLE_AIR, y: o0.y - OBSTACLE_AIR, w: o0.w + OBSTACLE_AIR * 2, h: o0.h + OBSTACLE_AIR * 2 };
      const a = overlapArea(frame, o);
      if (a > 0) {
        area += a;
        count += 1;
      }
    }
    const distance = Math.hypot(frame.x - idealX, frame.y - idealY);
    return [area, count, distance];
  };

  let best: GatherRect = { x: idealX, y: idealY, w: frameW, h: frameH };
  let bestScore = penalty(best);
  const consider = (x: number, y: number) => {
    const candidate = { x, y, w: frameW, h: frameH };
    const score = penalty(candidate);
    if (tupleCompare(score, bestScore) < 0) {
      best = candidate;
      bestScore = score;
    }
  };

  if (avail) {
    const fitsW = frameW <= avail.w;
    const fitsH = frameH <= avail.h;
    const minX = avail.x;
    const minY = avail.y;
    const maxX = avail.x + Math.max(0, avail.w - frameW);
    const maxY = avail.y + Math.max(0, avail.h - frameH);
    const clampedIdealX = fitsW ? Math.min(maxX, Math.max(minX, idealX)) : idealX;
    const clampedIdealY = fitsH ? Math.min(maxY, Math.max(minY, idealY)) : idealY;

    const xs = new Set<number>([clampedIdealX]);
    const ys = new Set<number>([clampedIdealY]);
    const clampX = (x: number) => fitsW ? Math.min(maxX, Math.max(minX, x)) : x;
    const clampY = (y: number) => fitsH ? Math.min(maxY, Math.max(minY, y)) : y;
    if (fitsW) {
      for (let x = minX; x < maxX; x += 96) xs.add(x);
      xs.add(maxX);
    }
    if (fitsH) {
      for (let y = minY; y < maxY; y += 96) ys.add(y);
      ys.add(maxY);
    }
    // Coarse grids miss narrow gaps between workspaces. Add the exact
    // edge-aligned candidates around each obstacle; overlap removal is the
    // primary score, so useless clamped duplicates are harmless.
    for (const o of cleanObstacles) {
      xs.add(clampX(o.x - frameW - OBSTACLE_AIR - 1));
      xs.add(clampX(o.x + o.w + OBSTACLE_AIR + 1));
      ys.add(clampY(o.y - frameH - OBSTACLE_AIR - 1));
      ys.add(clampY(o.y + o.h + OBSTACLE_AIR + 1));
    }
    for (const x of xs) for (const y of ys) consider(x, y);

    // If the visible canvas is genuinely full, prefer clean space below it
    // over covering a workspace. Scan far enough to clear the lowest known
    // obstacle rather than giving up after a fixed three rows. The camera
    // choreography reveals the group immediately after the windows land.
    const below0 = avail.y + avail.h + 48;
    const step = Math.max(120, frameH * 0.55);
    const lowestObstacle = cleanObstacles.reduce((n, o) => Math.max(n, o.y + o.h), avail.y + avail.h);
    for (let y = below0; y <= lowestObstacle + 48 + step; y += step) {
      for (const x of xs) consider(x, y);
    }
    for (const x of xs) consider(x, lowestObstacle + OBSTACLE_AIR + 1);
  }

  // Canvas coordinates are continuous, but layout structure should land on
  // whole flow pixels; fractional card edges read as softness at high zoom.
  // The 14px obstacle air gap absorbs the sub-pixel rounding shift.
  best = { ...best, x: Math.round(best.x), y: Math.round(best.y) };

  const xOffsets: number[] = [];
  const yOffsets: number[] = [];
  {
    let x = best.x + GATHER_PAD_X;
    for (let c = 0; c < cols; c++) {
      xOffsets[c] = x;
      x += colW[c] + GATHER_GAP;
    }
    let y = best.y + GATHER_PAD_TOP;
    for (let r = 0; r < rows; r++) {
      yOffsets[r] = y;
      y += rowH[r] + GATHER_GAP;
    }
  }

  const placements = ordered.map((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      id: it.id,
      // Left/top alignment keeps column edges and title bars scanable; the
      // per-column/row measurement is what removes the old excess whitespace.
      x: xOffsets[col],
      y: yOffsets[row],
      row,
      col,
    };
  });

  return { placements, frame: best, cols, rows };
}
