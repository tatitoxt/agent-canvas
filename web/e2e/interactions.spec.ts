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

async function spawnTerm(page: import("@playwright/test").Page) {
  await page.locator("button[title='Terminal — spawn a plain shell']").first().click();
  await page.waitForTimeout(1500);
}

test("click on an agent card selects it — no drawer duplicate appears", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  const node = page.locator(".react-flow__node-agent, .react-flow__node").first();
  const b = await node.boundingBox();
  if (!b) throw new Error("no node");
  await page.mouse.click(b.x + 30, b.y + 30);
  await page.waitForTimeout(700);
  await expect(page.locator(".react-flow__node.selected").first()).toBeVisible({ timeout: 4_000 });
  // the bottom-right drawer must NOT open on plain click
  expect(await page.locator(".xterm").count()).toBe(0);
});

test("double-click pops the terminal out in-place as a canvas card", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  const node = page.locator(".react-flow__node-agent").first();
  const b = await node.boundingBox();
  if (!b) throw new Error("no agent node");
  await page.mouse.dblclick(b.x + 30, b.y + 12);
  await page.waitForTimeout(1200);
  await expect(page.locator(".react-flow__node-term").first()).toBeVisible({ timeout: 5_000 });
});

test("pin to the screen docks a panel at the right edge, visible and persisted", async ({ page }) => {
  await boot(page);
  // Settings is the cheapest reliable panel — no vault or repo needed.
  await page.locator("button[title='Settings']").first().click();
  const panel = page.locator(".react-flow__node-panel").first();
  await expect(panel).toBeVisible({ timeout: 6_000 });
  // cv-panelnodes is keyed per-board: { [board]: { [panelId]: {x,y,w,h} } }.
  const readPersisted = () =>
    page.evaluate(() => {
      const all = JSON.parse(localStorage.getItem("cv-panelnodes") ?? "{}");
      return Object.values(all)[0] ?? {};
    });
  const before = await readPersisted();
  const ids = Object.keys(before);
  expect(ids.length).toBeGreaterThan(0);
  const id = ids[0];

  // Deska-style window menu: right-click the card → "Pin to the screen".
  const b = await panel.boundingBox();
  if (!b) throw new Error("panel has no box");
  await page.mouse.click(b.x + b.width / 2, b.y + 12, { button: "right" });
  const pinRow = page.locator("button", { hasText: "Pin to the screen" }).first();
  await expect(pinRow).toBeVisible({ timeout: 4_000 });
  await pinRow.click();
  await page.waitForTimeout(800);

  // 1) Persisted: the docked position is committed to cv-panelnodes and
  //    differs from where the card spawned.
  const after = await readPersisted();
  expect(after[id]).toBeDefined();
  expect({ x: after[id].x, y: after[id].y }).not.toEqual({ x: before[id].x, y: before[id].y });

  // 2) Visible and flush against the right edge of the viewport: at the
  //    boot viewport the dock math targets screen x = innerWidth - w - 20,
  //    y = 20 — allow slack for zoom drift, but it must sit in the
  //    top-right quadrant hugging the edge.
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  const vw = await page.evaluate(() => window.innerWidth);
  expect(box!.x + box!.width).toBeGreaterThan(vw - 120);
  expect(box!.y).toBeLessThan(160);
  await expect(panel).toBeVisible();

  // 3) Survives a reload: same persisted position, card mounted again.
  await page.reload();
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  const reloaded = await readPersisted();
  expect(reloaded[id]).toBeDefined();
  expect(reloaded[id].x).toBeCloseTo(after[id].x, 0);
  expect(reloaded[id].y).toBeCloseTo(after[id].y, 0);
  await expect(page.locator(".react-flow__node-panel").first()).toBeVisible({ timeout: 6_000 });
});

