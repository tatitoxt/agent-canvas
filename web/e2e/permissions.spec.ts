import { test, expect } from "./fixtures.mjs";
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

/** Fresh control connection — the snapshot is the daemon's own state of
 * record: agent permission levels and held (unapproved) inputs. */
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

test("permission lifecycle: supervised gate approve/deny, ladder cycle, daemon state", async ({ page }) => {
  await boot(page);
  await page.locator("button[title='Terminal — spawn a plain shell']").first().click();
  const card = page.locator(".react-flow__node-agent").first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  const agentId = await card.getAttribute("data-id");
  expect(agentId).toBeTruthy();

  // Fresh spawns land on the most restrictive rung.
  const pill = card.locator("button[title^='Permission level']");
  await expect(pill).toHaveText("supervised");

  // Terminal drawer — where command output is observed.
  const rect = await card.boundingBox();
  await page.mouse.click(rect!.x + 30, rect!.y + 30, { button: "right" });
  await page.locator(".cv-menu").getByRole("button", { name: "open terminal" }).click();
  const rows = page.locator(".terminal-drawer .xterm-rows");
  await expect(rows).toBeVisible({ timeout: 8_000 });

  const steer = async (command: string) => {
    const input = card.locator("[data-testid='agent-steering-input']");
    await input.fill(command);
    await input.press("Enter");
  };
  const uniq = Date.now().toString(36);

  // Benign input is NOT gated even when supervised — the gate is selective.
  await steer(`echo benign-${uniq}`);
  await expect(rows).toContainText(`benign-${uniq}`, { timeout: 8_000 });

  // Sensitive input IS held: no execution, and the daemon's own snapshot
  // records the held line under approvals.
  await steer(`rm -rf /tmp/ac-x1; echo gated-one-${uniq}`);
  await page.waitForTimeout(1_500);
  await expect(rows).not.toContainText(`gated-one-${uniq}`);
  let snap = await snapshotOf();
  expect(snap?.approvals?.[agentId!], "daemon must hold the sensitive input").toContain("rm -rf");

  // Approve through the live Inbox panel — the stashed payload executes.
  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  await dock.getByRole("button", { name: "Add Inbox to canvas" }).click();
  const inbox = page.locator(".react-flow__node-panel [data-panel='inbox']").first();
  await expect(inbox).toBeVisible();
  await expect(inbox).toContainText("rm -rf", { timeout: 8_000 });
  await inbox.getByRole("button", { name: "allow", exact: true }).click();
  await expect(rows).toContainText(`gated-one-${uniq}`, { timeout: 8_000 });
  snap = await snapshotOf();
  expect(snap?.approvals?.[agentId!], "approval consumed the held input").toBeUndefined();

  // Deny: the stashed payload is dropped — it never reaches the PTY.
  await steer(`rm -rf /tmp/ac-x2; echo gated-two-${uniq}`);
  await expect(inbox).toContainText("rm -rf", { timeout: 8_000 });
  await inbox.getByRole("button", { name: "deny", exact: true }).click();
  await page.waitForTimeout(1_500);
  await expect(rows).not.toContainText(`gated-two-${uniq}`);
  snap = await snapshotOf();
  expect(snap?.approvals?.[agentId!]).toBeUndefined();

  // Ladder up, verifying each rung in the daemon's own state.
  const expectLevel = async (level: string) => {
    await expect.poll(async () => {
      const s = await snapshotOf();
      return s?.agents?.find?.((a: any) => a.agent_id === agentId || a.id === agentId)?.permission
        ?? s?.agents?.[agentId!]?.permission;
    }, { timeout: 6_000 }).toBe(level);
  };
  await pill.click(); // supervised → auto_accept
  await expectLevel("auto_accept");
  await pill.click(); // auto_accept → auto
  await expectLevel("auto");

  // At auto the same sensitive input runs immediately — no approval roundtrip.
  await steer(`rm -rf /tmp/ac-x3; echo free-three-${uniq}`);
  await expect(rows).toContainText(`free-three-${uniq}`, { timeout: 8_000 });
  snap = await snapshotOf();
  expect(snap?.approvals?.[agentId!]).toBeUndefined();

  await pill.click(); // auto → full
  await expectLevel("full");

  // Back down the ladder — the gate re-engages.
  await pill.click(); // full → supervised (cycles)
  await expectLevel("supervised");
  await steer(`rm -rf /tmp/ac-x4; echo gated-four-${uniq}`);
  await page.waitForTimeout(1_500);
  await expect(rows).not.toContainText(`gated-four-${uniq}`);
  snap = await snapshotOf();
  expect(snap?.approvals?.[agentId!], "gate re-engaged after cycling back").toContain("rm -rf");
});
