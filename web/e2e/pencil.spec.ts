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

test("Pencil color selection is reflected in canvas markups", async ({ page }) => {
  const { port } = stack();
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 10_000 });

  const tools = await openTools(page);
  await tools.getByRole("button", { name: "Pencil markups" }).click();
  await expect(page.getByText("drag to mark up the canvas")).toBeVisible();

  const color = page.getByRole("button", { name: "Mint pencil color" });
  await expect(color).toHaveAttribute("aria-pressed", "false");
  await color.click();
  await expect(color).toHaveAttribute("aria-pressed", "true");

  const surface = page.locator(".react-flow");
  const box = await surface.boundingBox();
  if (!box) throw new Error("Canvas has no measurable bounds");
  await page.mouse.move(box.x + 100, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 190, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("svg polyline").last()).toHaveAttribute("stroke", "#58d6bd");

  await page.keyboard.press("Escape");
  await page.locator("button[title*='Tools —']").click();
  const toolsAfter = page.getByRole("dialog", { name: "Tools panel" });
  const downloadPromise = page.waitForEvent("download");
  await toolsAfter.getByRole("button", { name: "Canvas shot" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Canvas shot did not produce a downloadable file");
  const downloaded = await import("node:fs/promises").then(({ readFile }) => readFile(path));
  expect(downloaded.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const mintPixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return 0;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 88 && pixels[i + 1] === 214 && pixels[i + 2] === 189 && pixels[i + 3] > 0) count++;
    }
    return count;
  }, downloaded.toString("base64"));
  expect(mintPixels, "PNG export should contain the selected mint annotation").toBeGreaterThan(0);
});
