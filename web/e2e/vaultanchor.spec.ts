import { test, expect } from "./fixtures.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

const SECTIONS = ["Section one", "Section two", "Section three", "Section four", "Section five", "Section six"];

function longNote(name: string) {
  const filler = Array.from({ length: 26 }, (_, i) => `filler line ${i} of scrolling content`).join("\n");
  return `# ${name}\n\n${SECTIONS.map((s) => `## ${s}\n\n${filler}`).join("\n\n")}`;
}

/** Distance between the heading element and the top of its nearest scrollable
 * ancestor inside the given root selector — near zero means "scrolled to it". */
async function headingOffsetIn(page: import("@playwright/test").Page, rootSelector: string, headingText: string) {
  return page.evaluate(
    ({ rootSelector, headingText }) => {
      const root = document.querySelector(rootSelector);
      if (!root) return { error: "no root" } as const;
      const el = Array.from(root.querySelectorAll("[id^=\"vh-\"]")).find(
        (h) => h.textContent?.includes(headingText),
      ) as HTMLElement | undefined;
      if (!el) return { error: "no heading" } as const;
      let sc: HTMLElement | null = el.parentElement;
      while (sc && sc !== root) {
        const oy = getComputedStyle(sc).overflowY;
        if ((oy === "auto" || oy === "scroll") && sc.scrollHeight > sc.clientHeight) break;
        sc = sc.parentElement;
      }
      if (!sc || sc === root) return { error: "no scrollport" } as const;
      return { offset: el.getBoundingClientRect().top - sc.getBoundingClientRect().top } as const;
    },
    { rootSelector, headingText },
  );
}

test("Add to Board carries the visible heading and lands beside the vault card", async ({ page }) => {
  const { port, token, vault } = stack();
  const name = `e2e-anchor-${Date.now()}`;
  writeFileSync(join(vault, `${name}.md`), longNote(name));
  await page.addInitScript((v) => localStorage.setItem("cv-vault-dir", v), vault);
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });

  // Open the vault panel and the pre-seeded note (reading view is default).
  await page.locator("button[title*='your real vault']").first().click();
  const panelRoot = '.react-flow__node[data-id="panel-vault"]';
  await expect(page.locator(panelRoot)).toBeVisible({ timeout: 8_000 });
  await page.locator(`${panelRoot} .vault-file`, { hasText: name }).first().click();
  await expect(page.locator(`${panelRoot} [id^="vh-"]`).first()).toBeVisible({ timeout: 8_000 });

  // Scroll the reader so "Section four" sits at the top of the scrollport —
  // the user is reading that section when they pin.
  await page.evaluate((panelRoot) => {
    const root = document.querySelector(panelRoot)!;
    const el = Array.from(root.querySelectorAll("[id^=\"vh-\"]")).find(
      (h) => h.textContent?.includes("Section four"),
    ) as HTMLElement;
    el.scrollIntoView({ block: "start" });
  }, panelRoot);
  await page.waitForTimeout(300);
  const beforePin = await headingOffsetIn(page, panelRoot, "Section four");
  expect("offset" in beforePin && Math.abs(beforePin.offset) < 40, `reader not scrolled: ${JSON.stringify(beforePin)}`).toBeTruthy();

  // Where the vault card sits in canvas coords — the pinned window must land
  // beside it. Panel rect comes from the persisted panel node; the md window's
  // flow position is its react-flow wrapper transform (zoom-independent).
  const panelRect = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem("cv-panelnodes") ?? "{}");
    return all?.main?.["panel-vault"] ?? null;
  });
  expect(panelRect, "vault panel rect persisted").not.toBeNull();

  await page.locator("button", { hasText: "Add to Board" }).first().click();

  // Source panel closes; live interactive window appears.
  await expect(page.locator(panelRoot)).toHaveCount(0, { timeout: 8_000 });
  const noteWindow = page.locator(".react-flow__node-md").filter({ hasText: name });
  await expect(noteWindow).toBeVisible({ timeout: 8_000 });

  // Placement: anchored beside the vault card — just right of its right edge
  // and slightly below its top, not a random viewport fraction.
  const readMdPos = () => page.evaluate(() => {
    const el = document.querySelector(".react-flow__node-md") as HTMLElement;
    const m = el?.style.transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  });
  const wantX = panelRect.x + panelRect.w + 40;
  const wantY = panelRect.y + 48;
  let mdPos: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      mdPos = await readMdPos();
      return mdPos ? Math.abs(mdPos.x - wantX) : 9999;
    }, { timeout: 8_000 })
    .toBeLessThan(30);
  expect(Math.abs(mdPos!.y - wantY), `y ${mdPos!.y} vs anchored ${wantY}`).toBeLessThan(30);

  // Heading anchor: inside the pinned window, "Section four" is at the top of
  // its scrollport — the reading position survived the pin.
  await expect
    .poll(async () => {
      const r = await headingOffsetIn(page, `.react-flow__node-md`, "Section four");
      return "offset" in r ? Math.abs(r.offset) : 9999;
    }, { timeout: 8_000 })
    .toBeLessThan(60);

  // Idempotent: reopen the vault, open the same note, pin again — still one window.
  await page.locator("button[title*='your real vault']").first().click();
  await expect(page.locator(panelRoot)).toBeVisible({ timeout: 8_000 });
  await page.locator(`${panelRoot} .vault-file`, { hasText: name }).first().click();
  const addAgain = page.locator("button", { hasText: "Add to Board" }).first();
  await expect(addAgain).toBeVisible({ timeout: 8_000 });
  await addAgain.click();
  await page.waitForTimeout(600);
  await expect(page.locator(".react-flow__node-md").filter({ hasText: name })).toHaveCount(1);

  // Survives reload: window persists and the heading anchor re-applies.
  await page.reload();
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  const restored = page.locator(".react-flow__node-md").filter({ hasText: name });
  await expect(restored, "md note window must survive a reload").toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => {
      const r = await headingOffsetIn(page, `.react-flow__node-md`, "Section four");
      return "offset" in r ? Math.abs(r.offset) : 9999;
    }, { timeout: 10_000 })
    .toBeLessThan(60);
});
