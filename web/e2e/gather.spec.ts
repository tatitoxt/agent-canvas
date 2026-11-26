import { test, expect } from "./fixtures.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

async function boot(page: import("@playwright/test").Page) {
  const { port, token, vault } = stack();
  await page.addInitScript((v) => localStorage.setItem("cv-vault-dir", v), vault);
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
}

test("gather grids into view and undo restores positions + drops the frame", async ({ page }) => {
  await boot(page);
  const scattered = await page.evaluate(() => {
    const put = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));
    const panelNodes = { main: {
      "panel-inbox": { panel: "inbox", x: 2800, y: 1800, w: 560, h: 360 },
      "panel-automations": { panel: "automations", x: 3800, y: 2600, w: 520, h: 380 },
      "panel-loops": { panel: "loops", x: 4700, y: 3400, w: 480, h: 330 },
      "panel-tickets": { panel: "tickets", x: 5600, y: 4200, w: 420, h: 300 },
    } };
    put("cv-panelnodes", panelNodes);
    return { panelNodes };
  });
  await page.reload();
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".react-flow__node-panel")).toHaveCount(4, { timeout: 8_000 });
  await page.locator("button[title*='Gather']").first().click();
  await page.waitForTimeout(1000);
  const gathered = await page.evaluate(() => ({
    panels: JSON.parse(localStorage.getItem("cv-panelnodes") ?? "{}").main,
  }));
  const frames = await page.locator(".react-flow__node-shape").count();
  console.log("G2 scattered:", JSON.stringify(scattered), "gathered:", JSON.stringify(gathered), "frames:", frames);
  expect(frames).toBeGreaterThan(0);
  expect(gathered).not.toEqual(scattered);
  const rects = [
    ...Object.values(gathered.panels).map((n: any) => ({ x: n.x, y: n.y, w: n.w ?? 320, h: n.h ?? 420 })),
  ];
  expect(rects).toHaveLength(4);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const overlapX = a.x < b.x + b.w && a.x + a.w > b.x;
      const overlapY = a.y < b.y + b.h && a.y + a.h > b.y;
      expect(overlapX && overlapY, `cards ${i} and ${j} must not overlap`).toBe(false);
    }
  }
  const visible = await page.evaluate(() => {
    const flow = document.querySelector(".react-flow")!;
    const viewport = document.querySelector(".react-flow__viewport")!;
    const matrix = new DOMMatrix(getComputedStyle(viewport).transform);
    const bounds = flow.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, scaleX: matrix.a, scaleY: matrix.d, x: matrix.e, y: matrix.f };
  });
  for (const r of rects) {
    const left = visible.x + r.x * visible.scaleX;
    const top = visible.y + r.y * visible.scaleY;
    const right = left + r.w * visible.scaleX;
    const bottom = top + r.h * visible.scaleY;
    expect(left, "gathered cards stay inside the visible canvas left edge").toBeGreaterThanOrEqual(-2);
    expect(top, "gathered cards stay inside the visible canvas top edge").toBeGreaterThanOrEqual(-2);
    expect(right, "gathered cards stay inside the visible canvas right edge").toBeLessThanOrEqual(visible.width + 2);
    expect(bottom, "gathered cards stay inside the visible canvas bottom edge").toBeLessThanOrEqual(visible.height + 2);
  }
  // undo via the topbar button
  const undoBtn = page.locator("button[title*='Undo grouping']").first();
  await expect(undoBtn).toBeVisible({ timeout: 4_000 });
  await undoBtn.click();
  await page.waitForTimeout(900);
  const restored = await page.evaluate(() => ({
    panels: JSON.parse(localStorage.getItem("cv-panelnodes") ?? "{}").main,
  }));
  const framesAfter = await page.locator(".react-flow__node-shape").count();
  console.log("G2 restored:", JSON.stringify(restored), "framesAfter:", framesAfter);
  expect(framesAfter).toBe(0);
  for (const id of Object.keys(scattered.panelNodes.main)) {
    expect(restored.panels[id].x).toBe(scattered.panelNodes.main[id].x);
    expect(restored.panels[id].y).toBe(scattered.panelNodes.main[id].y);
  }
});
