import { test, expect } from "./fixtures.mjs";
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

async function openTools(page: import("@playwright/test").Page) {
  for (const t of await page.locator(".cv-toast-in").all()) await t.click().catch(() => {});
  if ((await page.locator("[role='dialog']").count()) === 0) {
    await page.locator("button[title^='Tools —']").click();
    await page.waitForSelector("[role='dialog']", { timeout: 8_000 });
  }
  return page.getByRole("dialog", { name: "Tools panel" });
}

const lastTick = async (page: import("@playwright/test").Page) => {
  const text = await page.locator(".terminal-drawer .xterm-rows").first().innerText();
  const matches = [...text.matchAll(/tick-(\d+)/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) : 0;
};

test("pause all freezes the foreground process, resume restarts it", async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page);
  await spawnTerm(page);
  // open the drawer via the context menu (post-#60 click only selects)
  const node = page.locator(".react-flow__node").first();
  const b = await node.boundingBox();
  await page.mouse.click(b!.x + 30, b!.y + 30, { button: "right" });
  await page.waitForTimeout(400);
  await page.locator("button", { hasText: "open terminal" }).first().click();
  const terminal = page.locator(".terminal-drawer .xterm").first();
  await expect(terminal).toBeVisible({ timeout: 8_000 });

  // a foreground loop printing a counter — run under an EXTERNAL sh so the
  // workload is unambiguously a child process in its own process group
  // (interactive bash executes a bare compound command in-place, which a
  // shell-PID-only SIGSTOP does freeze; that is not the bug being tested).
  await terminal.click();
  await page.keyboard.type("sh -c 'i=0; while true; do i=$((i+1)); echo tick-$i; sleep 0.15; done'");
  await page.keyboard.press("Enter");
  await expect.poll(() => lastTick(page), { timeout: 8_000 }).toBeGreaterThan(2);

  // PAUSE — then let already-emitted bytes drain through the pipe.
  const dock = await openTools(page);
  await dock.getByRole("button", { name: "Pause all" }).click();
  await page.waitForTimeout(900);
  const frozenAt = await lastTick(page);
  await page.waitForTimeout(1100);
  const later = await lastTick(page);
  expect(later, `counter kept printing after Pause all (${frozenAt} -> ${later})`).toBe(frozenAt);

  // RESUME — the counter must advance again.
  const dock2 = await openTools(page);
  await dock2.getByRole("button", { name: "Resume all" }).click();
  await expect.poll(() => lastTick(page), { timeout: 5_000 }).toBeGreaterThan(later);
});
