import { describe, expect, it } from "vitest";
import { rectNearViewport } from "./nearViewport";

describe("rectNearViewport", () => {
  it("treats cards inside the activation halo as near", () => {
    expect(rectNearViewport(
      { left: -200, top: 100, right: -1, bottom: 300 },
      240,
      1440,
      900,
    )).toBe(true);
  });

  it("treats fully offscreen cards as far in every direction", () => {
    const viewportWidth = 1440;
    const viewportHeight = 900;
    expect(rectNearViewport({ left: -1000, top: 0, right: -241, bottom: 100 }, 240, viewportWidth, viewportHeight)).toBe(false);
    expect(rectNearViewport({ left: 1681, top: 0, right: 2000, bottom: 100 }, 240, viewportWidth, viewportHeight)).toBe(false);
    expect(rectNearViewport({ left: 0, top: -1000, right: 100, bottom: -241 }, 240, viewportWidth, viewportHeight)).toBe(false);
    expect(rectNearViewport({ left: 0, top: 1141, right: 100, bottom: 1300 }, 240, viewportWidth, viewportHeight)).toBe(false);
  });
});
