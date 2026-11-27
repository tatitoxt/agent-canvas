import { test, expect } from "./fixtures.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import WebSocket from "ws";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

async function savedPosition(port: number, token: string, nodeId: string): Promise<[number, number]> {
  return new Promise((resolvePosition, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("daemon snapshot did not include the pinned note position"));
    }, 5_000);
    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    ws.on("message", (raw) => {
      let message: { type?: string; layout?: Record<string, [number, number]> };
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type !== "snapshot") return;
      clearTimeout(timeout);
      ws.close();
      const position = message.layout?.[nodeId];
      if (!position) reject(new Error(`snapshot is missing node ${nodeId}`));
      else resolvePosition(position);
    });
  });
}

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

  // Record the persisted board coordinates (not screen pixels, which change
  // when fitView chooses a different camera framing after reload).
  const nodeId = await noteWindow.getAttribute("data-id");
  expect(nodeId).toBeTruthy();
  const { port, token } = stack();
  const before = await savedPosition(port, token, nodeId!);

  // 3. Reload — the live window must persist (board membership, position,
  //    and re-hydrated live content from the vault).
  await page.reload();
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  const restored = page.locator(".react-flow__node-md").filter({ hasText: name });
  await expect(restored, "md note window must survive a reload").toBeVisible({ timeout: 10_000 });
  await expect(restored.locator("strong", { hasText: "persistent bold" }), "live content must re-hydrate after reload").toBeVisible({ timeout: 10_000 });
  await expect(restored).toHaveAttribute("data-id", nodeId!);
  const after = await savedPosition(port, token, nodeId!);
  expect(after[0], `board x changed ${before[0]} → ${after[0]}`).toBe(before[0]);
  expect(after[1], `board y changed ${before[1]} → ${after[1]}`).toBe(before[1]);
});
