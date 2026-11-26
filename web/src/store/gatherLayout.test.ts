import { describe, expect, it } from "vitest";
import { planGatherLayout, type GatherRect } from "./gatherLayout";

const vp = { left: 0, top: 0, right: 1600, bottom: 1000 };
const overlap = (a: GatherRect, b: GatherRect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

describe("planGatherLayout", () => {
  it("packs mixed card sizes by column/row instead of the global maximum cell", () => {
    const plan = planGatherLayout([
      { id: "a", x: 0, y: 0, w: 460, h: 120 },
      { id: "b", x: 500, y: 0, w: 320, h: 120 },
      { id: "c", x: 0, y: 500, w: 460, h: 420 },
      { id: "d", x: 500, y: 500, w: 320, h: 420 },
    ], vp)!;
    expect(plan.cols).toBe(2);
    expect(plan.rows).toBe(2);
    // 460 + 24 + 320 + side padding = 852; the old max-cell grid was 952 wide.
    expect(plan.frame.w).toBe(852);
    // 120 + 24 + 420 + header/bottom padding = 640; old max-cell grid was 940 high.
    expect(plan.frame.h).toBe(640);
    const a = plan.placements.find((p) => p.id === "a")!;
    const c = plan.placements.find((p) => p.id === "c")!;
    expect(c.y - a.y).toBe(120 + 24);
  });

  it("keeps the group inside the chrome-safe viewport when it is empty", () => {
    const plan = planGatherLayout([
      { id: "a", x: 900, y: 600, w: 460, h: 220 },
    ], vp)!;
    expect(plan.frame.x).toBeGreaterThanOrEqual(72);
    expect(plan.frame.y).toBeGreaterThanOrEqual(104);
    expect(plan.frame.x + plan.frame.w).toBeLessThanOrEqual(1600 - 56);
    expect(plan.frame.y + plan.frame.h).toBeLessThanOrEqual(1000 - 88);
    // 52px header band means the first window never collides with the label.
    expect(plan.placements[0].y - plan.frame.y).toBe(52);
  });

  it("avoids stationary obstacles rather than covering them", () => {
    const obstacle = { x: 500, y: 250, w: 620, h: 430 };
    const plan = planGatherLayout([
      { id: "a", x: 0, y: 0, w: 460, h: 220 },
      { id: "b", x: 520, y: 0, w: 460, h: 220 },
    ], vp, [obstacle])!;
    expect(overlap(plan.frame, obstacle)).toBe(0);
  });

  it("uses spatial reading order rather than insertion order", () => {
    const plan = planGatherLayout([
      { id: "bottom-right", x: 900, y: 600, w: 300, h: 200 },
      { id: "top-right", x: 900, y: 100, w: 300, h: 200 },
      { id: "top-left", x: 100, y: 100, w: 300, h: 200 },
      { id: "bottom-left", x: 100, y: 600, w: 300, h: 200 },
    ], vp)!;
    expect(plan.placements.map((p) => p.id)).toEqual([
      "top-left", "top-right", "bottom-left", "bottom-right",
    ]);
  });

  it("fits multiple columns using measured mixed widths rather than the global max", () => {
    const narrow = { left: 0, top: 0, right: 1000, bottom: 1000 };
    const plan = planGatherLayout([
      { id: "a", x: 0, y: 0, w: 460, h: 160 },
      { id: "b", x: 500, y: 0, w: 320, h: 160 },
      { id: "c", x: 0, y: 300, w: 460, h: 160 },
      { id: "d", x: 500, y: 300, w: 320, h: 160 },
    ], narrow)!;
    expect(plan.frame.w).toBe(852);
    expect(plan.cols).toBe(2);
  });

  it("reduces columns when the viewport is too narrow for the ideal grid", () => {
    const narrow = { left: 0, top: 0, right: 700, bottom: 1000 };
    const plan = planGatherLayout(Array.from({ length: 4 }, (_, i) => ({
      id: `n${i}`, x: i * 500, y: 0, w: 460, h: 220,
    })), narrow)!;
    expect(plan.cols).toBe(1);
    expect(plan.frame.x + plan.frame.w).toBeLessThanOrEqual(700 - 56 + 0.01);
  });
});
