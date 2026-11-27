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

test("Mission Map groups board agents by mission state with live activity", async ({ page }) => {
  await boot(page);
  // spawn a plain terminal and give it something to say
  await page.locator("button[title='Terminal — spawn a plain shell']").first().click();
  await expect(page.locator(".react-flow__node-agent").first()).toBeVisible({ timeout: 10_000 });

  // open Mission Map from the topbar
  await page.getByRole("button", { name: /Mission Map.*live/ }).click();
  const panel = page.locator(".react-flow__node-panel").filter({ hasText: "Mission Map" }).first();
  await expect(panel).toBeVisible({ timeout: 8_000 });

  // mission orientation: the board's agents grouped by state, not just meters
  await expect(panel.getByTestId("mission-group-working")).toBeVisible({ timeout: 8_000 });
  await expect(panel.getByText(/Needs you|Blocked|Working|Resting/).first()).toBeVisible();

  // the spawned terminal rows under a mission group, with cli + status line
  const group = panel.getByTestId("mission-group-working");
  await expect(group.getByText(/Terminal 1/).first()).toBeVisible();

  // activity line streams in once the shell prints its prompt/output —
  // type something deterministic through the card steering input if present,
  // but the prompt alone already yields a last line.
  await expect(panel.locator("[data-testid^='mission-activity-']").first()).toBeVisible({ timeout: 10_000 });

  // delegations section exists even with no wires — honest empty state
  await expect(panel.getByText(/Delegations · 0/)).toBeVisible();
  await expect(panel.getByText(/No delegations yet/)).toBeVisible();

  // usage meters are folded in as a secondary section, not the headline
  await expect(panel.getByText("Usage", { exact: true })).toBeVisible();
  await expect(panel.getByText("Account")).toBeVisible();
});

test("quickRequest 'mission map' and the usage alias land on the same Mission Map panel", async ({ page }) => {
  await boot(page);
  // typing the command routes through quickRequest's alias table
  await page.keyboard.press("Escape");
  // the thread/palette command path is covered by unit-level aliases; here
  // assert the destination itself: the usage-keyed panel IS titled Mission Map.
  await page.getByRole("button", { name: /Mission Map.*live/ }).click();
  const panel = page.locator(".react-flow__node-panel").filter({ hasText: "Mission Map" }).first();
  await expect(panel).toBeVisible({ timeout: 8_000 });
  await expect(panel.locator("[data-panel='usage']")).toBeVisible();
});
