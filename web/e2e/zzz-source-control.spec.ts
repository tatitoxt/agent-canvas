import { test, expect } from "./fixtures.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

test("Source Control lists a workspace shell worktree and opens its terminal", async ({ page }) => {
  const { port, token, vault, repo } = stack();
  const workspaceName = `Source Control E2E ${Date.now()}`;
  await page.addInitScript((v) => localStorage.setItem("cv-vault-dir", v), vault);
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });

  await page.locator("button[title^='Tools —']").click();
  const tools = page.getByRole("dialog", { name: "Tools panel" });
  await tools.getByRole("button", { name: "New workspace" }).click();
  await page.getByPlaceholder("workspace name").fill(workspaceName);
  const repoInput = page.getByPlaceholder("repo path (~/repos/my-app)");
  await repoInput.fill(repo);
  await repoInput.press("Enter");
  await expect(tools).toBeHidden();

  await page.locator("button[title*='New task']").first().click();
  await page.locator("button[title='Terminal']").click();
  await page.locator("select[title='spawn inside this workspace — own git worktree']").selectOption({ label: workspaceName });
  await page.locator("button", { hasText: "+ spawn" }).last().click();
  const agent = page.locator(".agent-card").first();
  await expect(agent).toBeVisible({ timeout: 10_000 });

  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  await dock.getByRole("button", { name: "Add Source Control to canvas" }).click();
  await expect(dock).toBeHidden();

  const sourceControl = page.locator(".react-flow__node[data-id='panel-sc']");
  await expect(sourceControl).toBeVisible();
  await expect(sourceControl).toContainText("1 tree");
  await expect(sourceControl.locator("span[title]").first()).toHaveText(/canvas\/bash-[a-z0-9]+/);
  await expect(sourceControl).toContainText("clean tree");
  await expect(sourceControl.locator("button[title^='push ']")).toBeVisible();
  await sourceControl.locator("button[title^='open ']").click();
  await expect(page.locator(".terminal-drawer .xterm")).toBeVisible({ timeout: 8_000 });
});
