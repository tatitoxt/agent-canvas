// Harness for e2e: boot a real canvasd against a throwaway git repo and a
// pre-built web/dist, then hand the tests its base URL + session token.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const STATE = resolve(import.meta.dirname, ".e2e-stack.json");

export async function startStack() {
  const repo = mkdtempSync(join(tmpdir(), "canvas-e2e-repo-"));
  execSync("git init -q", { cwd: repo });
  execSync("git config user.email e2e@test", { cwd: repo });
  execSync("git config user.name e2e", { cwd: repo });
  writeFileSync(join(repo, "README.md"), "# e2e scratch repo\n");
  writeFileSync(join(repo, "OTHER.md"), "# another file with different contents\n");
  execSync("git add -A && git commit -qm init", { cwd: repo });
  const vault = mkdtempSync(join(tmpdir(), "canvas-e2e-vault-"));
  const home = mkdtempSync(join(tmpdir(), "canvas-e2e-home-"));
  writeFileSync(join(vault, "Canvas E2E note.md"), "# Canvas E2E note\n\nOriginal vault text.\n");
  // Keep the daemon's persistent state and Vault allowlist out of the real
  // user profile. Each run starts with no restored sessions or user settings.
  const arDir = join(home, ".config", "canvas");
  mkdirSync(arDir, { recursive: true });
  const arFile = join(arDir, "allowed-roots");
  writeFileSync(arFile, vault + "\n");

  const port = 4300 + Math.floor(Math.random() * 400);
  const bin = resolve(import.meta.dirname, "../../target/debug/canvasd");
  if (!existsSync(bin)) throw new Error("canvasd binary missing — run `cargo build -p canvasd` first");
  const dist = resolve(import.meta.dirname, "../dist");
  if (!existsSync(join(dist, "index.html"))) throw new Error("web/dist missing — run `npx vite build` in web/ first");

  const proc = spawn(bin, [], {
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      CANVAS_REPO: repo,
      CANVASD_PORT: String(port),
      CANVASD_HOST: "127.0.0.1",
      CANVASD_WEB_DIR: dist,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const token = await new Promise((res, rej) => {
    let buf = "";
    const timer = setTimeout(() => rej(new Error(`canvasd never printed its token; got: ${buf}`)), 20_000);
    proc.stdout.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/CANVASD_TOKEN=([0-9a-f]+)/);
      if (m) { clearTimeout(timer); res(m[1]); }
    });
    proc.on("exit", () => { clearTimeout(timer); rej(new Error(`canvasd exited early; got: ${buf}`)); });
  });
  // The token is the daemon's only credential — keep it owner-only.
  writeFileSync(STATE, JSON.stringify({ port, token, repo, vault, home, pid: proc.pid }), { mode: 0o600 });
  proc.unref();
  return { port, token, repo, vault };
}

export async function stopStack() {
  try {
    const { pid, repo, vault, home } = JSON.parse(readFileSync(STATE, "utf8"));
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    for (const path of [repo, vault, home]) if (path) rmSync(path, { recursive: true, force: true });
    rmSync(STATE, { force: true });
  } catch { /* no state file */ }
}

export function stackInfo() {
  return JSON.parse(readFileSync(STATE, "utf8"));
}
