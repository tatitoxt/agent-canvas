# Roadmap

Where the code is today and where it goes next. Every "now" line names the
files that implement it; "next" items are staged, not committed.

## Now

**Daemon & transport**
- `canvasd`: axum daemon on `127.0.0.1:4242`, per-launch token auth —
  `crates/canvasd/src/main.rs`.
- WebSocket protocol: JSON control frames (`ClientMsg`/`ServerMsg`) +
  binary PTY frames (`u8 len | agent_id | payload`) —
  `crates/canvasd/src/protocol.rs`, `docs/PROTOCOL.md`.
- Real PTY per agent via `portable-pty`, rolling scrollback, ANSI-aware
  `CANVAS_RESULT:` tail scanner — `crates/canvasd/src/agent.rs`.
- Per-agent git worktrees under `.canvas-worktrees/<id>` on branch
  `agent/<name>-<id>` — `agent.rs` (`spawn`), `main.rs` (`create agent`).

**State & persistence**
- SQLite board store at `.canvas/canvas.db`: boards, agents, workspaces,
  delegations, notes, artifacts, accounts, automations, loops —
  `crates/canvasd/src/store.rs`. Daemon restart replays it into `snapshot`;
  dead agents keep saved transcripts replayable via `transcript`.

**Safety model**
- Permission ladder `supervised → auto_accept → auto → full`, unknown
  values normalize to `supervised` — `protocol.rs`
  (`normalize_permission`, `permission_rank`, `clamp_to_parent`).
- Supervised-input gate: `pty_input` is stashed until `approve_input`;
  destructive input surfaces as `needs_approval` — `main.rs`, `agent.rs`
  (`sensitive_line`).
- `confirm_destructive` gate: kills/cleanup only execute from an explicit
  control message, never from text inside a prompt.

**Canvas**
- React Flow board: agent terminals, workspaces, orchestrators, shapes,
  markdown nodes, kanban notes — `web/src/App.tsx`, `web/src/board/`,
  `web/src/components/{ShapeNode,MdNode}.tsx`.
- Spaces (boards) with per-board agents — `NavRail.tsx` (`SpacesBubble`),
  `store.rs` (`boards`), `board.ts` (`activeBoard`).
- Live xterm.js terminal per node with real resize/keystrokes —
  `TerminalPanel.tsx`, `client.ts` binary frame demux.

**Orchestration**
- Orchestrator nodes that wire consoles and broadcast —
  `board.ts` (`orchestrators`, `spawnOrchestrator`), `App.tsx`.
- Delegation edges: `delegate` spawns the child carrying `task`;
  `CANVAS_RESULT:` resolves the edge with a changed-file count —
  `main.rs`, `store.rs` (`delegations`), `protocol.rs` (`Delegation`,
  `Result`).
- Dex: the command input in the bottom dock — parses "spawn two codex /
  three reviewers", `terminal N`, CLIs (`claude`, `codex`, `gemini`,
  `bash`, `aider`, …) — `board.ts` (`threadSend`, ~line 1199),
  `NavRail.tsx` (`BottomDock`), `ThreadPanel.tsx`.
- Automations (saved, guardrailed tasks: `idle_secs`, `on_approval`,
  `interval_secs` schedule) and Loops (`interval`/`idle`/`match`
  triggers) — `store.rs`, `main.rs`, `AutomationsPanel.tsx`,
  `LoopsPanel.tsx`.

**Panels**
- Juice (per-agent usage: `output_bytes`, files) —
  `UsagePanel.tsx`, `SnapshotAgent.output_bytes`.
- GitHub PR + issue panels via the `/api/github` proxy —
  `GitHubPanel.tsx`, `main.rs` (`github_proxy`).
- Vault explorer, Notes/dev tickets, Artifacts, Memory, Presets, Skills,
  Accounts, Digest, Studio doc, Inbox (approvals + waiting + in-flight
  delegations), History (delegation replay) — `web/src/components/*Panel.tsx`.
- Capture tools: pencil markups, region shot, canvas shot, session digest,
  studio doc — `ToolsRail.tsx` (`ToolsMenu`, `ToolsMenuActions`).

**Shells**
- Tauri 2 desktop shell embedding the same daemon logic and protocol —
  `src-tauri/src/main.rs`.

## Next

**Stage 1 — per-CLI awareness**
- Parse CLI-specific replies: each supported CLI (`claude`, `codex`,
  `gemini`, `aider`, … — the Dex keyword list in `board.ts`) gets a real
  status/reply parser instead of the generic tail scan. Extends
  `canvas_result_line`/`last_visible_line` in `agent.rs`.
- Per-CLI usage metering: `SnapshotAgent.output_bytes` already counts PTY
  bytes; next is real token/cost metering per CLI in `UsagePanel`/Juice.

**Stage 2 — durable sessions**
- Today: DB + transcripts survive restarts; live PTYs do not
  (`mark_all_exited` on boot — `main.rs`). Next: reattach live agents
  across daemon restarts (persist spawn args + PTY hand-off).

**Stage 3 — machines & bridges**
- The Topbar machine menu already stubs `Cloud box` and `Phone`
  (`Topbar.tsx`, `drop("machine")`) — a remote runner that speaks the
  same protocol, paired devices.
- Extras bubble already lists `VS Code`, `Discord`, `GitHub Actions`
  marked "soon" (`NavRail.tsx`, `ExtrasBubble`) — external app bridges
  land there.

**Stage 4 — automation marketplace**
- Automations + loops already persist and schedule (`store.rs`); next is
  a shareable marketplace layer — import/export definitions, discovery.
