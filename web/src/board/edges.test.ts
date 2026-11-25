import { describe, expect, it } from "vitest";
import { detourPath } from "./edges";

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

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
});
