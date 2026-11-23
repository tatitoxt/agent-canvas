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
    },
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
    },
    /// Run a saved automation once: spawns its agent and injects the prompt.
    RunAutomation { automation_id: String },
    DeleteAutomation { automation_id: String },
    /// Stream an agent's saved transcript back as PtyOutput frames — for
    /// reading dead agents' terminals after they exited or after a
    /// daemon restart.
    Transcript { agent_id: String },
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
    WorkspaceCreated { workspace_id: String, name: String, repo: String, board_id: Option<String> },
    BoardCreated { board_id: String, name: String },
    /// A node (agent or workspace) changed boards.
    BoardMoved { node_id: String, board_id: String },
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
    },
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
