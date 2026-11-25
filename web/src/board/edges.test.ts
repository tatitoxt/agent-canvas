import { describe, expect, it } from "vitest";
import { absoluteNodePosition, detourPath } from "./edges";

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

describe("absoluteNodePosition", () => {
  it("accumulates positions through nested workspace parents", () => {
    const root = { id: "root", position: { x: 120, y: 80 } };
    const child = { id: "child", parentId: "root", position: { x: 40, y: 25 } };
    const card = { id: "card", parentId: "child", position: { x: 7, y: 9 } };
    const nodes = new Map([[root.id, root], [child.id, child], [card.id, card]]);
    expect(absoluteNodePosition(card, nodes)).toEqual({ x: 167, y: 114 });
  });

  it("uses React Flow's measured absolute position when available", () => {
    const parent = { id: "parent", position: { x: 20, y: 30 } };
    const card = {
      id: "card", parentId: "parent", position: { x: 7, y: 9 },
      internals: { positionAbsolute: { x: 95, y: 115 } },
    };
    const nodes = new Map([[parent.id, parent], [card.id, card]]);
    expect(absoluteNodePosition(card, nodes)).toEqual({ x: 95, y: 115 });
  });
});

function routePoints(path: string): Point[] {
  return [...path.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
    .map(([, x, y]) => ({ x: Number(x), y: Number(y) }));
}

function crosses(a: Point, b: Point, r: Rect): boolean {
  const steps = Math.max(24, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x >= r.x - 14 && x <= r.x + r.w + 14 && y >= r.y - 14 && y <= r.y + r.h + 14) return true;
  }
  return false;
}

function expectClear(path: string, obstacles: Rect[]) {
  const points = routePoints(path);
  expect(points.length).toBeGreaterThan(2);
  for (let i = 1; i < points.length; i++) {
    for (const obstacle of obstacles) expect(crosses(points[i - 1], points[i], obstacle)).toBe(false);
  }
}

describe("detourPath", () => {
  it("routes around multiple cards crossed by a horizontal delegation", () => {
    const obstacles = [
      { x: 130, y: 48, w: 110, h: 120 },
      { x: 250, y: 36, w: 110, h: 140 },
    ];
    const result = detourPath(0, 100, 480, 100, obstacles);
    expectClear(result.path, obstacles);
    expect(result.path).toContain("L");
  });

  it("uses a lateral lane for a vertical edge and works in reverse", () => {
    const obstacles = [{ x: 42, y: 130, w: 116, h: 150 }];
    const result = detourPath(100, 0, 100, 420, obstacles);
    expectClear(result.path, obstacles);
    const reverse = detourPath(100, 420, 100, 0, obstacles);
    expectClear(reverse.path, obstacles);
  });

  it("keeps a clear delegation on its gentle curve", () => {
    const result = detourPath(0, 0, 300, 180, []);
    expect(result.path).toContain("C");
    expect(result.lx).toBe(150);
    expect(result.ly).toBe(90);
  });

  it("places a delegation label in a clear gap between crowded cards", () => {
    const obstacles = [
      { x: 120, y: 35, w: 120, h: 130 },
      { x: 260, y: 35, w: 120, h: 130 },
    ];
    const labelWidth = 180;
    const result = detourPath(0, 100, 500, 100, obstacles, labelWidth);
    const label = { x: result.lx - labelWidth / 2, y: result.ly - 13, w: labelWidth, h: 26 };
    for (const obstacle of obstacles) {
      const overlaps = label.x < obstacle.x + obstacle.w + 4 && label.x + label.w > obstacle.x - 4 &&
        label.y < obstacle.y + obstacle.h + 4 && label.y + label.h > obstacle.y - 4;
      expect(overlaps, "the label chip must not cover a card").toBe(false);
    }
    expectClear(result.path, obstacles);
  });

  it("keeps the label chip off the source and target cards", () => {
    const endpointCards = [{ x: 320, y: 60, w: 140, h: 100 }];
    const result = detourPath(0, 100, 500, 100, [], 180, endpointCards);
    const label = { x: result.lx - 90, y: result.ly - 13, w: 180, h: 26 };
    expect(label.x < 464 && label.x + label.w > 316 && label.y < 164 && label.y + label.h > 56).toBe(false);
  });
});
