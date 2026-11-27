import { test, expect } from "./fixtures.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

async function boot(page: import("@playwright/test").Page) {
  const { port, token } = stack();
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
}

async function openLoops(page: import("@playwright/test").Page) {
  await page.locator("button[title='Tools — panels, board ops, capture']").click();
  await page.getByRole("button", { name: "Loops", exact: true }).click();
  const panel = page.locator('.react-flow__node-panel [data-panel="loops"]').first();
  await expect(panel).toBeVisible();
  return panel;
}

test("automation guardrails update and saved automation can be removed", async ({ page }) => {
  await boot(page);
  await page.locator("button[title='Automations']").click();
  const panel = page.locator('.react-flow__node-panel [data-panel="automations"]').first();
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: "+ new automation" }).click();
  await panel.getByPlaceholder("name — e.g. nightly audit").fill("E2E disposable automation");
  await panel.getByPlaceholder("prompt the agent receives on run").fill("Do not run; verify this saved prompt appears.");
  await panel.locator("select").nth(0).selectOption("bash");
  await panel.getByPlaceholder("repeat every N minutes (empty = manual)").fill("120");
  await panel.getByRole("button", { name: "save automation" }).click();

  await expect(panel.getByText("E2E disposable automation", { exact: true })).toBeVisible();
  await expect(panel.getByText("Do not run; verify this saved prompt appears.", { exact: true })).toBeVisible();
  await expect(panel.getByText(/every 120m/)).toBeVisible();
  await panel.getByRole("button", { name: "delete" }).click();
  await expect(panel.getByText("No automations yet")).toBeVisible();

  await panel.locator("button[title^='automation guardrails']").click();
  const guardrailSelects = panel.locator("select");
  await expect(guardrailSelects).toHaveCount(7);
  await guardrailSelects.nth(5).selectOption("skip");
  await expect(guardrailSelects.nth(5)).toHaveValue("skip");
});

test("loop template saves, pauses, resumes and deletes on the active board", async ({ page }) => {
  await boot(page);
  const panel = await openLoops(page);

  await panel.getByRole("button", { name: "Test watchdog" }).click();
  await expect(panel.getByPlaceholder("the instruction the agent receives")).toHaveValue(
    "Run the test suite. If anything fails, fix it before continuing.",
  );
  await panel.getByPlaceholder("every N minutes").fill("120");
  await panel.getByRole("button", { name: "start loop" }).click();

  await expect(panel.getByText("every 120m")).toBeVisible();
  await panel.getByRole("button", { name: "pause" }).click();
  await expect(panel.getByRole("button", { name: "resume" })).toBeVisible();
  await panel.getByRole("button", { name: "resume" }).click();
  await expect(panel.getByRole("button", { name: "pause" })).toBeVisible();
  await panel.getByRole("button", { name: "delete" }).click();
  await expect(panel.getByText("No loops on this board")).toBeVisible();
});
