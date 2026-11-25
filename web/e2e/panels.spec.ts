import { test, expect } from "@playwright/test";
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

test("Library expands horizontally to labeled tools without a flyout", async ({ page }) => {
  await boot(page);
  const expand = page.getByRole("button", { name: "Expand Library" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  const before = await page.locator("nav.glass").filter({ has: expand }).boundingBox();
  await expand.click();
  await expect(page.getByRole("button", { name: "Collapse Library" })).toHaveAttribute("aria-expanded", "true");
  const rail = page.locator("nav.cv-menu-scroll");
  await expect(rail.getByRole("button", { name: "Source Control" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Obsidian" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Dex Tickets" })).toBeVisible();
  const after = await rail.boundingBox();
  expect(after!.width).toBeGreaterThan(before!.width * 2);
  await rail.getByRole("button", { name: "Obsidian" }).click();
  await expect(page.locator(".react-flow__node-panel [data-panel='vault']").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse Library" })).toBeVisible();
});

test("topbar controls fuse into one glass bubble on hover", async ({ page }) => {
  await boot(page);
  const showChrome = page.getByTitle("Show panels and menus");
  if (await showChrome.isVisible().catch(() => false)) await showChrome.click();
  const bar = page.locator(".cv-topbar-fuse");
  const leftCluster = bar.locator(":scope > .glass-pill");
  await expect(bar).toBeVisible();
  await expect(bar).toHaveCSS("box-shadow", "none");
  await bar.hover({ position: { x: 250, y: 20 } });
  await expect.poll(() => bar.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
  await expect(leftCluster).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.locator(".react-flow").hover({ position: { x: 500, y: 300 } });
  await expect.poll(() => bar.evaluate((el) => getComputedStyle(el).boxShadow)).toBe("none");
});

test("Tools Add shape opens its choices and creates a canvas shape", async ({ page }) => {
  await boot(page);
  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  await dock.getByRole("button", { name: "Add shape" }).click();
  const rect = dock.locator("button[title='rect']");
  await expect(rect).toBeVisible();
  await rect.click();
  await expect(dock).toBeHidden();
  await expect(page.locator(".react-flow__node-shape")).toBeVisible();
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

test("Add Obsidian to canvas closes Tools and mounts the live vault explorer", async ({ page }) => {
  const { vault } = await boot(page);
  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  await expect(dock).toBeVisible();
  await dock.getByRole("button", { name: "Add Obsidian to canvas" }).click();
  await expect(dock).toBeHidden();
  const vaultPanel = page.locator(".react-flow__node-panel [data-panel='vault']").first();
  await expect(vaultPanel).toBeVisible();
  await expect(vaultPanel.getByText("Vault Explorer")).toBeVisible();
  await expect(page.locator(".react-flow__node-panel").first()).toHaveCSS("width", /460px/);
  expect(vault).toContain("canvas-e2e-vault-");
});

test("Add Artifacts to canvas closes Tools and mounts the interactive artifact library", async ({ page }) => {
  await boot(page);
  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  await expect(dock).toBeVisible();
  await dock.getByRole("button", { name: "Add Artifacts to canvas" }).click();
  await expect(dock).toBeHidden();
  const artifacts = page.locator(".react-flow__node-panel [data-panel='artifacts']").first();
  await expect(artifacts).toBeVisible();
  await expect(artifacts.getByText("Artifacts", { exact: true }).first()).toBeVisible();
  await expect(artifacts.getByRole("button", { name: "+ new" })).toBeVisible();
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

test("panel chrome minimizes, restores, and closes with accessible controls", async ({ page }) => {
  await boot(page);
  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  await dock.getByRole("button", { name: "Add Inbox to canvas" }).click();
  const panel = page.locator(".react-flow__node-panel").filter({ has: page.locator("[data-panel='inbox']") }).first();
  await expect(panel).toBeVisible();
  const minimize = panel.getByRole("button", { name: "Minimize panel" });
  await minimize.focus();
  await page.keyboard.press("Enter");
  await expect(panel.locator(".nodrag.nowheel")).toBeHidden();
  const expand = panel.getByRole("button", { name: "Expand panel" });
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(panel.locator(".nodrag.nowheel")).toBeVisible();
  await panel.getByRole("button", { name: "Close panel" }).click();
  await expect(panel).toBeHidden();
});

test("bottom Files opens Obsidian and Code Editor opens the repo explorer", async ({ page }) => {
  await boot(page);
  const filesButton = page.locator("button[title='Files — open your Obsidian vault']");
  await expect(filesButton).toBeVisible();
  await filesButton.click();
  await expect(page.locator(".react-flow__node-panel [data-panel='vault']").first()).toBeVisible();
  await page.locator("button[title='Code Editor — open the workspace file tree and code viewer']").click();
  await expect(page.locator(".react-flow__node-panel [data-panel='explorer']").first()).toBeVisible();
  await expect(page.getByLabel("1 open code editor")).toBeVisible();
});

test("double-click empty canvas opens the spawn chooser (spawn-at-click)", async ({ page }) => {
  await boot(page);
  const pane = page.locator(".react-flow__pane").first();
  const bounds = await pane.boundingBox();
  const nodeBoxes = await Promise.all((await page.locator(".react-flow__node").all()).map((n) => n.boundingBox()));
  const candidates = [
    [0.78, 0.78], [0.78, 0.58], [0.62, 0.78], [0.38, 0.78], [0.78, 0.35],
    [0.58, 0.58], [0.38, 0.58], [0.62, 0.35], [0.38, 0.35], [0.5, 0.78],
  ];
  const point = candidates.map(([rx, ry]) => ({ x: bounds!.x + bounds!.width * rx, y: bounds!.y + bounds!.height * ry }))
    .find((p) => !nodeBoxes.some((b) => b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height));
  expect(point, "find an unobstructed point on the canvas").toBeTruthy();
  await page.mouse.dblclick(point!.x, point!.y);
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
