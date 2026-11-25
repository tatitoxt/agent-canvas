# Operator Runbook

Build, run, and debug the canvas stack. Everything below is verified
against the Makefile and `crates/canvasd/src/main.rs`.

## Prerequisites

- Rust (stable) + cargo
- Node 20+
- `gh` CLI (optional — `/api/github` falls back to unauthenticated curl)
- For `src-tauri`: the GTK/WebKit system deps the CI `tauri-ubuntu` job
  installs (see `.github/workflows/ci.yml`)

## Run the stack

```sh
make dev
```

`dev` runs `migrate-state` (adopts a legacy `crates/.canvas` DB and
`crates/.canvas-worktrees/*` to the repo root), then starts canvasd with
`CANVAS_REPO=<repo root>` and the Vite dev server. The daemon prints:

```
CANVASD_TOKEN=<per-launch token>
```

Open `http://localhost:5173/?token=<token>`.

Pieces individually:

```sh
make dev-daemon    # canvasd only — CANVAS_REPO="$(CURDIR)", port 4242
make dev-web       # vite only — :5173 (web/vite.config.ts)
```

Or directly:

```sh
cd crates && CANVAS_REPO=/path/to/repo cargo run -p canvasd
cd web && npm ci && npm run dev
```

`CANVASD_PORT` overrides the port (default `4242`).

## canvasctl (inside an agent terminal)

Every spawned PTY gets `CANVAS_PORT`, `CANVAS_TOKEN`,
`CANVAS_AGENT_ID` — `canvasctl` authenticates with those:

```sh
canvasctl agents                                                  # id  status  cmd  name
canvasctl boards                                                  # id  name
canvasctl spawn    --name N --cmd C [--cwd .] [--workspace W] [--board B]
canvasctl delegate --name N --cli C --task T [--cwd .] [--workspace W] [--permission P]
canvasctl artifact --kind K --title T [--path P] [--text T]
```

`delegate` must run inside an agent (`from = CANVAS_AGENT_ID`). A child
reports by printing `CANVAS_RESULT: <summary>` on its PTY — see
`docs/PROTOCOL.md`.

## Logs

canvasd logs via `tracing` to stderr (`RUST_LOG` controls verbosity,
default `info`). With `make dev` daemon and web output share one
terminal; run `make dev-daemon` and `make dev-web` in separate terminals
to keep them apart. To keep a log file without persisting the session
token the daemon prints at startup:

```sh
cargo run -p canvasd 2>&1 | grep -v CANVASD_TOKEN | tee canvasd.log
```

## Clean restart

```sh
pkill -x canvasd
cd crates && cargo build -p canvasd && CANVAS_REPO="$(pwd)/.." cargo run -p canvasd
```

State survives: `.canvas/canvas.db` is reopened, agents are marked
exited (`mark_all_exited`), transcripts stay replayable. Live PTYs do
not survive — respawn them.

## Tests & checks

```sh
cargo test -p canvasd          # daemon unit + e2e tests
cd web && npm test             # vitest run
cd web && npx tsc --noEmit     # strict typecheck
cd web && npm run build        # production bundle
cargo clippy -p canvasd -- -D warnings
make build                     # web build + daemon release build
```

## CI

`.github/workflows/ci.yml` — four jobs on push/PR:

| job           | what it runs |
|---------------|--------------|
| `canvasd`     | `cargo check`, `cargo test`, `cargo clippy -- -D warnings` |
| `web`         | `npm ci`, `tsc --noEmit`, `vitest run`, `vite build` |
| `tauri-ubuntu`| `cargo check` on `src-tauri` with GTK/WebKit deps |
| `tauri-macos` | same on macOS |

The Tauri shell mirrors the daemon's protocol types — a drifted
`SnapshotAgent`/`ServerMsg` field fails `tauri-*` at compile time.

## Common failure modes

**Web client stuck "offline" / 401.** The token is generated per launch —
an old `?token=` in the URL or a bookmark is stale. Copy the fresh
`CANVASD_TOKEN=` line and reload.

**Port in use.** `canvasd` binds `127.0.0.1:4242` (or `CANVASD_PORT`).
`pkill -x canvasd` first, or set `CANVASD_PORT` for a second instance.

**Worktree left behind.** Killing an agent leaves
`.canvas-worktrees/<agent_id>` and branch `agent/<name>-<id>`. Clean
with `git worktree remove .canvas-worktrees/<id> --force` and
`git branch -D agent/<name>-<id>`.

**Board looks empty after moving checkouts.** The DB stores worktree
paths relative to the repo — run `make migrate-state` equivalent or set
`CANVAS_REPO` to the checkout that owns `.canvas/`.

**Empty panel data right after connecting.** The client renders from the
initial `snapshot`; a reconnect mid-flight just needs a moment — the
daemon resends it on every new `/ws` connection.

**GitHub panel empty.** `/api/github` uses `gh api` when `gh` is on PATH;
without it the unauthenticated curl fallback hits rate limits quickly —
install `gh` and run `gh auth login`.
