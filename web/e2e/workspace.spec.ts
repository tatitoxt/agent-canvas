import { test, expect } from "./fixtures.mjs";
import { mkdtempSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import WebSocket from "ws";

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

test("spawning from the chooser runs a live command in the selected workspace worktree", async ({ page }) => {
  const { port, token, vault } = stack();
  const workspaceRepo = mkdtempSync(resolve(tmpdir(), "canvas-e2e-spawn-workspace-"));
  execSync("git init -q", { cwd: workspaceRepo });
  execSync("git config user.email e2e@test", { cwd: workspaceRepo });
  execSync("git config user.name e2e", { cwd: workspaceRepo });
  writeFileSync(resolve(workspaceRepo, "README.md"), "# workspace spawn e2e\n");
  execSync("git add -A && git commit -qm init", { cwd: workspaceRepo });

  const marker = `workspace-spawn-e2e-${Date.now()}`;

  await page.addInitScript((v) => localStorage.setItem("cv-vault-dir", v), vault);
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`);
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });

  await page.locator("button[title='Workspaces']").click();
  await page.getByPlaceholder("+ workspace name").fill("Spawn E2E workspace");
  await page.getByPlaceholder("repo path (~/repos/my-app)").fill(workspaceRepo);
  await page.getByPlaceholder("repo path (~/repos/my-app)").press("Enter");
  const workspace = page.locator(".react-flow__node-workspace").filter({ hasText: "Spawn E2E workspace" }).first();
  await expect(workspace).toBeVisible({ timeout: 8_000 });
  const workspaceId = await workspace.getAttribute("data-id");
  expect(workspaceId).toBeTruthy();

  await page.locator("button[title^='Tasks']").click();
  await page.getByText("＋ new task", { exact: true }).click();
  const workspacePicker = page.locator("select[title='spawn inside this workspace — own git worktree']");
  await expect(workspacePicker).toBeVisible({ timeout: 5_000 });
  await workspacePicker.selectOption(workspaceId!);
  await page.locator(".cv-menu").getByRole("button", { name: "Terminal", exact: true }).click();
  await page.locator("button", { hasText: "+ spawn" }).last().click();

  const agent = page.locator(".agent-card").first();
  await expect(agent).toBeVisible({ timeout: 10_000 });
  const input = agent.getByTestId("agent-steering-input");
  await input.fill(`printf '${marker}\\n'`);
  await input.press("Enter");
  await expect(agent.getByTestId("agent-terminal-preview")).toContainText(marker, { timeout: 10_000 });

  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
  const snapshot = await new Promise<any>((resolveSnapshot, reject) => {
    const timer = setTimeout(() => reject(new Error("daemon snapshot timed out")), 5_000);
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.type === "snapshot") {
          clearTimeout(timer);
          resolveSnapshot(msg);
        }
      } catch { /* ignore non-JSON frames */ }
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error("daemon snapshot websocket failed")); };
  }).finally(() => socket.close());
  const spawned = snapshot.agents.find((a: any) => a.workspace_id === workspaceId && a.command === "bash");
  expect(spawned, `daemon records the new agent under the selected workspace; agents=${JSON.stringify(snapshot.agents)}`).toBeTruthy();
  const worktree = spawned.worktree as string | undefined;
  expect(worktree).toBeTruthy();
  expect(worktree).toContain(".canvas-worktrees");
  const absoluteWorktree = resolve(workspaceRepo, worktree!);
  const worktreeRoot = execSync("git rev-parse --show-toplevel", { cwd: absoluteWorktree }).toString().trim();
  expect(worktreeRoot).toBe(realpathSync(absoluteWorktree));
  const worktreeOrigin = execSync("git rev-parse --show-toplevel", { cwd: workspaceRepo }).toString().trim();
  expect(worktreeRoot).not.toBe(realpathSync(worktreeOrigin));
});
