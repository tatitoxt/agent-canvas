# Agent Canvas

An infinite dark canvas for coordinating real coding agents. Nodes are live PTY sessions running in isolated git worktrees — spawn them, watch what they are doing at a glance, delegate work between them, and see every delegation as a first-class edge carrying the task down and the result back.

**Status: working prototype.** Real PTYs, real persistence, real delegation — the interaction model and security scaffold are in place; automation, agent-native hooks and remote access are on the roadmap.

## Architecture

A local Rust daemon (`canvasd`) owns the real work — PTY sessions, git worktrees, SQLite persistence — and the frontend is a pure client talking to it over a session-token-authenticated WebSocket. The same core also runs inside a Tauri shell (`src-tauri/`), so the app ships native without giving up the web client.

```
web/                Vite + React 19 + TS strict + React Flow v12 + xterm.js + Zustand
crates/canvasd/     Rust daemon: tokio + axum + portable-pty + rusqlite
src-tauri/          Tauri shell embedding the same canvasd core
```

Wire protocol is versioned: JSON control frames (`cmd`/`type`) plus binary PTY frames `[id_len][agent_id][payload]` over one WebSocket. The Tauri transport mirrors it via `canvas://control` + `canvas://pty` events.

## What works today

- **Real agent nodes.** `+ agent` spawns a PTY (`bash`, `claude`, `codex`, `gemini`, any command) inside its own git worktree under `.canvas-worktrees/` — concurrent agents never touch each other's checkout.
- **Workspaces on one canvas.** User-created containers (`◫+`), each bound to a repo; agents spawned inside run against that repo's tree. Several workspaces coexist spatially.
- **Live status.** A 1s ticker derives `working / waiting / blocked / done / exited` from PTY activity and prompt-shaped tail lines — no agent hooks required. Status changes persist and emit to all clients.
- **Live activity previews.** Nodes show the agent's latest visible output line (ANSI-stripped) so you can see what it is doing without opening the terminal.
- **Delegation as a first-class edge.** Drag from a node's handle onto empty canvas → name, command, task, permission → the child lands where you dropped it, wired to its parent. When the child prints `CANVAS_RESULT: <summary>` the edge resolves and the result travels back.
- **Permission ladder.** Four levels per agent — `supervised` (default) / `auto-accept edits` / `auto` / `full access` — persisted, shown on the node, and enforced at spawn: a delegation child is clamped to at most its parent's level, so a supervised agent can never spawn an autonomous one behind your back.
- **Inbox.** Work grouped by what it needs from you — waiting/blocked agents, delegations in flight, returned results — with a live badge on the nav rail.
- **Persistence.** Agents, workspaces, delegations and node positions live in WAL-mode SQLite; reconnecting replays the whole board. Dead PTYs replay as `exited`, never as live.
- **Terminal.** Click a live node → xterm.js panel with bidirectional PTY input/output and resize.

## Security model

- Daemon binds `127.0.0.1` only and requires a per-launch token (`CANVASD_TOKEN`, printed at startup; `?token=` on WS, `Bearer` on HTTP).
- `cwd` is sanitized against path traversal; agent env is an allowlist (`TERM`, `PATH`, `HOME`, `CANVAS_AGENT_ID`).
- Destructive actions ride a dedicated `confirm_destructive` control message — never inferred from prompt text.
- Permission levels are normalized server-side; unknown values clamp to `supervised`.

## Develop

```sh
cd web && npm install
cargo run -p canvasd        # daemon on 127.0.0.1:4242, prints CANVASD_TOKEN
cd web && npm run dev       # web on :5173 — open ?token=<token>
```

`cargo test -p canvasd` covers path sanitization and ANSI stripping; `npm run build` typechecks strict and bundles.

## Design language

Dark-first glass on a 22px dot grid: color-mix surfaces over `#0e0e10`, 20px backdrop blur, hairline reflected borders, one warm accent. Nodes are cards of the real CLI (Claude Code ◆, Codex ◈, Gemini ✦, Aider ▣, Terminal ›_), not abstract bubbles — and the mission strip answers at a glance: what is running, what needs you, what is blocked, what is done.

## Limitations

- Status derivation is heuristic (activity + prompt-shaped tails) until agent-native hooks land; short bursts of output can flicker `working`/`idle`.
- Permission levels are stored, displayed and enforced on spawn/delegation — command-level enforcement (blocking what an agent may run) is roadmap work, as are automations, pop-out panels, and remote/phone access.
- The Tauri shell shares the canvasd core but has no bundled webview assets pipeline yet; CI builds it on macOS runners.
- Single-board, single-machine: one daemon serves one board on one repo root plus workspace repos.

## File sandbox (vault operations)

The daemon validates every vault file path in its own process, never trusting the client:

- paths must be relative, inside the vault root — absolute paths and `..` are refused;
- symlinks that escape the vault are refused (canonicalized resolution);
- the vault root itself must sit inside an **allowed root**: the board repo always qualifies, and extra roots (e.g. an external notes vault) opt in one per line in `.canvas/allowed-roots` (`~` is expanded). Denied operations return `access denied: path is outside allowed directories`.

## Desktop auto-updates

The Tauri shell embeds `web/dist`, so web changes only reach desktop users through a new app build. The updater flow:

1. **One-time key setup** (repo admin):
   ```
   npm i -g @tauri-apps/cli@^2
   tauri signer generate -w ~/.tauri/canvas.key
   ```
   Then paste the **public key** into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, and add two repo secrets (Settings → Secrets → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/canvas.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password used when generating
2. **Release**: push a semver tag (`git tag v0.2.0 && git push origin v0.2.0`). The `release` workflow builds the `.app` + `.dmg` on a macOS runner, signs the updater artifacts, and publishes everything plus a `latest.json` manifest to GitHub Releases.
3. **Client**: on launch the app checks `releases/latest/download/latest.json`; a newer signed build downloads and installs in the background.

Until the pubkey/secrets are in place the workflow automatically builds **unsigned** (updater artifacts are disabled for that run) and still publishes the `.dmg`/`.app`; once the secrets exist, signed updater artifacts and `latest.json` are produced with no workflow changes.
