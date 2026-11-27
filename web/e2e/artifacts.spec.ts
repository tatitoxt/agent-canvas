import { test, expect } from "./fixtures.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

test("artifact rows expand into a live markdown preview and collapse back", async ({ page }) => {
  const { port, token } = stack();
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });

  await page.locator("button[title^='Tools —']").click();
  const dock = page.getByRole("dialog", { name: "Tools panel" });
  await dock.getByRole("button", { name: "Add Artifacts to canvas" }).click();
  const artifacts = page.locator(".react-flow__node-panel [data-panel='artifacts']").first();
  await expect(artifacts).toBeVisible();

  // Create an artifact with formatted markdown content.
  const title = `preview-${Date.now()}`;
  await artifacts.getByRole("button", { name: "+ new" }).click();
  await artifacts.getByPlaceholder("title").fill(title);
  await artifacts
    .getByPlaceholder("contents (optional)")
    .fill(`# Report\n\n**bold claim** and a [[Missing target]] link.\n\n- first item\n- second item`);
  await artifacts.getByRole("button", { name: "create" }).click();

  // Narrow the library to exactly this artifact (retries leave rows behind).
  await artifacts.getByPlaceholder("Search artifacts or ask Dex").fill(title);
  const row = artifacts.locator("div", { hasText: title }).last();

  // Clicking the row expands a rendered markdown preview — bold becomes
  // <strong>, list items render, wikilinks become interactive anchors —
  // not a raw text dump.
  await artifacts.getByText(title).first().click();
  const preview = artifacts.locator("[data-artifact-preview]");
  await expect(preview).toBeVisible({ timeout: 8_000 });
  await expect(preview.locator("strong", { hasText: "bold claim" })).toBeVisible();
  await expect(preview.getByText("first item")).toBeVisible();
  await expect(preview.locator('a[title="Missing target (not created yet)"]')).toBeVisible();

  // Clicking again collapses it.
  await artifacts.getByText(title).first().click();
  await expect(artifacts.locator("[data-artifact-preview]")).toHaveCount(0);
});
