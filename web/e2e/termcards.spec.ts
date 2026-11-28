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

async function openDrawer(page: import("@playwright/test").Page) {
  // Since #60 a click only selects the card — the drawer opens from the
  // right-click context menu's "open terminal".
  const node = page.locator(".react-flow__node").first();
  const b = await node.boundingBox();
  if (b) {
    await page.mouse.click(b.x + 30, b.y + 30, { button: "right" });
    await page.waitForTimeout(400);
    await page.locator("button", { hasText: "open terminal" }).first().click();
    await page.waitForTimeout(900);
  }
}

test("agent card terminal control is keyboard-operable", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  const openTerminal = page.getByRole("button", { name: "Open terminal" }).last();
  await expect(openTerminal).toBeVisible({ timeout: 5_000 });
  await openTerminal.press("Enter");
  await expect(page.locator(".terminal-drawer").first()).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".terminal-drawer .xterm").first()).toBeVisible({ timeout: 5_000 });
});

test("agent cards resize from their canvas handles", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  const card = page.locator(".react-flow__node").filter({ has: page.locator("[data-testid='agent-card-header']") }).first();
  await expect(card).toBeVisible({ timeout: 5_000 });
  const before = await card.boundingBox();
  await card.locator("[data-testid='agent-card-header']").click();
  const handle = card.locator(".react-flow__resize-control.handle.bottom.right");
  await expect(handle).toBeVisible({ timeout: 5_000 });
  const grip = await handle.boundingBox();
  expect(before).not.toBeNull();
  expect(grip).not.toBeNull();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip!.x + grip!.width / 2 + 70, grip!.y + grip!.height / 2 + 55, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await card.boundingBox())?.width ?? 0).toBeGreaterThan(before!.width + 25);
  await expect.poll(async () => (await card.boundingBox())?.height ?? 0).toBeGreaterThan(before!.height + 25);
});

test("agent card terminal preview emphasizes the latest visible row", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  const card = page.locator(".agent-card").first();
  await expect(card).toBeVisible({ timeout: 8_000 });
  // Card chrome (open/collapse/kill) only becomes interactive once the card
  // is selected — select it first, like a user would.
  await card.locator("[data-testid='agent-card-header']").click();
  await expect(card.locator("[title='Open terminal']")).toBeVisible();
  await card.locator("[title='Open terminal']").click();
  const terminal = page.locator(".terminal-drawer .xterm").first();
  await expect(terminal).toBeVisible({ timeout: 5_000 });
  await terminal.click();
  await page.keyboard.type("printf '\\033[1;32mpreview-latest-row\\033[0m\\n'");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-drawer .xterm-rows")).toContainText("preview-latest-row", { timeout: 8_000 });
  const preview = card.getByTestId("agent-terminal-preview");
  await expect(preview).toContainText("preview-latest-row", { timeout: 8_000 });
  const rows = preview.locator(":scope > div");
  const lastRow = rows.last();
  await expect(lastRow).toHaveCSS("border-left-color", "rgb(245, 165, 36)");
  const outputRow = rows.filter({ hasText: "preview-latest-row" });
  await expect(outputRow).toHaveCount(1);
  await expect(outputRow.locator("span").filter({ hasText: "preview-latest-row" })).toHaveCSS("font-weight", "700");
});

test("agent card sends inline steering to the live PTY and preserves Shift+Enter newlines", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  const card = page.locator(".agent-card").first();
  await expect(card).toBeVisible({ timeout: 8_000 });
  const input = card.getByTestId("agent-steering-input");
  await expect(input).toBeEnabled();
  await input.fill("printf 'inline-steering-ok\\n'");
  // In a raw PTY, submit is carriage return (0x0d); LF is Ctrl+J.
  await expect(input).toHaveValue("printf 'inline-steering-ok\\n'");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(card.getByRole("button", { name: "Send instruction to Terminal 1" })).toContainText("Sent");
  await expect(card.getByTestId("agent-terminal-preview")).toContainText("inline-steering-ok", { timeout: 8_000 });

  await input.fill("printf 'shift");
  await input.press("Shift+Enter");
  // The deterministic client-side signal: Shift+Enter must NOT submit —
  // the textarea keeps its content and gains a real newline. (In a
  // cooked bash PTY the byte streams of submit-then-type and
  // newline-then-type collapse to the same thing, so the output alone
  // cannot tell them apart.)
  await expect(input).toHaveValue("printf 'shift\n");
  await input.type("-newline-ok\\n'");
  await input.press("Enter");
  // The multiline message reaches bash as ONE command: the printf runs
  // and its output shows in the preview. Asserting the flattened rows
  // join into "shift-newline-ok" is wrong — the mini terminal is narrow,
  // so readline redraws wrapped rows with cursor addressing and the
  // screen model concatenates prompt fragments between the two output
  // rows. The semantic signal instead: the output text is present AND
  // bash never split the input into two commands (which would print
  // "-newline-ok: command not found").
  const preview = card.getByTestId("agent-terminal-preview");
  await expect(preview).toContainText("-newline-ok", { timeout: 8_000 });
  await expect(preview).not.toContainText("command not found");
});

test("supervised terminal input is denied or released only from the approval controls", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  const card = page.locator(".agent-card").first();
  const permission = card.getByRole("button", { name: "supervised" });
  await expect(permission).toBeVisible();

  const deniedMarker = `deny-e2e-${Date.now()}`;
  const input = card.getByTestId("agent-steering-input");
  await input.fill(`rm -rf ${deniedMarker}`);
  await input.press("Enter");
  await expect(card.getByText(`rm -rf ${deniedMarker}`, { exact: true })).toBeVisible({ timeout: 8_000 });
  await card.getByRole("button", { name: "deny", exact: true }).click();
  await expect(card.getByText(`rm -rf ${deniedMarker}`, { exact: true })).toHaveCount(0);
  const drawerButton = card.locator("[title='Open terminal']");
  await card.locator("[data-testid='agent-card-header']").click();
  await drawerButton.click();
  const terminalRows = page.locator(".terminal-drawer .xterm-rows").first();
  await expect(terminalRows).not.toContainText(deniedMarker);

  const allowedMarker = `allow-e2e-${Date.now()}`;
  const allowedCommand = `rm -rf missing-${allowedMarker}; printf '%s\\n' '${allowedMarker}'`;
  await input.fill(allowedCommand);
  await input.press("Enter");
  await expect(card.getByText(allowedCommand, { exact: true })).toBeVisible({ timeout: 8_000 });
  await card.getByRole("button", { name: "allow", exact: true }).click();
  await expect(terminalRows).toContainText(allowedMarker, { timeout: 8_000 });
});

test("inline steering does not submit while an IME candidate is composing", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  const card = page.locator(".agent-card").first();
  const input = card.getByTestId("agent-steering-input");
  await input.fill("composition-safe");
  await input.evaluate((element) => {
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(event, "isComposing", { value: true });
    element.dispatchEvent(event);
  });
  await expect(input).toHaveValue("composition-safe");
  await expect(card.getByRole("button", { name: "Send instruction to Terminal 1" })).not.toContainText("Sent");
});

test("pop out creates a canvas term card; put back returns it to the drawer", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  await expect(page.getByLabel(/\d+ open terminals?/)).toBeVisible();
  await openDrawer(page);
  const popBtn = page.locator("button[title='pop out onto the canvas as a card']").first();
  await expect(popBtn).toBeVisible({ timeout: 5_000 });
  await popBtn.click();
  await page.waitForTimeout(900);
  const termCard = page.locator(".react-flow__node-term").first();
  await expect(termCard).toBeVisible({ timeout: 5_000 });
  const original = await termCard.boundingBox();
  await termCard.getByRole("button", { name: "Maximize terminal card" }).press("Enter");
  await expect(termCard.getByRole("button", { name: "Restore terminal card size" })).toBeVisible();
  await expect.poll(async () => {
    const rect = await termCard.boundingBox();
    return rect!.width * rect!.height;
  }).toBeGreaterThan(original!.width * original!.height * 2);
  await termCard.getByRole("button", { name: "Restore terminal card size" }).press("Enter");
  await expect(termCard.getByRole("button", { name: "Maximize terminal card" })).toBeVisible();
  await expect.poll(async () => {
    const rect = await termCard.boundingBox();
    return Math.abs(rect!.width - original!.width) + Math.abs(rect!.height - original!.height);
  }).toBeLessThan(6);
  // put back — the card closes and the terminal lives in the drawer again.
  // Card chrome is only interactive while the card is selected; the header
  // strip left of the title selects without triggering a control.
  await termCard.click({ position: { x: 200, y: 15 } });
  await termCard.locator("button[title*='Put back']").first().click();
  await page.waitForTimeout(700);
  expect(await page.locator(".react-flow__node-term").count()).toBe(0);
});

test("shift+click multi-select selects two nodes", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  await spawnTerm(page);
  await page.waitForTimeout(1500);
  const nodes = page.locator(".react-flow__node").filter({ has: page.locator("[title='Open terminal']") });
  expect(await nodes.count()).toBeGreaterThanOrEqual(2);
  // Three layout facts make a blind click flaky here:
  //  1. Spawn positions carry a random offset, so the two cards can overlap —
  //     and shift+click TOGGLES selection, so two clicks on the same topmost
  //     card select then deselect it and the count never reaches 2.
  //  2. The steering form inside the card body stopPropagation()s clicks, so
  //     a point landing on it never selects the node. Where exactly it sits
  //     depends on the platform's font metrics.
  //  3. The fused topbar overlay legitimately eats clicks in the viewport's
  //     top ~64px strip.
  // So scan each card in-page for a point whose real hit target is inside
  // THAT card but outside any interactive control — the same strip a user
  // would grab — and click exactly there.
  const pickPoint = (elHandle: import("@playwright/test").ElementHandle) =>
    elHandle.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const nodeId = node.getAttribute("data-id");
      for (const fy of [0.06, 0.12, 0.3, 0.5, 0.7, 0.9]) {
        const y = rect.y + rect.height * fy;
        if (y < 72) continue; // fused topbar strip — clicks never reach the canvas there
        for (const fx of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) {
          const x = rect.x + rect.width * fx;
          const hit = document.elementFromPoint(x, y);
          if (!hit) continue;
          const hitNode = hit.closest(".react-flow__node");
          if (hitNode?.getAttribute("data-id") !== nodeId) continue; // overlapped by the other card or a panel
          if (hit.closest("button, a, input, select, textarea, form, [contenteditable]")) continue;
          return { x, y };
        }
      }
      return null;
    });
  const h0 = await nodes.nth(0).elementHandle();
  const h1 = await nodes.nth(1).elementHandle();
  const p0 = await pickPoint(h0!);
  const p1 = await pickPoint(h1!);
  expect(p0, "a grabbable strip of the first card").toBeTruthy();
  expect(p1, "a grabbable strip of the second card").toBeTruthy();
  await page.keyboard.down("Shift");
  await page.mouse.click(p0!.x, p0!.y);
  await page.mouse.click(p1!.x, p1!.y);
  await page.keyboard.up("Shift");
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2, { timeout: 6_000 });
});

test("split right shows two live xterm panes in the drawer", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  // The split pane mirrors a SECOND agent on the board (per-test cleanup
  // forgets agents, so there is no leftover terminal to pick) — spawn one.
  await spawnTerm(page);
  await openDrawer(page);
  const splitBtn = page.locator("button[title*='split right']").first();
  await expect(splitBtn).toBeVisible({ timeout: 5_000 });
  await splitBtn.click();
  // The second pane auto-picks the other agent on the board — both xterm
  // panes render live inside the drawer.
  await expect(page.locator(".terminal-drawer .xterm")).toHaveCount(2, { timeout: 6_000 });
});

test("terminal accepts shell input and renders PTY output", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  await openDrawer(page);
  const terminal = page.locator(".xterm").first();
  await expect(terminal).toBeVisible();
  await terminal.click();
  await page.keyboard.type("printf 'terminal-e2e-ok\\n'");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("terminal-e2e-ok", { timeout: 8_000 });
});

test("Tools Pause all suspends PTY commands until Resume all", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  const card = page.locator(".agent-card").first();
  await card.locator("[data-testid='agent-card-header']").click();
  await card.locator("[title='Open terminal']").click();
  const terminal = page.locator(".terminal-drawer .xterm").first();
  await expect(terminal).toBeVisible({ timeout: 5_000 });
  await terminal.click();

  await page.keyboard.type("printf '\\x70\\x72\\x65\\x2d\\x70\\x61\\x75\\x73\\x65\\n'");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-drawer .xterm-rows")).toContainText("pre-pause", { timeout: 8_000 });

  await page.locator("button[title^='Tools —']").click();
  const tools = page.getByRole("dialog", { name: "Tools panel" });
  await tools.getByRole("button", { name: "Pause all", exact: true }).click();
  await expect(tools).toBeVisible();
  await tools.getByRole("button", { name: "Close Tools panel" }).click();

  await terminal.click();
  await page.keyboard.type("printf '\\x72\\x65\\x73\\x75\\x6d\\x65\\x2d\\x6d\\x61\\x72\\x6b\\n'");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-drawer .xterm-rows")).not.toContainText("resume-mark", { timeout: 700 });

  await page.locator("button[title^='Tools —']").click();
  await page.getByRole("dialog", { name: "Tools panel" }).getByRole("button", { name: "Resume all", exact: true }).click();
  await expect(page.locator(".terminal-drawer .xterm-rows")).toContainText("resume-mark", { timeout: 8_000 });
});

test("terminal search shortcut finds scrollback and Escape returns focus to the TUI", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  await openDrawer(page);
  const terminal = page.locator(".terminal-drawer .xterm").first();
  await terminal.click();
  await page.keyboard.type("printf 'searchable-terminal-line\\n'");
  await page.keyboard.press("Enter");
  const rows = page.locator(".terminal-drawer .xterm-rows");
  await expect(rows).toContainText("searchable-terminal-line", { timeout: 8_000 });

  await page.keyboard.press("Control+f");
  const find = page.getByTestId("terminal-find-input");
  await expect(find).toBeVisible();
  await find.fill("searchable-terminal-line");
  await expect(page.locator(".xterm-search一" )).toHaveCount(0); // keep search UI local to xterm
  await page.keyboard.press("Escape");
  await expect(find).toHaveCount(0);
  await expect(terminal.locator("textarea.xterm-helper-textarea")).toBeFocused();
  await page.keyboard.type("printf 'terminal-focus-restored\\n'");
  await page.keyboard.press("Enter");
  await expect(rows).toContainText("terminal-focus-restored", { timeout: 8_000 });
});

test("popped-out terminal keeps accepting shell input", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  await openDrawer(page);
  await page.locator("button[title='pop out onto the canvas as a card']").first().click();
  const cardTerminal = page.locator(".react-flow__node-term .xterm").first();
  await expect(cardTerminal).toBeVisible({ timeout: 5_000 });
  await cardTerminal.click();
  await page.keyboard.type("printf 'canvas-terminal-e2e-ok\\n'");
  await page.keyboard.press("Enter");
  await expect(page.locator(".react-flow__node-term .xterm-rows")).toContainText("canvas-terminal-e2e-ok", { timeout: 8_000 });
});

test("offscreen terminal stays mounted, suspends writes, and flushes output on return", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  await openDrawer(page);
  await page.locator("button[title='pop out onto the canvas as a card']").first().click();
  const cardTerminal = page.locator(".react-flow__node-term .xterm").first();
  await expect(cardTerminal).toBeVisible({ timeout: 5_000 });
  await cardTerminal.evaluate((el) => { el.setAttribute("data-mount-probe", "original"); });

  const suffix = String(Date.now());
  const marker = `offscreen-flush-${suffix}`;

  const panBy = async (dx: number, dy: number, steps: number) => {
    // Drive the real pane wheel handler directly. This is exactly reversible
    // (React Flow applies -delta * panOnScrollSpeed) and does not depend on
    // whether spawn layout put a nopan card under the mouse cursor. Retry the
    // first step until the transform moves: immediately after popping out a
    // terminal, xterm replay can occasionally delay React Flow's wheel listener
    // attachment long enough to swallow one otherwise-valid burst.
    const dispatch = (count: number) => page.evaluate(({ dx, dy, steps, count }) => {
      const pane = document.querySelector(".react-flow__pane");
      if (!pane) throw new Error("react-flow pane missing");
      for (let i = 0; i < count; i++) {
        pane.dispatchEvent(new WheelEvent("wheel", {
          deltaX: (-dx * 2) / steps,
          deltaY: (-dy * 2) / steps,
          bubbles: true,
          cancelable: true,
        }));
      }
    }, { dx, dy, steps, count });
    const transform = () => page.evaluate(() =>
      document.querySelector(".react-flow__viewport")?.getAttribute("style") ?? "");
    const before = await transform();
    let started = false;
    for (let attempt = 0; attempt < 6 && !started; attempt++) {
      await dispatch(1);
      await page.waitForTimeout(70);
      started = (await transform()) !== before;
    }
    if (!started) throw new Error("canvas pane ignored the pan wheel input");
    await dispatch(steps - 1);
    await page.waitForTimeout(120);
  };

  // Move the canvas far enough that even the 240px activation halo is gone.
  await panBy(2600, 800, 20);
  await expect.poll(async () => page.evaluate(() => {
    const far = (rect: DOMRect) =>
      rect.right < -240 || rect.left > window.innerWidth + 240 || rect.bottom < -240 || rect.top > window.innerHeight + 240;
    const term = document.querySelector(".react-flow__node-term")?.getBoundingClientRect();
    const agent = document.querySelector(".agent-card")?.getBoundingClientRect();
    return !!term && !!agent && far(term) && far(agent);
  })).toBe(true);

  await expect.poll(async () => page.locator(".agent-card").first().getAttribute("data-near-viewport")).toBe("false");

  // PTY input does not depend on xterm visibility. Focus the still-mounted
  // helper textarea programmatically (it is far offscreen, so a mouse click is
  // meaningless) and only then schedule output. The marker therefore cannot
  // exist in either terminal model before the card is outside the halo.
  await cardTerminal.locator("textarea.xterm-helper-textarea").evaluate((el: HTMLTextAreaElement) => el.focus());
  // The echoed command line must never contain the contiguous plaintext
  // marker: if it did, the post-return assertion could be satisfied by the
  // echo alone even when the real output bytes were lost offscreen. Splitting
  // the suffix out as a printf %s argument keeps the two halves apart in the
  // echo while the output reassembles them — and unlike \x hex escapes (a
  // bashism dash prints literally, which is exactly how this test failed on
  // every Ubuntu CI run), printf %s is POSIX and behaves identically in
  // bash, dash, zsh and sh everywhere.
  await page.keyboard.type(`sh -c 'sleep 0.5; printf "offscreen-flush-%s\\n" ${suffix}'`);
  await page.keyboard.press("Enter");

  // The shell emits after the card is offscreen. Neither the interactive
  // xterm nor the card's headless-screen preview may parse/paint it yet —
  // but both must retain enough state to catch up losslessly on return.
  await page.waitForTimeout(900);
  const rows = page.locator(".react-flow__node-term .xterm-rows");
  const preview = page.locator(".agent-card [data-testid='agent-terminal-preview']").first();
  await expect(rows).not.toContainText(marker);
  await expect(preview).not.toContainText(marker);
  expect(await page.locator(".react-flow__node-term .xterm").count()).toBe(1);
  expect(await cardTerminal.getAttribute("data-mount-probe")).toBe("original");

  // Exact inverse pan. IntersectionObserver crosses back into the halo and
  // the queued bytes repaint without recreating the xterm DOM element.
  await panBy(-2600, -800, 26);
  await expect(rows).toContainText(marker, { timeout: 8_000 });
  await expect(preview).toContainText(marker, { timeout: 8_000 });
  expect(await cardTerminal.getAttribute("data-mount-probe")).toBe("original");
});

test("terminal drawer resizes and keeps its PTY interactive", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  await openDrawer(page);
  const handle = page.getByTestId("terminal-resize-handle");
  await expect(handle).toBeVisible();
  const panel = handle.locator("xpath=..");
  const before = await panel.boundingBox();
  const grip = await handle.boundingBox();
  expect(before).not.toBeNull();
  expect(grip).not.toBeNull();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip!.x + grip!.width / 2 + 90, grip!.y + grip!.height / 2 + 60);
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeGreaterThan(before!.width + 50);
  await expect.poll(async () => (await panel.boundingBox())?.height ?? 0).toBeGreaterThan(before!.height + 30);

  const terminal = page.locator(".xterm").first();
  await terminal.click();
  await page.keyboard.type("printf 'resized-terminal-e2e-ok\\n'");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("resized-terminal-e2e-ok", { timeout: 8_000 });
});

test("terminal drawer resize cleans up when pointer interaction is cancelled", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  await openDrawer(page);
  const handle = page.getByTestId("terminal-resize-handle");
  const panel = handle.locator("xpath=..");
  const initial = await panel.boundingBox();
  const grip = await handle.boundingBox();
  expect(initial).not.toBeNull();
  expect(grip).not.toBeNull();

  await page.mouse.move(grip!.x + 2, grip!.y + 2);
  await page.mouse.down();
  await page.mouse.move(grip!.x + 72, grip!.y + 52);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true })));
  const cancelled = await panel.boundingBox();
  expect(cancelled!.width).toBeGreaterThan(initial!.width + 30);

  // Once cancelled, subsequent pointer motion must not keep resizing the drawer.
  await page.mouse.move(grip!.x + 170, grip!.y + 140);
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeCloseTo(cancelled!.width, 0);
  await expect.poll(async () => (await panel.boundingBox())?.height ?? 0).toBeCloseTo(cancelled!.height, 0);
});

test("Escape cancels drawer resize even while xterm keeps focus", async ({ page }) => {
  await boot(page);
  await spawnTerm(page);
  await openDrawer(page);
  const handle = page.getByTestId("terminal-resize-handle");
  const panel = handle.locator("xpath=..");
  const terminal = page.locator(".terminal-drawer .xterm").first();
  await terminal.click();
  const grip = await handle.boundingBox();
  const initial = await panel.boundingBox();
  expect(grip).not.toBeNull();
  expect(initial).not.toBeNull();

  await page.mouse.move(grip!.x + 2, grip!.y + 2);
  await page.mouse.down();
  await page.mouse.move(grip!.x + 72, grip!.y + 52);
  await page.keyboard.press("Escape");
  const cancelled = await panel.boundingBox();
  await page.mouse.move(grip!.x + 170, grip!.y + 140);
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeCloseTo(cancelled!.width, 0);
  await expect.poll(async () => (await panel.boundingBox())?.height ?? 0).toBeCloseTo(cancelled!.height, 0);
});

test("reconnecting rebuilds a live terminal from scrollback without duplicate history", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.defineProperty(window, "__canvasSockets", { value: sockets });
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args) as WebSocket;
        sockets.push(socket);
        return socket;
      },
    });
  });
  await boot(page);
  await spawnTerm(page);
  await openDrawer(page);
  const terminal = page.locator(".terminal-drawer .xterm").first();
  await terminal.click();
  await page.keyboard.type("printf 'reconnect-history-once\\n'");
  await page.keyboard.press("Enter");
  const rows = page.locator(".terminal-drawer .xterm-rows");
  const markerCount = () => rows.evaluate((el) => (el.textContent?.match(/reconnect-history-once/g) ?? []).length);
  await expect.poll(markerCount).toBeGreaterThan(0);
  const beforeReconnect = await markerCount();

  await page.evaluate(() => (window as any).__canvasSockets[0].close());
  await page.waitForFunction(() => (window as any).__canvasSockets.length >= 2, { timeout: 12_000 });
  await expect(page.locator("[data-testid='daemon-status']")).toHaveAttribute("aria-label", "Canvas daemon connected", { timeout: 12_000 });
  await expect.poll(markerCount).toBe(beforeReconnect);
});
