import { test, expect } from "./fixtures.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

async function boot(page: import("@playwright/test").Page) {
  const { port, token, vault, repo } = stack();
  await page.addInitScript((v) => localStorage.setItem("cv-vault-dir", v), vault);
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  return { port, token, vault, repo };
}

test("Add to Board: popover closes, live note window appears, survives reload", async ({ page }) => {
  await boot(page);
  // Open the vault panel and create a note with formatted content.
  await page.locator("button[title*='your real vault']").first().click();
  await page.locator("button", { hasText: "+ note" }).first().click();
  const name = `e2e-persist-${Date.now()}`;
  const input = page.locator("input[placeholder='folder/note name']").first();
  await input.fill(name);
  await input.press("Enter");
  await page.getByRole("button", { name: "Source" }).click();
  const source = page.locator("textarea").last();
  await source.fill(`# ${name}\n\n**persistent bold** body with [[Missing target]].`);
  await page.getByRole("button", { name: /save to vault/ }).click();

  // The act under audit: Add to Board.
  const add = page.locator("button", { hasText: "Add to Board" }).first();
  await expect(add).toBeVisible({ timeout: 8_000 });
  await add.click();

  // 1. The source popover/panel closes — not both lingering.
  await expect(page.locator(".react-flow__node-panel [data-panel='vault']")).toHaveCount(0, { timeout: 8_000 });
  // 2. A live interactive canvas window appears, rendering formatted content
  //    (bold → <strong>, wikilink → interactive anchor) — not a static dump.
  const noteWindow = page.locator(".react-flow__node-md").filter({ hasText: name });
  await expect(noteWindow).toBeVisible({ timeout: 8_000 });
  await expect(noteWindow.locator("strong", { hasText: "persistent bold" })).toBeVisible();
  await expect(noteWindow.locator('a[title="Missing target (not created yet)"]')).toBeVisible();

  // Where did it land? Record the card's position to compare after reload.
  const before = await noteWindow.boundingBox();
  expect(before).not.toBeNull();

  // 3. Reload — the live window must persist (board membership, position,
  //    and re-hydrated live content from the vault).
  await page.reload();
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  const restored = page.locator(".react-flow__node-md").filter({ hasText: name });
  await expect(restored, "md note window must survive a reload").toBeVisible({ timeout: 10_000 });
  await expect(restored.locator("strong", { hasText: "persistent bold" }), "live content must re-hydrate after reload").toBeVisible({ timeout: 10_000 });
  const after = await restored.boundingBox();
  expect(after).not.toBeNull();
  // Same neighborhood — the daemon restores exact positions; allow small
  // slack for fitView framing differences but never a teleport across the canvas.
  expect(Math.abs(after!.x - before!.x), `x drifted ${before!.x} → ${after!.x}`).toBeLessThan(200);
  expect(Math.abs(after!.y - before!.y), `y drifted ${before!.y} → ${after!.y}`).toBeLessThan(200);
});
