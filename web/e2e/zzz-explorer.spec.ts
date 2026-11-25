import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
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
  await expect(explorerNode.getByText("Choose a file to preview")).toBeVisible();
  await explorerNode.click({ position: { x: 32, y: 16 } });
  const resizeHandle = explorerNode.locator(".react-flow__resize-control.handle.bottom.right");
  await expect(resizeHandle).toBeVisible();
  const grip = await resizeHandle.boundingBox();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip!.x + grip!.width / 2 + 120, grip!.y + grip!.height / 2 + 80, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => {
    const nodes = JSON.parse(localStorage.getItem("cv-panelnodes") ?? "{}");
    return nodes.main?.["panel-explorer"]?.w ?? 0;
  })).toBeGreaterThan(480);
  const persistedHeight = await page.evaluate(() => {
    const nodes = JSON.parse(localStorage.getItem("cv-panelnodes") ?? "{}");
    return nodes.main?.["panel-explorer"]?.h ?? 0;
  });
  expect(persistedHeight).toBeGreaterThan(480);
  await explorerNode.locator("select").selectOption(repo);
  const filter = explorerNode.getByRole("searchbox", { name: "Filter repository files" });
  await filter.fill("does-not-exist");
  await expect(explorerNode.getByText("No files match “does-not-exist”.")).toBeVisible();
  await filter.fill("README");
  const readme = explorerNode.getByRole("button", { name: "README.md" });
  await expect(readme).toBeVisible({ timeout: 8_000 });
  await readme.click();
  const code = explorerNode.getByLabel("Contents of README.md");
  await expect(code).toContainText("# e2e scratch repo");
  await expect(code.getByText("1", { exact: true })).toBeVisible();
  await explorerNode.getByRole("button", { name: "Edit README.md" }).click();
  const editor = explorerNode.getByRole("textbox", { name: "Edit contents of README.md" });
  await editor.fill("# Edited in Canvas\n\nSaved to the repository.\n");
  await explorerNode.getByRole("button", { name: "Save" }).click();
  await expect(explorerNode.getByLabel("Contents of README.md")).toContainText("Saved to the repository.");
  await expect.poll(() => readFileSync(resolve(repo, "README.md"), "utf8"), { timeout: 5_000 }).toContain("Saved to the repository.");

  // A dirty draft must never be retargeted to a newly selected file.
  await explorerNode.getByRole("button", { name: "Edit README.md" }).click();
  await editor.fill("# An unsaved draft that belongs only to README\n");
  await filter.fill("");
  const other = explorerNode.getByRole("button", { name: "OTHER.md" });
  await other.click();
  await expect(explorerNode.getByRole("textbox", { name: "Edit contents of README.md" })).toBeVisible();
  await expect(explorerNode.getByText("Save or cancel this draft before opening another file.")).toBeVisible();
  expect(readFileSync(resolve(repo, "OTHER.md"), "utf8")).toBe("# another file with different contents\n");
  await explorerNode.getByRole("button", { name: "Cancel" }).click();

  await explorerNode.getByRole("button", { name: "Edit README.md" }).click();
  await editor.fill("# A stale local draft\n");
  writeFileSync(resolve(repo, "README.md"), "# Edited outside Canvas\n");
  await explorerNode.getByRole("button", { name: "Save" }).click();
  await expect(explorerNode.getByRole("status")).toHaveText("CONFLICT");
  await expect(explorerNode.getByText("This file changed on disk. Reload it before saving your draft.")).toBeVisible();
  await explorerNode.getByRole("button", { name: "Reload" }).click();
  await expect(explorerNode.getByLabel("Contents of README.md")).toContainText("Edited outside Canvas");
});
