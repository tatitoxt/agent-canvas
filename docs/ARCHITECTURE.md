# Architecture

agent-canvas is a visual orchestrator for real coding-agent terminals. Each
"agent" is a genuine child process running inside a PTY on a dedicated git
worktree — the canvas is a map of live terminals and the delegation edges
between them, not a simulation.

```
┌─────────────────┐   websocket + binary PTY frames    ┌──────────────────┐
│  web/ (React,   │◄──────────────────────────────────►│   canvasd        │
│  Vite, React    │                                    │   (Rust, axum)   │
│  Flow, xterm.js)│                                    │                  │
└─────────────────┘                                    │  AgentManager ───┼─► PTY per agent
        ▲                                              │  (portable-pty)  │    (bash, claude,
        │                                              │                  │     codex, …)
┌─────────────────┐                                    │  Store ──────────┼─► SQLite (.canvas/
│  src-tauri      │   same protocol, mirrored          │                  │    canvas.db)
│  (Tauri 2 shell)│   server in Rust                   │  /api/github ────┼─► gh api / curl
└─────────────────┘                                    └──────────────────┘
```

Three runtimes share one wire protocol:

- **`crates/canvasd`** — the daemon. Owns every PTY, the SQLite board store,
  the websocket event bus and the GitHub proxy. Binds to `127.0.0.1` only;
  every connection needs the per-launch session token.
- **`web/`** — the browser client. Talks to canvasd directly over `ws://`
  (binary frames for PTY bytes, JSON text frames for control).
- **`src-tauri`** — the desktop shell. Its Rust side embeds a mirrored copy
  of the daemon logic (same agent manager + store + snapshot types) so the
  app works without a separately running daemon; the React frontend is
  unchanged and speaks the same message shapes.

## The daemon (`crates/canvasd`)

### AgentManager (`src/agent.rs`)

Spawns each agent with `portable-pty`:

- **Per-agent git worktree.** `spawn` runs
  `git worktree add .canvas-worktrees/<id> -b agent/<name>-<id> HEAD` in the
  agent's repo and launches the command with `cwd` inside it. Work is
  isolated: two agents can edit the same project on different branches
  simultaneously. Diff state (`dirty_files`, `dirty_diff`, `worktree_branch`)
  is computed against that worktree.
- **PTY plumbing.** One task reads the PTY and broadcasts bytes (tagged with
  the agent id) to every websocket client; writes from the client go to the
  PTY. Output is appended to a saved transcript so a dead agent's terminal
  can be replayed after restart.
- **Result scanner.** The rolling PTY tail is scanned for
  `CANVAS_RESULT: <text>` — the contract by which a delegated child reports
  back. Carriage returns are honored like a real screen (only the last
  non-empty `\r`-segment per line counts) so a prompt that overwrites itself
  can't fake a result.
- **Env for `canvasctl`.** Each PTY gets `CANVAS_PORT`, `CANVAS_TOKEN` and
  `CANVAS_AGENT_ID` so the `canvasctl` helper inside the terminal can call
  back into the daemon.
- **Supervised input gate.** In the `supervised` permission mode, operator
  input typed in the terminal is stashed and only written after
  `approve_input` — the daemon holds one pending payload per agent.

### Store (`src/store.rs`)

SQLite at `.canvas/canvas.db` (relative to `CANVAS_REPO`). Boards, agents,
workspaces, delegation edges, notes, artifacts, accounts, automations and
loops all persist, so a daemon restart reconstructs the canvas exactly —
live agents are reconnected, dead ones keep their transcripts.

Worktree paths are stored **relative** (`.canvas-worktrees/<id>`) in the
`agents` table and resolved against the repo the agent spawned in —
the workspace repo when set, else `CANVAS_REPO`. This is what lets
`.canvas/` be moved between machines/checkouts without breaking the board.

### Server (`src/main.rs`)

axum on `127.0.0.1:4242` (or `CANVAS_PORT`):

- `GET /ws?token=…` — the websocket. On connect it immediately sends a
  `snapshot` (boards, agents, delegations, workspaces, accounts, notes,
  artifacts, automations, loops, node layout, pending approvals) then
  streams `Event`s: control
  messages as JSON text frames, PTY bytes as binary frames
  (`encode_pty_frame`).
- `GET /health` — `{status, version}`.
- `GET /api/github/{*rest}` — proxies the GitHub REST API through `gh api`
  when `gh` is installed (carrying auth), unauthenticated `curl` otherwise.
  Lets the frontend read branches/PRs without embedding a token.

Auth is a per-launch random token compared in constant time; `?token=` on
the websocket, `Authorization: Bearer` on `/api/*`.

## The web client (`web/`)

- `daemon/client.ts` — websocket transport: deserializes `ServerMsg`, sends
  `ClientMsg`, demuxes binary PTY frames by agent id.
- `store/board.ts` — the zustand store and the single source of truth on the
  client. Reduces every `ServerMsg` into `agents`, `edges`, `boards`,
  `notes`, `artifacts`, `accounts`; orchestrator cards are client-side
  state persisted in localStorage. The snapshot handler rebuilds the whole
  board at connect.
- `App.tsx` — the React Flow canvas. Nodes are agent terminals, workspaces,
  orchestrators and notes; edges are delegation threads.
- `components/NavRail.tsx` + panels — the left rail (sections, explorer,
  source control, tickets) and right-side panels.
- xterm.js renders each agent's PTY live; `sendInput`/`ptyResize` round-trip
  real keystrokes and terminal sizes back to the kernel PTY.

## The Tauri shell (`src-tauri/`)

The desktop app duplicates the daemon's server-side logic in Rust rather
than spawning `canvasd`: it builds the same `Snapshot` payload and
answers the same websocket protocol, pointed at the same `.canvas`
directory. **Any change to `protocol.rs` types or snapshot fields must
be mirrored in `src-tauri/src/main.rs`** — the CI `tauri-*` jobs catch a
drift as a compile error.

## Delegation edges

An edge is created by `ClientMsg::Delegate` (or `canvasctl delegate` inside
an agent): `from` is the delegating node (an agent id or `"orchestrator"`),
the spawned child becomes the edge's `to`, and `task` is injected into the
child's PTY as its brief.

```
delegator ──edge: task──► child agent (new worktree, clamped permission)
   ▲                           │
   └──edge: result─────────────┘  child prints CANVAS_RESULT: <text>
                                  → `result` event; the store flips the
                                    edge 'delegated' → 'returned' with
                                    the child's changed-file count
```

A child's permission level is clamped to its parent's — a `supervised`
agent can never spawn an `auto`/`full` one
(`clamp_to_parent` in `protocol.rs`).

## Permission modes

Most → least restrictive (`normalize_permission`):

| Level         | Behavior                                                    |
|---------------|-------------------------------------------------------------|
| `supervised`  | Operator input is gated; held until `approve_input`.        |
| `auto_accept` | Input flows, but destructive actions need `confirm_destructive`. |
| `auto`        | Free input; destructive actions still confirmed explicitly. |
| `full`        | Fully autonomous.                                           |

Unknown or missing values normalize to `supervised`.
