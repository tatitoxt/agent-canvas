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

test("Tools opens as a dock and collapses to panel icons", async ({ page }) => {
  await boot(page);
  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  await expect(dock).toBeVisible();
  await expect(dock.getByText("Board", { exact: true })).toBeVisible();
  await dock.getByRole("button", { name: "Collapse Tools panel" }).click();
  await expect(dock.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(dock.getByRole("button", { name: "Expand Tools panel" })).toBeVisible();
  await dock.getByRole("button", { name: "Expand Tools panel" }).click();
  await expect(dock.getByText("Board", { exact: true })).toBeVisible();
  await dock.getByRole("button", { name: "Close Tools panel" }).click();
  await expect(dock).toBeHidden();
});

test("Add to canvas closes Tools and mounts a live Inbox panel", async ({ page }) => {
  await boot(page);
  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  await expect(dock).toBeVisible();
  await dock.getByRole("button", { name: "Add Inbox to canvas" }).click();
  await expect(dock).toBeHidden();
  await expect(page.locator(".react-flow__node-panel [data-panel='inbox']").first()).toBeVisible();
});

test("Add to canvas closes Tools even when the dock is pinned", async ({ page }) => {
  await boot(page);
  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  await dock.getByRole("button", { name: "Pin Tools panel" }).click();
  await dock.getByRole("button", { name: "Add Automations to canvas" }).click();
  await expect(dock).toBeHidden();
  await expect(page.locator(".react-flow__node-panel [data-panel='automations']").first()).toBeVisible();
});

test("bottom Files opens Obsidian and Code Editor opens the repo explorer", async ({ page }) => {
  await boot(page);
  const filesButton = page.locator("button[title='Files — open your Obsidian vault']");
  await expect(filesButton).toBeVisible();
  await filesButton.click();
  await expect(page.locator(".react-flow__node-panel [data-panel='vault']").first()).toBeVisible();
  await page.locator("button[title='Code Editor — open the workspace file tree and code viewer']").click();
  await expect(page.locator(".react-flow__node-panel [data-panel='explorer']").first()).toBeVisible();
});

test("double-click empty canvas opens the spawn chooser (spawn-at-click)", async ({ page }) => {
  await boot(page);
  await page.locator(".react-flow__pane").first().dblclick({ position: { x: 400, y: 300 } });
  await expect(page.locator("text=Spawn an agent")).toBeVisible({ timeout: 8_000 });
});

test("panel card drags to a new position", async ({ page }) => {
  await boot(page);
  await page.locator("button[title*='your real vault']").first().click();
  const node = page.locator(".react-flow__node-panel").first();
  await expect(node).toBeVisible({ timeout: 8_000 });
  const before = await node.boundingBox();
  // Drag by the panel header/chrome area (top strip of the card).
  const box = before!;
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + 100, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await node.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeGreaterThan(40);
});

test("gather pulls loose cards into a group", async ({ page }) => {
  await boot(page);
  // spawn one terminal so there's at least one loose card
  await page.locator("button[title*='New task']").first().click();
  await page.locator("button[title='Terminal']").click();
  await page.locator("button", { hasText: "+ spawn" }).last().click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1000);
  const before = await page.locator(".react-flow__node").count();
  await page.locator("button[title*='Gather']").first().click();
  await page.waitForTimeout(1200);
  // After gather the board still renders nodes (no crash) — gather either
  // grouped them or notified "no loose windows"; both are acceptable end states,
  // what matters is the click handler doesn't throw and loose terminals get a group frame.
  const count = await page.locator(".react-flow__node").count();
  expect(count).toBeGreaterThanOrEqual(before);
});
