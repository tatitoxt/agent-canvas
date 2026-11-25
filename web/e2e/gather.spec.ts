import { test, expect } from "@playwright/test";
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
  await page.locator("button[title*='your real vault']").first().click();
  await page.waitForTimeout(700);
  const node = page.locator(".react-flow__node-panel").first();
  await expect(node).toBeVisible({ timeout: 8_000 });
  const readStore = () => page.evaluate(() => {
    const j = JSON.parse(localStorage.getItem("cv-panelnodes") ?? "{}");
    return j.main?.["panel-vault"] ? { x: j.main["panel-vault"].x, y: j.main["panel-vault"].y } : null;
  });
  // drag it somewhere random first
  const b = await node.boundingBox();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + 12);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2 + 200, b!.y + 130, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const scattered = await readStore();
  await page.locator("button[title*='Gather']").first().click();
  await page.waitForTimeout(1000);
  const gathered = await readStore();
  const frames = await page.locator(".react-flow__node-shape").count();
  console.log("G2 scattered:", JSON.stringify(scattered), "gathered:", JSON.stringify(gathered), "frames:", frames);
  expect(frames).toBeGreaterThan(0);
  expect(gathered).not.toEqual(scattered);
  // undo via the topbar button
  const undoBtn = page.locator("button[title*='Undo grouping']").first();
  await expect(undoBtn).toBeVisible({ timeout: 4_000 });
  await undoBtn.click();
  await page.waitForTimeout(900);
  const restored = await readStore();
  const framesAfter = await page.locator(".react-flow__node-shape").count();
  console.log("G2 restored:", JSON.stringify(restored), "framesAfter:", framesAfter);
  expect(framesAfter).toBe(0);
  expect(Math.abs(restored!.x - scattered!.x)).toBeLessThan(5);
  expect(Math.abs(restored!.y - scattered!.y)).toBeLessThan(5);
});
