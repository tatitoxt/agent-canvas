import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

async function boot(page: import("@playwright/test").Page) {
  const { port, token, vault } = stack();
  await page.addInitScript((v) => localStorage.setItem("cv-vault-dir", v), vault);
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  return { port, token, vault };
}

test("offline demo does not loop while React Flow reports selection", async ({ page }) => {
  const updateDepthErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Maximum update depth exceeded")) {
      updateDepthErrors.push(message.text());
    }
  });
  const { port } = stack();
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  expect(updateDepthErrors, "selection updates must settle without a React render loop").toEqual([]);
});

test("app boots connected against a live daemon", async ({ page }) => {
  await boot(page);
  // Connected boards render the rail chrome and the bottom dock.
  await expect(page.locator("button[title*='New task']").first()).toBeVisible();
});

test("spawn chooser opens and a Terminal agent lands on the canvas", async ({ page }) => {
  await boot(page);
  await page.locator("button[title*='New task']").first().click();
  // CLI grid appears with the official choices (exact title — the rail has
  // its own 'Terminal — spawn a plain shell' quick button).
  await expect(page.locator("text=Spawn an agent")).toBeVisible();
  await page.locator("button[title='Terminal']").click();
  await page.locator("button", { hasText: "+ spawn" }).last().click();
  // The agent card appears on the board.
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 10_000 });
});

test("vault panel opens and a new note lands on disk", async ({ page }) => {
  const { vault } = await boot(page);
  await page.locator("button[title*='your real vault']").first().click();
  await expect(page.locator("button", { hasText: "+ note" }).first()).toBeVisible({ timeout: 8_000 });
  await page.locator("button", { hasText: "+ note" }).first().click();
  const input = page.locator("input[placeholder='folder/note name']").first();
  await input.fill("e2e-check");
  await input.press("Enter");
  // The daemon wrote the file inside the vault directory.
  await expect.poll(() => existsSync(join(vault, "e2e-check.md")), { timeout: 8_000 }).toBe(true);
});

test("Add to Board pins the active Obsidian note as a live canvas window", async ({ page }) => {
  await boot(page);
  await page.locator("button[title*='your real vault']").first().click();
  await page.locator("button", { hasText: "+ note" }).first().click();
  const name = `e2e-board-${Date.now()}`;
  const input = page.locator("input[placeholder='folder/note name']").first();
  await input.fill(name);
  await input.press("Enter");
  await page.getByRole("button", { name: "Source" }).click();
  const source = page.locator("textarea").last();
  await source.fill(`# ${name}\n\n**Live formatted note** with [[Missing target]].`);
  await page.getByRole("button", { name: /save to vault/ }).click();
  const add = page.locator("button", { hasText: "Add to Board" }).first();
  await expect(add).toBeVisible({ timeout: 8_000 });
  await add.click();
  await expect(page.locator(".react-flow__node-panel [data-panel='vault']")).toHaveCount(0, { timeout: 8_000 });
  await expect(page.locator(".react-flow__node-md").filter({ hasText: name })).toBeVisible({ timeout: 8_000 });
  const noteWindow = page.locator(".react-flow__node-md").filter({ hasText: name });
  await expect(noteWindow.locator("strong", { hasText: "Live formatted note" })).toBeVisible();
  await expect(noteWindow.locator('a[title="Missing target (not created yet)"]')).toBeVisible();
});

test("panels mount as canvas nodes and close again", async ({ page }) => {
  await boot(page);
  const nodes = page.locator(".react-flow__node");
  const before = await nodes.count();
  await page.locator("button[title*='your real vault']").first().click();
  // The vault panel mounts as a canvas node of type panel.
  await expect(page.locator(".react-flow__node-panel").first()).toBeVisible({ timeout: 8_000 });
  expect(await nodes.count()).toBeGreaterThan(before);
  // Its close button unmounts the node again.
  await page.locator(".react-flow__node-panel button[title*='close' i]").first().click();
  await expect(page.locator(".react-flow__node-panel")).toHaveCount(0, { timeout: 8_000 });
});

test("inbox panel opens from the rail", async ({ page }) => {
  await boot(page);
  await page.locator("button[title^='Notifications']").first().click();
  // Empty-state or approval rows — the panel itself must render.
  await expect(page.locator("text=/inbox|approval|nothing|quiet/i").first()).toBeVisible({ timeout: 8_000 });
});
