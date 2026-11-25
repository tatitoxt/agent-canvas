//! Versioned wire protocol between the web client and canvasd.
//!
//! Control channel: JSON text frames (`ClientMsg`/`ServerMsg`).
//! PTY output: binary frames — `[id_len:u8][agent_id:utf8][payload:bytes]`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum ClientMsg {
    SpawnAgent {
        name: String,
        /// Command to run inside the PTY, e.g. "claude" or "bash".
        command: String,
        /// Working directory inside the board's repository.
        cwd: String,
        /// Workspace container this agent belongs to (none = loose node).
        workspace_id: Option<String>,
        /// Permission ladder level: "supervised" | "auto_accept" | "auto" | "full".
        /// Unknown/None values normalize to "supervised" (most restrictive).
        permission: Option<String>,
        /// Canvas board this node lives on; None = the default "main" board.
        board_id: Option<String>,
        /// Named account profile this agent signs in as — two terminals of
        /// the same CLI can run different accounts side by side.
        account_id: Option<String>,
        /// Text typed into the PTY a few seconds after spawn (a "quick
        /// request" — Deska-style task given at spawn time, Enter appended).
        #[serde(default)]
        initial_input: Option<String>,
    },
    /// Create a workspace container — user-defined project groupings that
    /// coexist spatially on the same canvas.
    CreateWorkspace {
        name: String,
        /// Absolute path to the repo this workspace runs agents in.
        repo: String,
        /// Board the workspace node appears on; None = "main".
        board_id: Option<String>,
    },
    /// Create a named board — a separate canvas with its own agents,
    /// workspaces and edges (Deska "Spaces").
    CreateBoard { name: String },
    /// Move an agent or workspace node to another board.
    MoveToBoard { node_id: String, board_id: String },
    /// Rename an agent or workspace node.
    RenameNode { node_id: String, name: String },
    /// Set the ordered CLI fallback chain for a workspace. Spawned agents
    /// whose CLI dies at launch retry with the next entry automatically.
    SetAgentChain { workspace_id: String, chain: Vec<String> },
    /// Change a live agent's permission level ("always allow" bumps
    /// supervised → auto so future commands stop asking).
    SetPermission { agent_id: String, permission: String },
    /// Rename a board.
    RenameBoard { board_id: String, name: String },
    /// Delete a board — refused while it still holds nodes.
    DeleteBoard { board_id: String },
    /// Remove a delegation record (and its edge) from the board.
    DeleteDelegation { edge_id: String },
    /// Create or update a kanban note: no id = create (pos auto),
    /// id = move/edit (col/text/pos replace).
    NoteUpsert {
        note_id: Option<String>,
        board_id: Option<String>,
        col: String,
        text: String,
        pos: Option<i64>,
        /// Optional due date (YYYY-MM-DD) — the calendar dimension.
        due: Option<String>,
    },
    /// Delete a kanban note.
    NoteDelete { note_id: String },
    /// List markdown files under a vault directory (Obsidian-style vault).
    VaultList { dir: String },
    /// Read one file from the vault.
    VaultRead { dir: String, path: String },
    /// Read one file without making it "the open note" — powers `![[embeds]]`.
    VaultPeek { dir: String, path: String },
    /// Read a binary vault asset (image) as base64 — powers `![[image.png]]`.
    /// Allowed extensions only (png/jpg/jpeg/gif/webp/svg/ico), root-scoped.
    VaultAsset { dir: String, path: String },
    /// Append markdown text to a vault file — Dex's "leave it in Obsidian"
    /// path. Creates the file (and parent dirs) when missing; the path is
    /// constrained to the vault root and must end in .md.
    VaultAppend { dir: String, path: String, text: String },
    /// Overwrite a vault file with the given text — editing notes inside
    /// the app. Same constraints as vault_append (root-scoped, .md only,
    /// creates parent dirs).
    VaultWrite { dir: String, path: String, text: String },
    /// Write a binary file into the vault (base64 body) — OS drag & drop
    /// of attachments (images, pdfs, anything). Root-scoped, no `..`,
    /// 8 MiB decoded cap, name deduped with `-N` on collision.
    VaultWriteAsset { dir: String, path: String, data: String },
    /// Delete a markdown file from the vault (root-scoped, .md only).
    VaultDelete { dir: String, path: String },
    /// Rename/move a markdown file inside the vault (root-scoped, .md only).
    VaultRename { dir: String, path: String, new_path: String },
    /// Build the whole-vault link graph (all notes + resolved links).
    VaultGraph { dir: String },
    /// Full-text search across the vault's markdown files.
    VaultSearch { dir: String, query: String },
    /// Discover Obsidian vaults registered on this machine — the native
    /// integration surface is obsidian.json plus `.obsidian/` folders.
    VaultDiscover,
    /// Register a directory as an Obsidian vault (creates `.obsidian/` and
    /// adds it to obsidian.json) so it opens from the real Obsidian app too.
    VaultRegister { dir: String },
    /// Push an agent's worktree branch to origin (its committed work).
    GitPush { agent_id: String },
    /// Register an artifact (an agent's deliverable — a report, plan,
    /// exported file). Agents emit these via canvasctl.
    ArtifactCreate {
        board_id: Option<String>,
        agent_id: Option<String>,
        kind: String,
        title: String,
        path: Option<String>,
        text: Option<String>,
    },
    /// Remove an artifact.
    ArtifactDelete { artifact_id: String },
    /// A digest of every agent: status, files touched, transcript tail.
    Digest,
    /// Build a "studio" document: repo materialized as a markdown dossier
    /// (tree + README + agents + notes + artifacts) — repo→material.
    StudioDoc { board_id: Option<String> },
    /// Read a node's memory file — "main" is the board repo's memory,
    /// a workspace id reads that workspace's repo memory.
    MemoryRead { node_id: String },
    /// Overwrite a node's memory file.
    MemoryWrite { node_id: String, text: String },
    /// Delete a workspace — refused while it holds live agents; dead
    /// agents are detached and stay on the canvas.
    DeleteWorkspace { workspace_id: String },
    PtyInput {
        agent_id: String,
        /// Base64-encoded bytes to write to the PTY.
        data: String,
    },
    PtyResize {
        agent_id: String,
        cols: u16,
        rows: u16,
    },
    KillAgent {
        agent_id: String,
    },
    /// Destructive action gate: the backend only executes `kill` or cleanup
    /// when this is sent — never from text inside a prompt.
    ConfirmDestructive {
        agent_id: String,
        action: String,
    },
    /// Supervised-input gate: writes the stashed payload the operator just
    /// approved (the daemon holds one pending input per agent).
    ApproveInput { agent_id: String },
    /// Drops the stashed payload — the agent never receives it.
    DenyInput { agent_id: String },
    /// Persist a node's canvas position (drag end).
    MoveNode {
        agent_id: String,
        x: f64,
        y: f64,
    },
    /// Spawn an agent AS a delegation edge: `from` is the delegating node id
    /// ("orchestrator" or an agent id). The edge carries `task` down and the
    /// child's `CANVAS_RESULT:` PTY line back as the Result event.
    Delegate {
        from: String,
        name: String,
        command: String,
        task: String,
        cwd: String,
        workspace_id: Option<String>,
        permission: Option<String>,
        account_id: Option<String>,
        /// Explicit target board — the child lands here instead of on the
        /// delegator's board (delegators that aren't agents, e.g. an
        /// orchestrator node, have no board row to inherit).
        board_id: Option<String>,
        /// Optional first input typed into the child's PTY after boot
        /// (e.g. a handoff brief) — the edge's `task` stays the short label.
        initial_input: Option<String>,
    },
    /// Register a named account for a CLI (e.g. a second Codex sign-in).
    /// The account gets its own config dir under .canvas/accounts/; `env`
    /// optionally overrides which env var points at it (for CLIs without
    /// a built-in config-dir key).
    CreateAccount { cli: String, label: String, env: Option<String> },
    /// Remove a named account — agents that used it fall back to default.
    DeleteAccount { account_id: String },
    /// Define an automation: a saved task that runs an agent with a prompt
    /// and guardrails (idle hang limit + approval policy).
    CreateAutomation {
        name: String,
        prompt: String,
        command: String,
        workspace_id: Option<String>,
        permission: Option<String>,
        /// Seconds of PTY silence before a `needs_attention` alert fires.
        idle_secs: Option<u64>,
        /// "hold" (default: wait for operator) or "deny" (drop gated input).
        on_approval: Option<String>,
        /// Re-run automatically every N seconds (schedule); null = manual.
        interval_secs: Option<u64>,
    },
    /// Run a saved automation once: spawns its agent and injects the prompt.
    RunAutomation { automation_id: String },
    DeleteAutomation { automation_id: String },
    /// Define a loop: a saved instruction the daemon re-sends to a live
    /// console on a trigger — 'interval' (every interval_secs), 'idle'
    /// (when the agent finishes/goes idle) or 'match' (when the PTY tail
    /// gains `pattern`). `target` is an agent id or "*" for the board.
    CreateLoop {
        board_id: String,
        target: String,
        instruction: String,
        trigger: String,
        interval_secs: Option<u64>,
        pattern: Option<String>,
    },
    DeleteLoop { loop_id: String },
    SetLoopEnabled { loop_id: String, enabled: bool },
    /// Fire a loop's instruction immediately, regardless of its schedule.
    RunLoop { loop_id: String },
    /// SIGSTOP/SIGCONT every live agent on a board — Symvibe's
    /// "pause all": PTYs freeze mid-task, output buffers in the kernel.
    PauseAll { board_id: Option<String> },
    ResumeAll { board_id: Option<String> },
    /// Stream an agent's saved transcript back as PtyOutput frames — for
    /// reading dead agents' terminals after they exited or after a
    /// daemon restart.
    Transcript { agent_id: String },
    /// Full unified diff of the agent's uncommitted worktree changes.
    DiffDetail { agent_id: String },
}

/// Deska-style permission ladder, most → least restrictive. The level
/// gates what an agent may do without a human confirm in the loop.
pub fn normalize_permission(level: Option<&str>) -> &'static str {
    match level {
        Some("full" | "full_access") => "full",
        Some("auto") => "auto",
        Some("auto_accept" | "auto-accept") => "auto_accept",
        _ => "supervised",
    }
}

fn permission_rank(level: &str) -> u8 {
    match level {
        "full" => 3,
        "auto" => 2,
        "auto_accept" => 1,
        _ => 0,
    }
}

/// A delegation child may never exceed its parent's level — a supervised
/// agent can't spawn an autonomous one behind the operator's back.
pub fn clamp_to_parent<'a>(requested: &'a str, parent: Option<&str>) -> &'a str {
    match parent {
        Some(p) if permission_rank(requested) > permission_rank(p) => match p {
            "full" => "full",
            "auto" => "auto",
            "auto_accept" => "auto_accept",
            _ => "supervised",
        },
        _ => requested,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    Spawned { agent_id: String, name: String, command: String, permission: String, workspace_id: Option<String>, board_id: Option<String> },
    Status { agent_id: String, status: AgentStatus },
    /// Live one-line activity preview — the agent's latest non-empty PTY
    /// line, ANSI-stripped. Deska's "background work" summaries: the node
    /// shows what the agent is doing without opening the terminal.
    Activity { agent_id: String, line: String },
    /// Files with uncommitted changes in the agent's worktree — the
    /// node's diff badge; what the delegation actually produced.
    Diff { agent_id: String, files: u32, paths: Vec<String>, branch: String },
    /// A supervised agent's PTY input matched a destructive pattern and
    /// is held until ApproveInput/DenyInput.
    NeedsApproval { agent_id: String, line: String },
    /// An automation guardrail fired: the agent hung past its idle limit
    /// or hit a gated command its policy denied.
    NeedsAttention { agent_id: String, reason: String },
    AutomationSaved { automation: SnapshotAutomation },
    AutomationDeleted { automation_id: String },
    Error { agent_id: Option<String>, message: String },
    Delegation { edge_id: String, from: String, to: String, task: String },
    Result { edge_id: String, summary: String, files: u32 },
    /// A delegated child exited without ever printing a result —
    /// the ticket is done but empty-handed.
    DelegationFailed { edge_id: String },
    WorkspaceCreated { workspace_id: String, name: String, repo: String, board_id: Option<String> },
    BoardCreated { board_id: String, name: String },
    /// A node (agent or workspace) changed boards.
    BoardMoved { node_id: String, board_id: String },
    /// A node was renamed.
    NodeRenamed { node_id: String, name: String },
    PermissionChanged { agent_id: String, permission: String },
    /// A board was renamed.
    BoardRenamed { board_id: String, name: String },
    /// A board was deleted (only emitted for empty boards).
    BoardDeleted { board_id: String },
    /// A delegation record was removed; clients drop the edge.
    DelegationRemoved { edge_id: String },
    /// A workspace was deleted; agents keep existing detached from it.
    WorkspaceDeleted { workspace_id: String },
    /// Unified diff text for one agent's worktree (DiffDetail answer).
    DiffDetail { agent_id: String, diff: String },
    /// Board state replay sent once when a client connects: every agent the
    /// board knows (live and dead) plus saved node positions.
    Snapshot {
        boards: Vec<SnapshotBoard>,
        agents: Vec<SnapshotAgent>,
        delegations: Vec<SnapshotDelegation>,
        workspaces: Vec<SnapshotWorkspace>,
        layout: std::collections::HashMap<String, (f64, f64)>,
        /// Held supervised inputs: agent_id → the line awaiting approval.
        /// Replayed so late-joining clients still see pending gates.
        approvals: std::collections::HashMap<String, String>,
        automations: Vec<SnapshotAutomation>,
        /// Registered named accounts (id, cli, label).
        accounts: Vec<SnapshotAccount>,
        /// Kanban notes across boards.
        notes: Vec<SnapshotNote>,
        /// Agent-produced artifacts.
        artifacts: Vec<SnapshotArtifact>,
        /// Autopilot loops across boards.
        loops: Vec<SnapshotLoop>,
        /// The board repo's git remote (https-normalized) — powers the
        /// GitHub shortcuts in the web UI; None when there is no origin.
        repo_url: Option<String>,
    },
    /// A named account was registered.
    AccountCreated { account_id: String, cli: String, label: String, env: Option<String> },
    /// A named account was removed.
    AccountDeleted { account_id: String },
    /// Memory file contents (MemoryRead answer).
    Memory { node_id: String, text: String },
    /// Session digest markdown (Digest answer).
    SessionDigest { text: String },
    /// Studio document markdown (StudioDoc answer).
    StudioDocMd { text: String },
    /// A kanban note was created or edited.
    NoteUpserted { note: SnapshotNote },
    /// A kanban note was removed.
    NoteDeleted { note_id: String },
    /// An artifact was registered.
    ArtifactCreated { artifact: SnapshotArtifact },
    /// git push finished for an agent's worktree.
    GitPushed { agent_id: String, output: String },
    /// Vault file listing (VaultList answer): "sub/path.md" entries.
    VaultListing { dir: String, entries: Vec<String> },
    /// Vault file contents (VaultRead answer).
    VaultFile { path: String, text: String },
    /// Vault file contents for an embed (VaultPeek answer) — cached client-side,
    /// never replaces the open note.
    VaultPeeked { path: String, text: String },
    /// Binary vault asset (VaultAsset answer): base64 body + mime.
    VaultAssetData { path: String, mime: String, data: String },
    /// Vault search hits (VaultSearch answer).
    VaultHits { dir: String, query: String, hits: Vec<VaultHit> },
    /// Whole-vault link graph (VaultGraph answer): every note plus every
    /// resolved [[link]] or (x.md) edge between them.
    VaultGraph { dir: String, nodes: Vec<String>, edges: Vec<(String, String)> },
    /// Obsidian vaults discovered on this machine (VaultDiscover answer).
    VaultDiscovered { vaults: Vec<VaultLocation> },
    /// An artifact was removed.
    ArtifactDeleted { artifact_id: String },
    /// A loop was created.
    LoopSaved { l: SnapshotLoop },
    /// A loop was removed.
    LoopDeleted { loop_id: String },
}

/// One Obsidian vault known on this machine.
#[derive(Debug, Clone, Serialize)]
pub struct VaultLocation {
    /// Display name (folder basename).
    pub name: String,
    /// Absolute vault path.
    pub path: String,
}

/// One matching line from a vault full-text search.
#[derive(Debug, Clone, Serialize)]
pub struct VaultHit {
    /// Vault-relative path.
    pub path: String,
    /// 1-based line number.
    pub line: u32,
    /// Trimmed line text (capped).
    pub text: String,
}

/// An autopilot loop in a snapshot.
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotLoop {
    pub loop_id: String,
    pub board_id: String,
    /// Agent id or "*" (all live agents on the board).
    pub target: String,
    pub instruction: String,
    /// 'interval' | 'idle' | 'match'.
    pub trigger: String,
    pub interval_secs: Option<u64>,
    pub pattern: Option<String>,
    pub enabled: bool,
    pub last_fired_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotAutomation {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub command: String,
    pub workspace_id: Option<String>,
    pub permission: String,
    pub idle_secs: u64,
    pub on_approval: String,
    pub last_run_at: Option<String>,
    pub interval_secs: Option<u64>,
    pub next_run_at: Option<String>,
}

/// A deliverable produced by an agent (or dropped in by the user):
/// kind drives the panel's symbol + color (report/plan/diff/log/image/note).
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotArtifact {
    pub artifact_id: String,
    pub board_id: String,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub kind: String,
    pub title: String,
    pub path: Option<String>,
    pub text: Option<String>,
    pub created_at: String,
}

/// A kanban card in a snapshot.
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotNote {
    pub note_id: String,
    pub board_id: String,
    pub col: String,
    pub text: String,
    pub pos: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotAccount {
    pub account_id: String,
    pub cli: String,
    pub label: String,
    pub env: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotBoard {
    pub board_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotWorkspace {
    pub workspace_id: String,
    pub name: String,
    pub repo: String,
    pub board_id: Option<String>,
    /// Ordered CLI fallback chain; None = the daemon's auto-detected default.
    pub agent_chain: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotDelegation {
    pub edge_id: String,
    pub from: String,
    pub to: String,
    pub task: String,
    pub result: Option<String>,
    /// Files the child changed in its worktree — what the edge produced.
    pub files: u32,
    pub state: String,
    /// ISO timestamps — the history panel replays the graph over time.
    pub created_at: Option<String>,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotAgent {
    pub agent_id: String,
    pub name: String,
    pub command: String,
    pub worktree: String,
    pub status: String,
    pub permission: String,
    pub workspace_id: Option<String>,
    pub board_id: Option<String>,
    /// Label of the named account this agent signs in as, if any.
    pub account_label: Option<String>,
    /// Bytes of PTY output captured to disk (usage metering).
    pub output_bytes: u64,
    /// Uncommitted-change count / paths / branch of the worktree —
    /// replayed in the snapshot so a fresh client isn't stuck on
    /// "clean" until the diff ticker next fires.
    pub files: u32,
    pub paths: Vec<String>,
    pub branch: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Idle,
    Working,
    Waiting,
    Blocked,
    Done,
    Exited,
}

pub fn encode_pty_frame(agent_id: &str, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(1 + agent_id.len() + payload.len());
    out.push(agent_id.len() as u8);
    out.extend_from_slice(agent_id.as_bytes());
    out.extend_from_slice(payload);
    out
}

pub fn decode_pty_frame(frame: &[u8]) -> Option<(&str, &[u8])> {
    let (&len, rest) = frame.split_first()?;
    let (id, payload) = rest.split_at_checked(len as usize)?;
    let id = std::str::from_utf8(id).ok()?;
    Some((id, payload))
}
