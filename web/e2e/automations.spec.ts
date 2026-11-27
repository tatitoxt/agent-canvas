import { test, expect } from "./fixtures.mjs";
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

function snapshotOf(): Promise<any> {
  const { port, token } = stack();
  return new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const timer = setTimeout(() => { try { ws.close(); } catch {} res(null); }, 6_000);
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "snapshot") {
          clearTimeout(timer);
          ws.close();
          res(msg);
        }
      } catch { /* binary frames */ }
    };
    ws.onerror = () => { clearTimeout(timer); res(null); };
  });
}

async function boot(page: import("@playwright/test").Page) {
  const { port, token } = stack();
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
}

async function addPanel(page: import("@playwright/test").Page, name: string) {
  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  await dock.getByRole("button", { name: `Add ${name} to canvas` }).click();
  const panel = page.locator(`.react-flow__node-panel [data-panel='${name.toLowerCase()}']`).first();
  await expect(panel).toBeVisible();
  return panel;
}

test("automation lifecycle: create, list, run, guardrail deny vs hold, delete", async ({ page }) => {
  await boot(page);
  const uniq = Date.now().toString(36);
  const panel = await addPanel(page, "Automations");

  // Create — saved automation appears in the list and in daemon state.
  await panel.getByRole("button", { name: /new automation/ }).first().click();
  const name = `e2e-auto-${uniq}`;
  await panel.getByPlaceholder("name — e.g. nightly audit").fill(name);
  await panel.getByPlaceholder("prompt the agent receives on run").fill(`echo auto-prompt-${uniq}`);
  await panel.locator("select").first().selectOption("bash");
  await panel.getByRole("button", { name: "save automation" }).click();
  await expect(panel.getByText(name, { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect
    .poll(async () => (await snapshotOf())?.automations?.some((a: any) => a.name === name), { timeout: 6_000 })
    .toBe(true);

  // Run — the daemon spawns the agent and stamps last_run_at.
  const rowOf = (n: string) =>
    panel.locator("div").filter({ hasText: n }).filter({ has: page.getByRole("button", { name: "run", exact: true }) }).last();
  await rowOf(name).getByRole("button", { name: "run", exact: true }).click();
  await expect
    .poll(async () => (await snapshotOf())?.automations?.find((a: any) => a.name === name)?.last_run_at ?? null, { timeout: 8_000 })
    .not.toBeNull();

  // Guardrail contrast, keyed by prompt content in the daemon's approvals:
  // a HOLD run with a sensitive prompt parks the input for a human; a DENY
  // run drops it — no approvals entry ever appears with that text.
  const holdName = `e2e-hold-${uniq}`;
  const denyName = `e2e-deny-${uniq}`;
  for (const [n, policy] of [[holdName, "hold"], [denyName, "deny"]] as const) {
    await panel.getByRole("button", { name: /new automation|\+ new/ }).first().click();
    await panel.getByPlaceholder("name — e.g. nightly audit").fill(n);
    await panel.getByPlaceholder("prompt the agent receives on run").fill(`sudo -n true; echo ${n}-marker`);
    await panel.locator("select").first().selectOption("bash");
    await panel.locator("select", { hasText: /on gated input/ }).selectOption(policy);
    await panel.locator("select", { hasText: /supervised/i }).selectOption("supervised");
    await panel.getByRole("button", { name: "save automation" }).click();
    await expect(panel.getByText(n, { exact: true })).toBeVisible({ timeout: 8_000 });
  }
  for (const n of [holdName, denyName]) {
    await rowOf(n).getByRole("button", { name: "run", exact: true }).click();
  }
  // The hold automation's sensitive input ends up parked in approvals —
  // content-keyed, so no dependence on agent ids.
  await expect
    .poll(async () => {
      const approvals = (await snapshotOf())?.approvals ?? {};
      return Object.values(approvals).some((line: any) => typeof line === "string" && line.includes(`${holdName}-marker`) || (typeof line === "string" && line.includes("sudo") && line.includes(holdName)));
    }, { timeout: 10_000 })
    .toBe(true);
  // The deny automation's input never waits for anyone.
  await page.waitForTimeout(1_500);
  const approvals = (await snapshotOf())?.approvals ?? {};
  expect(
    Object.values(approvals).filter((line: any) => typeof line === "string" && line.includes(denyName)),
    "deny guardrail must drop the input, never hold it",
  ).toHaveLength(0);

  // Delete — rows and daemon state both drop the automation.
  const targets = [name, holdName, denyName];
  await expect
    .poll(async () => {
      const present: string[] = ((await snapshotOf())?.automations ?? []).map((a: any) => a.name).filter((n: string) => targets.includes(n));
      for (const n of present) {
        const del = rowOf(n).getByRole("button", { name: "delete", exact: true });
        if (await del.isVisible().catch(() => false)) await del.click().catch(() => {});
      }
      return present.length;
    }, { timeout: 12_000 })
    .toBe(0);
});

test("loop lifecycle: create, run now injects instruction, enable/disable, delete", async ({ page }) => {
  await boot(page);
  const uniq = Date.now().toString(36);

  // A live console for the loop to target.
  await page.locator("button[title='Terminal — spawn a plain shell']").first().click();
  const card = page.locator(".react-flow__node-agent").first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  const agentId = await card.getAttribute("data-id");
  const rect = await card.boundingBox();
  await page.mouse.click(rect!.x + 30, rect!.y + 30, { button: "right" });
  await page.locator(".cv-menu").getByRole("button", { name: "open terminal" }).click();
  const rows = page.locator(".terminal-drawer .xterm-rows");
  await expect(rows).toBeVisible({ timeout: 8_000 });

  const panel = await addPanel(page, "Loops");

  // Create — a timer loop far in the future, so only explicit runs fire.
  await panel.getByRole("button", { name: /new loop|start from scratch/i }).first().click();
  const instruction = `echo loop-fired-${uniq}`;
  await panel.getByPlaceholder("the instruction the agent receives").fill(instruction);
  // Target the spawned agent rather than the whole board.
  const targetSelect = panel.locator("select").first();
  await targetSelect.selectOption({ index: 1 });
  await panel.getByPlaceholder("every N minutes").fill("999");
  await panel.getByRole("button", { name: "start loop" }).click();
  await expect(panel.getByText(instruction)).toBeVisible({ timeout: 8_000 });
  await expect
    .poll(async () => (await snapshotOf())?.loops?.some((l: any) => l.instruction === instruction), { timeout: 6_000 })
    .toBe(true);

  // Run now — the instruction is injected into the live PTY and bash runs it.
  const row = panel.locator("div").filter({ hasText: instruction }).filter({ has: page.getByRole("button", { name: "run now" }) }).last();
  await row.getByRole("button", { name: "run now" }).click();
  await expect(rows).toContainText(`loop-fired-${uniq}`, { timeout: 10_000 });
  await expect
    .poll(async () => (await snapshotOf())?.loops?.find((l: any) => l.instruction === instruction)?.last_fired_at ?? null, { timeout: 6_000 })
    .not.toBeNull();

  // Disable/enable — the daemon state flips with each toggle.
  await row.getByRole("button", { name: "pause", exact: true }).click();
  await expect
    .poll(async () => (await snapshotOf())?.loops?.find((l: any) => l.instruction === instruction)?.enabled, { timeout: 6_000 })
    .toBe(false);
  await row.getByRole("button", { name: "resume", exact: true }).click();
  await expect
    .poll(async () => (await snapshotOf())?.loops?.find((l: any) => l.instruction === instruction)?.enabled, { timeout: 6_000 })
    .toBe(true);

  // Delete — gone from the daemon.
  await row.getByRole("button", { name: "delete", exact: true }).click();
  await expect
    .poll(async () => (await snapshotOf())?.loops?.some((l: any) => l.instruction === instruction) ?? false, { timeout: 6_000 })
    .toBe(false);
});
