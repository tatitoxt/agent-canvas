import { test, expect } from "./fixtures.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

test("Pause/Resume all closes Tools and reports neutral feedback", async ({ page }) => {
  const { port, token } = stack();
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });

  await page.locator("button[title='Terminal — spawn a plain shell']").first().click();
  await expect(page.locator(".agent-card").first()).toBeVisible({ timeout: 8_000 });

  const notices = page.locator(".cv-toast-in");
  const tools = page.getByRole("dialog", { name: "Tools panel" });
  await page.locator("button[title^='Tools —']").click();
  await tools.getByRole("button", { name: "Pause all" }).click();
  await expect(tools).toBeHidden();
  await expect(notices.filter({ hasText: "paused 1 agents" })).toBeVisible({ timeout: 5_000 });
  await expect(notices.filter({ hasText: "error" })).toHaveCount(0);

  await page.locator("button[title^='Tools —']").click();
  await page.getByRole("dialog", { name: "Tools panel" }).getByRole("button", { name: "Resume all" }).click();
  await expect(tools).toBeHidden();
  await expect(notices.filter({ hasText: "resumed 1 agents" })).toBeVisible({ timeout: 5_000 });
  await expect(notices.filter({ hasText: "error" })).toHaveCount(0);
});
