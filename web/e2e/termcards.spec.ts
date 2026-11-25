import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

async function boot(page: import("@playwright/test").Page) {
  const { port, token, vault } = stack();
  await page.addInitScript((v) => localStorage.setItem("cv-vault-dir", v), vault);
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  return { port, token, vault };
}

async function spawnTerm(page: import("@playwright/test").Page) {
  await page.locator("button[title='Terminal — spawn a plain shell']").first().click();
  await page.waitForTimeout(1500);
}

async function openDrawer(page: import("@playwright/test").Page) {
  const node = page.locator(".react-flow__node").first();
  const openTerminal = node.locator("[title='Open terminal']");
  await expect(openTerminal).toBeVisible({ timeout: 5_000 });
  await openTerminal.click();
  await page.waitForTimeout(900);
}

test("pop out creates a canvas term card; put back returns it to the drawer", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  await openDrawer(page);
  const popBtn = page.locator("button[title='pop out onto the canvas as a card']").first();
  await expect(popBtn).toBeVisible({ timeout: 5_000 });
  await popBtn.click();
  await page.waitForTimeout(900);
  const termCard = page.locator(".react-flow__node-term").first();
  await expect(termCard).toBeVisible({ timeout: 5_000 });
  // put back — the card closes and the terminal lives in the drawer again
  await termCard.locator("button[title*='Put back']").first().click();
  await page.waitForTimeout(700);
  expect(await page.locator(".react-flow__node-term").count()).toBe(0);
});

test("shift+click multi-select selects two nodes", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  await spawnTerm(page);
  await page.waitForTimeout(1500);
  const nodes = page.locator(".react-flow__node");
  expect(await nodes.count()).toBeGreaterThanOrEqual(2);
  const b0 = await nodes.nth(0).boundingBox();
  const b1 = await nodes.nth(1).boundingBox();
  // Slow CI runners: nodes settle late and selection state lags the click.
  // Re-measure right before clicking and let the assertion retry.
  await page.keyboard.down("Shift");
  const c0 = await nodes.nth(0).boundingBox();
  await page.mouse.click(c0!.x + 20, c0!.y + 12);
  const c1 = await nodes.nth(1).boundingBox();
  await page.mouse.click(c1!.x + 20, c1!.y + 12);
  await page.keyboard.up("Shift");
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2, { timeout: 6_000 });
});

test("split right shows two live xterm panes in the drawer", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  await openDrawer(page);
  const splitBtn = page.locator("button[title*='split right']").first();
  await expect(splitBtn).toBeVisible({ timeout: 5_000 });
  await splitBtn.click();
  await page.waitForTimeout(900);
  expect(await page.locator(".xterm").count()).toBe(2);
});
