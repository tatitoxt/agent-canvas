import { describe, expect, it } from "vitest";
import { getAgentSpawnPositions } from "./board";

describe("agent spawn layout", () => {
  const viewport = { left: 0, top: 0, right: 1440, bottom: 900 };
  const size = { w: 460, h: 260 };

  it("keeps a multi-agent spawn visible and separates every card", () => {
    const points = getAgentSpawnPositions(4, viewport, [], size);
    expect(points).toHaveLength(4);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(viewport.left);
      expect(p.y).toBeGreaterThanOrEqual(viewport.top);
      expect(p.x + size.w).toBeLessThanOrEqual(viewport.right);
      expect(p.y + size.h).toBeLessThanOrEqual(viewport.bottom);
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j];
        expect(a.x + size.w + 18 <= b.x || b.x + size.w + 18 <= a.x || a.y + size.h + 18 <= b.y || b.y + size.h + 18 <= a.y).toBe(true);
      }
    }
  });

  it("moves the spawn origin back inside the viewport", () => {
    const [point] = getAgentSpawnPositions(1, viewport, [], size, { x: 5000, y: -900 });
    expect(point.x).toBeLessThanOrEqual(viewport.right - size.w - 12);
    expect(point.y).toBeGreaterThanOrEqual(viewport.top + 12);
  });

  it("finds free space around existing agent cards", () => {
    const points = getAgentSpawnPositions(2, viewport, [{ x: 480, y: 320, ...size }], size);
    expect(points.every((p) => p.x + size.w + 18 <= 480 || 480 + size.w + 18 <= p.x || p.y + size.h + 18 <= 320 || 320 + size.h + 18 <= p.y)).toBe(true);
  });
});
