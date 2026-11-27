# Wire Protocol

One websocket carries everything between a client and canvasd
(`GET /ws?token=…` on `127.0.0.1:4242` by default):

- **JSON text frames** — control messages. Client → daemon: `ClientMsg`
  (tagged `cmd`, snake_case). Daemon → client: `ServerMsg` (tagged `type`,
  snake_case). Schemas live in `crates/canvasd/src/protocol.rs`.
- **Binary frames** — PTY bytes, daemon → client only. Frame layout:
  `u8 agent_id_len | agent_id | payload` (`encode_pty_frame` /
  `decode_pty_frame`). Client writes PTY input as base64 JSON instead.

On connect the daemon immediately sends `snapshot` with the full board
state, then streams live events. Auth: `?token=` on `/ws`,
`Authorization: Bearer` on `/api/*` (per-launch random token).

## Client → daemon (`ClientMsg`)

### Agents & terminals

| cmd                 | Fields                                              | Effect |
|---------------------|-----------------------------------------------------|--------|
| `spawn_agent`       | `name`, `command`, `cwd`, `workspace_id?`, `permission?`, `board_id?`, `account_id?`, `initial_input?` | New worktree + PTY. `permission`: `supervised` (default) \| `auto_accept` \| `auto` \| `full`. `initial_input` is typed a few seconds after spawn (Enter appended). |
| `pty_input`         | `agent_id`, `data` (base64)                          | Bytes → PTY. In `supervised` mode the payload is stashed until `approve_input`. |
| `pty_resize`        | `agent_id`, `cols`, `rows`                           | Real `TIOCSWINSZ`. |
| `kill_agent`        | `agent_id`                                           | Terminate the child. |
| `confirm_destructive` | `agent_id`, `action`                               | Destructive-action gate — never triggered by text inside a prompt. |
| `approve_input`     | `agent_id`                                           | Write the supervised mode's stashed input (one pending per agent). |
| `deny_input`        | `agent_id`                                           | Drop the stashed input. |
| `transcript`        | `agent_id`                                           | Replay a dead agent's saved transcript as binary PTY frames. |
| `diff_detail`       | `agent_id`                                           | Full unified diff of uncommitted worktree changes. |
| `git_push`          | `agent_id`                                           | Push the worktree branch to origin. |
| `move_node`         | `agent_id`, `x`, `y`                                 | Persist canvas position (drag end). |

### Boards, workspaces, nodes

| cmd               | Fields                          | Effect |
|-------------------|---------------------------------|--------|
| `create_workspace`| `name`, `repo`, `board_id?`     | Project container — agents spawn in its repo. |
| `delete_workspace`| `workspace_id`                  | Refused while live agents remain; dead ones detach onto the canvas. |
| `create_board`    | `name`                          | New canvas ("Space"). |
| `rename_board`    | `board_id`, `name`              | |
| `delete_board`    | `board_id`                      | Refused while it holds nodes. |
| `move_to_board`   | `node_id`, `board_id`           | Agent or workspace → another board. |
| `rename_node`     | `node_id`, `name`               | |

### Delegation

| cmd        | Fields                                                                 | Effect |
|------------|------------------------------------------------------------------------|--------|
| `delegate` | `from`, `name`, `command`, `task`, `cwd`, `workspace_id?`, `permission?`, `account_id?`, `board_id?` | Spawn the child **as the edge**: `from` (agent id or `"orchestrator"`) is the delegator, `task` is typed into the child PTY. The child's permission is clamped to the parent's. `board_id` overrides the delegator's board (for non-agent delegators). |

The child's report comes back as a `CANVAS_RESULT: <text>` PTY line →
`result` event + the edge resolves.

### Kanban notes, vault, memory, artifacts

| cmd               | Fields                                             | Effect |
|-------------------|----------------------------------------------------|--------|
| `note_upsert`     | `note_id?`, `board_id?`, `col`, `text`, `pos?`, `due?` | No id = create (pos auto); id = move/edit. `due` is `YYYY-MM-DD`. |
| `note_delete`     | `note_id`                                          | |
| `vault_list`      | `dir`                                              | List markdown under a vault dir. |
| `vault_read`      | `dir`, `path`                                      | Read one vault file. |
| `memory_read` / `memory_write` | `node_id` (, `text`)                    | `"main"` = board repo memory; a workspace id = that repo's memory. |
| `artifact_create` | `board_id?`, `agent_id?`, `kind`, `title`, `path?`, `text?` | Register an agent deliverable (`canvasctl artifact`). |
| `artifact_delete` | `artifact_id`                                      | |
| `digest`          | —                                                  | Session digest markdown. |
| `studio_doc`      | `board_id?`                                        | Repo-as-dossier document. |

### Accounts, automations, loops, board-wide control

| cmd                | Fields                                                        | Effect |
|--------------------|---------------------------------------------------------------|--------|
| `create_account`   | `cli`, `label`                                                | Named CLI sign-in; own config dir under `.canvas/accounts/`. |
| `delete_account`   | `account_id`                                                  | Agents fall back to the default. |
| `create_automation`| `name`, `prompt`, `command`, `workspace_id?`, `permission?`, `idle_secs?`, `on_approval?`, `interval_secs?` | Saved task: `idle_secs` = PTY silence before `needs_attention`; `on_approval`: `hold` (default) \| `deny`; `interval_secs` = recurring schedule. |
| `run_automation`   | `automation_id`                                               | One run: spawn + inject prompt. |
| `delete_automation`| `automation_id`                                               | |
| `create_loop`      | `board_id`, `target`, `instruction`, `trigger`, `interval_secs?`, `pattern?` | Re-send instruction to a live console. `trigger`: `interval` \| `idle` \| `match` (PTY tail gains `pattern`). `target`: agent id or `"*"` for the board. |
| `delete_loop`      | `loop_id`                                                     | |
| `set_loop_enabled` | `loop_id`, `enabled`                                          | |
| `pause_all` / `resume_all` | `board_id?`                                        | SIGSTOP/SIGCONT every live agent — PTYs freeze mid-task, output buffers in the kernel. |

## Daemon → client (`ServerMsg`)

Sent once at connect:

| type       | Fields |
|------------|--------|
| `snapshot` | `boards[]`, `agents[]`, `delegations[]`, `workspaces[]`, `layout` (node_id → `[x, y]`), `approvals` (agent_id → held input line), `automations[]`, `accounts[]`, `notes[]`, `artifacts[]`, `loops[]`, `repo_url` (normalized https origin, or null). |

Live events:

| type                  | Fields                                                |
|-----------------------|--------------------------------------------------------|
| `spawned`             | `agent_id`, `name`, `command`, `permission`, `workspace_id?`, `board_id?` |
| `status`              | `agent_id`, `status` — `idle` \| `working` \| `waiting` \| `blocked` \| `done` \| `exited` |
| `activity`            | `agent_id`, `line` — latest non-empty PTY line, ANSI-stripped (the node's live one-liner) |
| `diff`                | `agent_id`, `files`, `paths[]`, `branch` — uncommitted worktree state (the node's diff badge) |
| `needs_approval`      | `agent_id`, `line` — a supervised agent's PTY input matched a destructive pattern and is held |
| `needs_attention`     | `agent_id`, `reason` — an automation guardrail fired (idle past `idle_secs`, or gated input its policy denied) |
| `delegation`          | `edge_id`, `from`, `to`, `task` — new delegation edge    |
| `result`              | `edge_id`, `summary`, `files` — the child's `CANVAS_RESULT` line + changed-file count; resolves the edge |
| `diff_detail`         | `agent_id`, `diff` — `diff_detail` answer              |
| `git_pushed`          | `agent_id`, `output`                                    |
| `workspace_created` / `workspace_deleted` | `workspace_id`, `name`, `repo`, `board_id?` / `workspace_id` |
| `board_created` / `board_renamed` / `board_deleted` | `board_id`, `name` |
| `board_moved` / `node_renamed` | `node_id`, `board_id` / `node_id`, `name`      |
| `account_created` / `account_deleted` | `account_id`, `cli`, `label` / `account_id`    |
| `note_upserted` / `note_deleted` | `note` / `note_id`                               |
| `artifact_created` / `artifact_deleted` | `artifact` / `artifact_id`                     |
| `automation_saved` / `automation_deleted` | `automation` / `automation_id`                 |
| `loop_saved` / `loop_deleted` | `l` / `loop_id`                                        |
| `memory`              | `node_id`, `text` — `memory_read` answer                |
| `session_digest`      | `text` — `digest` answer                               |
| `studio_doc_md`       | `text` — `studio_doc` answer                           |
| `vault_listing` / `vault_file` | `dir`, `entries[]` / `path`, `text` — vault answers |
| `error`               | `agent_id?`, `message` — also the reply for `pause_all`/`resume_all` ("paused N agents") |

### Payload types

- `SnapshotAgent`: `agent_id`, `name`, `command`, `worktree`, `status`,
  `permission`, `workspace_id`, `board_id`, `account_label`,
  `output_bytes` (PTY bytes captured to disk — usage metering).
- `SnapshotDelegation`: `edge_id`, `from`, `to`, `task`, `result`,
  `files`, `state`, `created_at`, `resolved_at` (ISO — the history panel
  replays the graph over time).
- `SnapshotWorkspace`: `workspace_id`, `name`, `repo`, `board_id`.
- `SnapshotBoard`: `board_id`, `name`.
- `SnapshotAccount`: `account_id`, `cli`, `label`.
- `SnapshotNote`: `note_id`, `board_id`, `col`, `text`, `pos`, `due?`.
- `SnapshotArtifact`: `artifact_id`, `board_id`, `agent_id`,
  `agent_name`, `kind`, `title`, `path`, `text`, `created_at`.
- `SnapshotAutomation`: `id`, `name`, `prompt`, `command`,
  `workspace_id`, `permission`, `idle_secs`, `on_approval`,
  `last_run_at`, `interval_secs`, `next_run_at`.
- `SnapshotLoop`: `loop_id`, `board_id`, `target`, `instruction`,
  `trigger`, `interval_secs`, `pattern`, `enabled`, `last_fired_at`.

## HTTP surface

| Route                     | Auth                    | Purpose |
|---------------------------|-------------------------|---------|
| `GET /health`             | —                       | `{status, version}`. |
| `GET /ws?token=…`         | token                   | The channel above. |
| `GET /api/github/{*rest}?…` | `Authorization: Bearer` | Proxies `api.github.com` via `gh api` when `gh` is installed (authenticated), `curl` otherwise. |
| `POST /api/share`         | `Authorization: Bearer` | Publish base64 artifact bytes (decoded cap 8 MB) → `{id, url}`. Lives only while the daemon runs. |
| `GET /share/{id}`         | —                       | Public by design: the unguessable 16-hex id is the capability. Streams the bytes inline with their mime type. |
| `GET /api/export`         | `Authorization: Bearer` | Full board-state dump (boards, layout, agents, workspaces, delegations), `version: 1`. |

In the Tauri shell these endpoints are native commands (`github_proxy`,
`share_create`, `export_state`) plus an embedded localhost server that
serves `/share/{id}` and `/api/export` on an ephemeral port — see
ARCHITECTURE.md.

## `canvasctl`

In-PTY helper (`crates/canvasd/src/bin/canvasctl.rs`). Every agent PTY
gets `CANVAS_PORT`, `CANVAS_TOKEN`, `CANVAS_AGENT_ID`, so a process inside
a terminal can drive its own canvas:

| Command      | Effect |
|--------------|--------|
| `canvasctl agents`   | `agent_id  status  command  name` per agent (from the snapshot). |
| `canvasctl boards`   | `board_id  name` per board. |
| `canvasctl spawn --name N --cmd C [--cwd .] [--workspace W] [--board B]` | `spawn_agent`. |
| `canvasctl delegate --name N --cli C --task T [--cwd .] [--workspace W] [--permission P]` | `delegate` with `from = CANVAS_AGENT_ID` — must run inside an agent. |
| `canvasctl artifact --kind K --title T [--path P] [--text T]` | `artifact_create`. |

## Result contract

A delegated child reports by printing one line on its PTY:

```
CANVAS_RESULT: <one-line summary>
```

The daemon scans each PTY line's **last non-empty `\r`-segment** (real
terminal semantics — a prompt can't overwrite its way into a fake
result) and emits `result`, resolving the delegation edge with the
child's changed-file count.
