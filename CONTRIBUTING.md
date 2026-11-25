# Contributing

## Layout

```
web/                Vite + React 19 + TypeScript (strict) + React Flow + xterm.js + Zustand
crates/canvasd/     Rust daemon: PTY sessions, git worktrees, SQLite persistence
src-tauri/          Tauri 2 shell embedding the same canvasd core
```

`canvasd` is the source of truth: the web app and the Tauri shell are both
clients of its WebSocket protocol (JSON control frames + binary PTY frames).
The daemon prints a session `CANVASD_TOKEN` at startup; the web client needs
it as `?token=<token>`.

Deep dives: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how the pieces
fit) and [docs/PROTOCOL.md](docs/PROTOCOL.md) (the wire protocol).

## Prerequisites

- Rust (stable) + cargo
- Node.js 20+ / npm
- Linux only, for the Tauri shell: the GTK/WebKitGTK dev packages —
  `libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev
  libxdo-dev pkg-config file`

## Run

```sh
make dev        # canvasd on 127.0.0.1:4242 + vite on :5173 (installs web deps on first run)
```

Open `http://localhost:5173/?token=<CANVASD_TOKEN>`. `make dev` sets
`CANVAS_REPO` to the repo root, so agent worktrees land in
`.canvas-worktrees/` and the board database in `.canvas/`.

## Checks

```sh
cargo test --workspace      # daemon unit + e2e tests
cargo clippy --workspace -- -D warnings
cd web && npm run typecheck # tsc --noEmit
cd web && npm run build
```

CI (`.github/workflows/ci.yml`) runs all of the above on every PR, plus a
`cargo check` of the Tauri shell on macOS and Ubuntu.

## Conventions

- Agent `cwd`s are repo-relative; worktrees and the board DB live under the
  repo the daemon was started against (`CANVAS_REPO` overrides).
- Destructive actions go through `confirm_destructive` — never inferred from
  prompt text.
- Keep the protocol versioned: additive JSON fields only, never rename a key.
