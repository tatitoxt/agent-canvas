import { test, expect } from "./fixtures.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stack = () => JSON.parse(readFileSync(resolve(import.meta.dirname, ".e2e-stack.json"), "utf8"));

async function openTools(page: import("@playwright/test").Page) {
  await page.locator("button[title^='Tools —']").click();
  return page.getByRole("dialog", { name: "Tools panel" });
}

test("Pencil markup can be exited from its toolbar, Tools, and Escape", async ({ page }) => {
  const { port } = stack();
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 10_000 });

  let tools = await openTools(page);
  await tools.getByRole("button", { name: "Pencil markups" }).click();
  const exit = page.getByRole("button", { name: /done esc/ });
  await expect(exit).toBeVisible();

  // The mode overlay must not swallow its own exit button.
  await exit.click();
  await expect(exit).toHaveCount(0);

  tools = await openTools(page);
  await tools.getByRole("button", { name: "Pencil markups" }).click();
  await expect(exit).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(exit).toHaveCount(0);

  tools = await openTools(page);
  await tools.getByRole("button", { name: "Pencil markups" }).click();
  await expect(exit).toBeVisible();
  tools = await openTools(page);
  await expect(tools.getByRole("button", { name: "Pencil markups" })).toHaveAttribute("title", "on");
  await tools.getByRole("button", { name: "Pencil markups" }).click();
  await expect(exit).toHaveCount(0);
});
