import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

test("workspace resize survives canvas rerenders and reloads", async ({ page }) => {
  const { port, token, vault, workspaceRepo } = stack();
  await page.addInitScript((v) => localStorage.setItem("cv-vault-dir", v), vault);
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  await page.locator("button[title='Workspaces']").click();
  await page.getByPlaceholder("+ workspace name").fill("Resizable workspace");
  await page.getByPlaceholder("repo path (~/repos/my-app)").fill(workspaceRepo);
  await page.getByPlaceholder("repo path (~/repos/my-app)").press("Enter");

  const workspace = page.locator(".react-flow__node-workspace").first();
  await expect(workspace).toBeVisible({ timeout: 8_000 });
  const before = await workspace.boundingBox();
  // Workspace frames render behind their child nodes. Click the exposed
  // bottom-right frame corner instead of a fixed point inside its contents.
  await page.mouse.click(before!.x + before!.width - 2, before!.y + before!.height - 2);
  const handle = page.locator(".react-flow__node-workspace .react-flow__resize-control.handle").last();
  await expect(handle).toBeVisible();
  const grip = await handle.boundingBox();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip!.x + grip!.width / 2 + 120, grip!.y + grip!.height / 2 + 80, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("cv-workspacesizes")))
    .toMatch(/"w":\s*\d{4}/);
  const savedSize = await page.evaluate(() => JSON.parse(localStorage.getItem("cv-workspacesizes") ?? "{}"));
  expect(savedSize[Object.keys(savedSize)[0]].w).toBeGreaterThan(900);
  expect(savedSize[Object.keys(savedSize)[0]].h).toBeGreaterThan(540);

  await page.reload();
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("cv-workspacesizes")))
    .toBe(JSON.stringify(savedSize));
  const resizedNode = page.locator(".react-flow__node-workspace").first();
  await expect(resizedNode).toHaveAttribute("style", /width:\s*\d{4}px/);
});
