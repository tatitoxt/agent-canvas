import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

test("Add Explorer to canvas mounts a live repository file browser", async ({ page }) => {
  const { port, token, vault, repo } = stack();
  await page.addInitScript((v) => localStorage.setItem("cv-vault-dir", v), vault);
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
  // This creates a workspace in the shared E2E daemon, so this spec is named
  // to run last; it cannot affect the state assumed by the other specs.
  await page.locator("button[title^='Tools —']").click();
  const tools = page.getByRole("dialog", { name: "Tools panel" });
  await tools.getByRole("button", { name: "New workspace" }).click();
  await page.getByPlaceholder("workspace name").fill("E2E Repo");
  const repoInput = page.getByPlaceholder("repo path (~/repos/my-app)");
  await repoInput.fill(repo);
  await repoInput.press("Enter");
  await expect(tools).toBeHidden();
  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  await dock.getByRole("button", { name: "Add Explorer to canvas" }).click();
  await expect(dock).toBeHidden();
  const explorerNode = page.locator(".react-flow__node[data-id='panel-explorer']");
  await expect(explorerNode).toBeVisible();
  await expect(explorerNode.getByText("select a file")).toBeVisible();
  const readme = explorerNode.getByRole("button", { name: "README.md" });
  await expect(readme).toBeVisible({ timeout: 8_000 });
  await readme.click();
  await expect(explorerNode.locator("pre")).toContainText("# e2e workspace repo");
});
