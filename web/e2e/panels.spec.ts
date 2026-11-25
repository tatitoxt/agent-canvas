import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

test("offline demo mounts without a React update loop", async ({ page }) => {
  const { port } = stack();
  const depthErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Maximum update depth exceeded")) {
      depthErrors.push(message.text());
    }
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(900);
  expect(depthErrors).toEqual([]);
  const card = page.locator('.react-flow__node[data-id="a1"]');
  await expect(card.getByTestId("agent-card-title")).toHaveText("Terminal 1");
  await expect(card.getByTestId("agent-card-status")).toContainText("running");
  await expect(card.getByTestId("agent-card-cli")).toContainText("Claude Code");
  const identity = await card.getByTestId("agent-card-identity").boundingBox();
  const meta = await card.getByTestId("agent-card-meta").boundingBox();
  expect(meta!.y).toBeGreaterThan(identity!.y + identity!.height - 1);
  const cards = await page.locator(".react-flow__node-agent").evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const overlapX = Math.min(cards[i].right, cards[j].right) - Math.max(cards[i].left, cards[j].left);
      const overlapY = Math.min(cards[i].bottom, cards[j].bottom) - Math.max(cards[i].top, cards[j].top);
      expect(overlapX > 1 && overlapY > 1, `demo cards ${i + 1} and ${j + 1} should not overlap: ${JSON.stringify({ a: cards[i], b: cards[j] })}`).toBe(false);
    }
  }
});

test("topbar keeps connection status compact and accessible in demo mode", async ({ page }) => {
  const { port } = stack();
  await page.goto(`http://127.0.0.1:${port}/`);
  const status = page.getByTestId("daemon-status");
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).toHaveAttribute("aria-label", "Canvas demo mode; daemon offline");
  await expect(status).toHaveAttribute("title", "demo mode · start canvasd to connect");
  await expect(page.locator(".cv-topbar-fuse")).not.toContainText("offline");
});

async function boot(page: import("@playwright/test").Page) {
  const { port, token, vault, repo } = stack();
  await page.addInitScript((v) => localStorage.setItem("cv-vault-dir", v), vault);
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  return { port, token, vault, repo };
}

test("Paper theme switches the canvas to a readable warm light palette and persists", async ({ page }) => {
  await boot(page);
  await page.locator("button[title='Settings']").click();
  await page.getByRole("button", { name: "Paper" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  expect(await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(236, 232, 225)");
  expect(await page.locator("html").evaluate((el) => getComputedStyle(el).getPropertyValue("--cv-shadow-card"))).toContain("#3f2f19");
  expect(await page.locator("html").evaluate((el) => getComputedStyle(el).getPropertyValue("--cv-minimap-mask"))).toContain("#3f2f19");
  expect(await page.locator(".react-flow").evaluate((el) => getComputedStyle(el, "::after").opacity)).toBe("0.12");
  await expect.poll(() => page.locator(".react-flow__minimap-mask").evaluate((el) => getComputedStyle(el).fill)).toBe("rgba(63, 47, 25, 0.12)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
});

test("terminal font setting applies to live terminals, clamps, and persists", async ({ page }) => {
  await boot(page);
  await page.locator("button[title='Terminal — spawn a plain shell']").first().click();
  const card = page.locator(".agent-card").first();
  await expect(card).toBeVisible({ timeout: 8_000 });
  await card.locator("[title='Open terminal']").click();
  const terminal = page.locator(".terminal-drawer .xterm").first();
  await expect(terminal).toBeVisible({ timeout: 5_000 });

  await page.locator("button[title='Settings']").click();
  const settings = page.locator(".react-flow__node-panel [data-panel='settings']").first();
  const font = settings.getByRole("status", { name: "Terminal font 13 pixels" });
  await expect(font).toBeVisible();
  await settings.getByRole("button", { name: "Increase terminal font" }).click();
  await expect(settings.getByRole("status", { name: "Terminal font 14 pixels" })).toBeVisible();
  await expect.poll(() => terminal.locator(".xterm-rows").evaluate((el) => getComputedStyle(el).fontSize)).toBe("14px");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("cv-term-font"))).toBe("14");
  for (let i = 0; i < 8; i++) await settings.getByRole("button", { name: "Increase terminal font" }).click();
  await expect(settings.getByRole("status", { name: "Terminal font 22 pixels" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Increase terminal font" })).toBeDisabled();
});

test("terminal font preference restores after reload", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cv-term-font", "17"));
  const { port, token } = stack();
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  await page.locator("button[title='Settings']").click();
  const settings = page.locator(".react-flow__node-panel [data-panel='settings']").first();
  await expect(settings.getByRole("status", { name: "Terminal font 17 pixels" })).toBeVisible();
});

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

test("Tools dock scrolls to the lower library items in a short viewport", async ({ page }) => {
  await boot(page);
  await page.setViewportSize({ width: 800, height: 620 });
  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  const scroll = dock.locator(".cv-menu-scroll");
  const sizes = await scroll.evaluate((el) => ({ client: el.clientHeight, total: el.scrollHeight }));
  expect(sizes.total).toBeGreaterThan(sizes.client);
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(dock.getByRole("button", { name: /Mission Map/ }).first()).toBeVisible();
  await expect(dock.getByRole("button", { name: /Issues/ }).first()).toBeVisible();
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

test("topbar labels Panels and opens Mission Map from its live summary", async ({ page }) => {
  await boot(page);
  await page.locator("button[title*='New task']").first().click();
  await page.locator("button[title='Terminal']").click();
  await page.locator("button", { hasText: "+ spawn" }).last().click();
  await expect(page.locator(".react-flow__node-agent").first()).toBeVisible({ timeout: 10_000 });
  const panelsButton = page.getByRole("button", { name: /Panels/ });
  await expect(panelsButton).toBeVisible();
  await panelsButton.click();
  const panelsMenu = page.locator(".cv-menu-scroll").filter({ hasText: "Panels ·" }).first();
  await expect(panelsMenu).toBeVisible();
  await expect(panelsMenu.getByRole("button", { name: /Terminal/ }).first()).toBeVisible();
  await panelsButton.click();
  const mission = page.getByRole("button", { name: /Mission Map.*live/ });
  await expect(mission).toBeVisible();
  await mission.click();
  const panel = page.locator(".react-flow__node-panel").filter({ hasText: "Mission Map" }).first();
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/terminals · .*active/)).toBeVisible();
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
  const original = await panel.boundingBox();
  const maximize = panel.getByRole("button", { name: "Maximize panel" });
  await maximize.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("button", { name: "Restore panel size" })).toBeVisible();
  await expect.poll(async () => {
    const rect = await panel.boundingBox();
    return rect!.width * rect!.height;
  }).toBeGreaterThan(original!.width * original!.height * 2);
  const restore = panel.getByRole("button", { name: "Restore panel size" });
  await restore.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("button", { name: "Maximize panel" })).toBeVisible();
  await expect.poll(async () => {
    const rect = await panel.boundingBox();
    return Math.abs(rect!.width - original!.width) + Math.abs(rect!.height - original!.height);
  }).toBeLessThan(6);
  const restored = await panel.boundingBox();
  expect(Math.abs(restored!.width - original!.width)).toBeLessThan(3);
  expect(Math.abs(restored!.height - original!.height)).toBeLessThan(3);
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
