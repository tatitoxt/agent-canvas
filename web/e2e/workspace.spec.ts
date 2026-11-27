import { test, expect } from "./fixtures.mjs";
import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

test("workspace resize handle is exposed after selection and persisted dimensions survive reload", async ({ page }) => {
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
  const savedSize = { [workspaceId!]: { w: 760, h: 480 } };
  await page.evaluate((sizes) => localStorage.setItem("cv-workspacesizes", JSON.stringify(sizes)), savedSize);

  await page.reload();
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("cv-workspacesizes")))
    .toBe(JSON.stringify(savedSize));
  const resizedNode = page.locator(".react-flow__node-workspace").filter({ hasText: "Resizable workspace" }).first();
  await expect(resizedNode).toHaveAttribute("style", /width:\s*\d+px/);
});

test("workspace moves across boards and can be renamed and deleted", async ({ page }) => {
  const { port, token, vault } = stack();
  const workspaceRepo = mkdtempSync(resolve(tmpdir(), "canvas-e2e-workspace-actions-"));
  execSync("git init -q", { cwd: workspaceRepo });
  execSync("git config user.email e2e@test", { cwd: workspaceRepo });
  execSync("git config user.name e2e", { cwd: workspaceRepo });
  writeFileSync(resolve(workspaceRepo, "README.md"), "# workspace actions e2e\n");
  execSync("git add -A && git commit -qm init", { cwd: workspaceRepo });
  await page.addInitScript((v) => localStorage.setItem("cv-vault-dir", v), vault);
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  await page.locator("button[title='Workspaces']").click();
  await page.getByPlaceholder("+ workspace name").fill("Workspace actions");
  const repoInput = page.getByPlaceholder("repo path (~/repos/my-app)");
  await repoInput.fill(workspaceRepo);
  await repoInput.press("Enter");

  let workspace = page.locator(".react-flow__node-workspace").filter({ hasText: "Workspace actions" }).first();
  await expect(workspace).toBeVisible({ timeout: 8_000 });

  const boardName = `Workspace E2E ${Date.now()}`;
  const spaces = page.locator("nav").filter({ hasText: "Spaces" });
  const newBoard = spaces.getByRole("button", { name: "+", exact: true });
  await expect(newBoard).toBeVisible();
  await newBoard.click();
  const boardInput = spaces.locator('input[placeholder="+"]');
  await expect(boardInput).toBeVisible();
  await boardInput.fill(boardName);
  await boardInput.press("Enter");
  const boardTab = page.locator(`[data-board-tab][title^="${boardName}"]`);
  await expect(boardTab).toBeVisible({ timeout: 8_000 });

  await workspace.click({ button: "right", position: { x: 180, y: 40 } });
  await page.getByRole("button", { name: "move to board ▸" }).click();
  await page.getByRole("button", { name: boardName, exact: true }).click();
  await expect(workspace).toHaveCount(0);
  await boardTab.click();
  workspace = page.locator(".react-flow__node-workspace").filter({ hasText: "Workspace actions" }).first();
  await expect(workspace).toBeVisible({ timeout: 8_000 });

  await workspace.click({ button: "right", position: { x: 180, y: 40 } });
  const menu = page.locator(".cv-menu").filter({ has: page.getByRole("button", { name: "rename…" }) });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "rename…" }).click();
  const renameInput = page.locator(".cv-menu input");
  await renameInput.fill("Renamed workspace");
  await renameInput.press("Enter");
  workspace = page.locator(".react-flow__node-workspace").filter({ hasText: "Renamed workspace" }).first();
  await expect(workspace).toBeVisible();

  await workspace.click({ button: "right", position: { x: 180, y: 40 } });
  const deleteMenu = page.locator(".cv-menu").last();
  await deleteMenu.getByRole("button", { name: "delete workspace" }).click();
  await expect(deleteMenu.getByRole("button", { name: "confirm delete?" })).toBeVisible();
  await deleteMenu.getByRole("button", { name: "confirm delete?" }).click();
  await expect(workspace).toHaveCount(0);
  await page.getByRole("button", { name: "delete board", exact: true }).click();
  await expect(boardTab).toHaveCount(0);
});
