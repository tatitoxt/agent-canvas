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
    },
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
    /// Persist a node's canvas position (drag end).
    MoveNode {
        agent_id: String,
        x: f64,
        y: f64,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    Spawned { agent_id: String, name: String },
    Status { agent_id: String, status: AgentStatus },
    Error { agent_id: Option<String>, message: String },
    #[allow(dead_code)] // emitted by the orchestration layer (P2)
    Delegation { edge_id: String, from: String, to: String, task: String },
    #[allow(dead_code)] // emitted by the orchestration layer (P2)
    Result { edge_id: String, summary: String },
    /// Board state replay sent once when a client connects: every agent the
    /// board knows (live and dead) plus saved node positions.
    Snapshot {
        agents: Vec<SnapshotAgent>,
        layout: std::collections::HashMap<String, (f64, f64)>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotAgent {
    pub agent_id: String,
    pub name: String,
    pub command: String,
    pub worktree: String,
    pub status: String,
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
