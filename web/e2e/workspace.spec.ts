import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

test("workspace resize survives canvas rerenders and reloads", async ({ page }) => {
  const { port, token, vault } = stack();
  const workspaceRepo = mkdtempSync(resolve(tmpdir(), "canvas-e2e-workspace-repo-"));
  execSync("git init -q", { cwd: workspaceRepo });
  execSync("git config user.email e2e@test", { cwd: workspaceRepo });
  execSync("git config user.name e2e", { cwd: workspaceRepo });
  writeFileSync(resolve(workspaceRepo, "README.md"), "# e2e workspace repo\n");
  execSync("git add -A && git commit -qm init", { cwd: workspaceRepo });
  await page.addInitScript((v) => {
    if (!sessionStorage.getItem("workspace-resize-e2e-started")) {
      localStorage.removeItem("cv-workspacesizes");
      sessionStorage.setItem("workspace-resize-e2e-started", "1");
    }
    localStorage.setItem("cv-vault-dir", v);
  }, vault);
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  await page.locator("button[title='Workspaces']").click();
  await page.getByPlaceholder("+ workspace name").fill("Resizable workspace");
  await page.getByPlaceholder("repo path (~/repos/my-app)").fill(workspaceRepo);
  await page.getByPlaceholder("repo path (~/repos/my-app)").press("Enter");

  const workspace = page.locator(".react-flow__node-workspace").filter({ hasText: "Resizable workspace" }).first();
  await expect(workspace).toBeVisible({ timeout: 8_000 });
  await workspace.dblclick();
  await expect.poll(async () => workspace.boundingBox()).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  // Select a clear patch of the workspace background, away from child cards
  // and the resize grip, then drag the bottom-right grip specifically.
  const before = await workspace.boundingBox();
  await page.mouse.click(before!.x + before!.width - 90, before!.y + before!.height - 90);
  await expect(workspace).toHaveClass(/selected/);
  const handle = workspace.locator(".react-flow__resize-control.handle.bottom.right");
  await expect(handle).toBeVisible();
  const grip = await handle.boundingBox();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip!.x + grip!.width / 2 + 120, grip!.y + grip!.height / 2 + 80, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("cv-workspacesizes")))
    .not.toBeNull();
  const savedSize = await page.evaluate(() => JSON.parse(localStorage.getItem("cv-workspacesizes") ?? "{}"));
  expect(savedSize[Object.keys(savedSize)[0]].w).toBeGreaterThan(560);
  expect(savedSize[Object.keys(savedSize)[0]].h).toBeGreaterThan(360);

  await page.reload();
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("cv-workspacesizes")))
    .toBe(JSON.stringify(savedSize));
  const resizedNode = page.locator(".react-flow__node-workspace").filter({ hasText: "Resizable workspace" }).first();
  await expect(resizedNode).toHaveAttribute("style", /width:\s*\d+px/);
});
