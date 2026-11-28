import { test, expect } from "./fixtures.mjs";
import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

test("workspace can be resized by dragging its invisible edge and dimensions survive reload", async ({ page }) => {
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
  await page.evaluate(() => {
    const node = document.querySelector<HTMLElement>(".react-flow__node-workspace");
    node?.click();
  });
  await expect(workspace).toHaveClass(/selected/);
  const handle = workspace.locator(".react-flow__resize-control.handle.bottom.right");
  await expect(handle).toBeVisible();
  const workspaceId = await workspace.getAttribute("data-id");
  expect(workspaceId).toBeTruthy();

  const before = await workspace.boundingBox();
  expect(before).toBeTruthy();
  // Drag the real React Flow resize control. This exercises pointer handling,
  // canvas-to-flow scaling, and the app's persistence callback together.
  await page.mouse.move(before!.x + before!.width - 2, before!.y + before!.height - 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width + 118, before!.y + before!.height + 82, { steps: 8 });
  await page.mouse.up();

  const after = await workspace.boundingBox();
  expect(after).toBeTruthy();
  expect(after!.width).toBeGreaterThan(before!.width + 70);
  expect(after!.height).toBeGreaterThan(before!.height + 50);
  const savedSize = await page.evaluate(() => JSON.parse(localStorage.getItem("cv-workspacesizes") ?? "{}"));
  expect(savedSize[workspaceId!].w).toBeGreaterThan(520);
  expect(savedSize[workspaceId!].h).toBeGreaterThan(320);

  await page.reload();
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("cv-workspacesizes")))
    .toBe(JSON.stringify(savedSize));
  const resizedNode = page.locator(".react-flow__node-workspace").filter({ hasText: "Resizable workspace" }).first();
  await expect(resizedNode).toHaveAttribute("style", /width:\s*\d+px/);
});
