//! Transport plumbing and shared wire-shaped snapshots for the canvas control
//! protocol.
//!
//! The daemon serves the protocol from its own binary; the native shell serves
//! the orchestration subset from its embedded localhost server. Both sides use
//! these helpers so token generation/comparison, snapshot shape, and the
//! WebSocket framing contract cannot drift apart.

use crate::agent::{
    dirty_diff, dirty_files, last_visible_line, sensitive_line, worktree_branch, AgentManager,
};
use crate::orchestrate::{DelegateParams, Orchestrator, SpawnParams};
use crate::protocol::{self, ClientMsg, ServerMsg};
use crate::store::{self, Store};
use anyhow::Result;
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Router,
};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

/// Constant-time token compare — avoids early-exit leaks on the auth path.
pub fn token_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

pub fn generate_token() -> String {
    use rand::RngCore;
    let mut buf = [0u8; 32];
    rand::rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Who authenticated to the native control socket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlIdentity {
    /// The per-launch operator/test token. This is intentionally not injected
    /// into PTYs by the native shell.
    Operator,
    /// A per-agent credential issued when that agent's PTY was spawned.
    Agent(String),
}

/// Token issuer/verifier for the native control socket. The operator token
/// remains useful for tests and debugging, while each spawned PTY receives a
/// distinct agent credential. That makes delegation parents verifiable instead
/// of trusting a self-declared CANVAS_AGENT_ID over a shared bearer token.
#[derive(Clone)]
pub struct ControlAuth {
    operator_token: String,
    agent_tokens: std::sync::Arc<Mutex<HashMap<String, String>>>,
}

impl ControlAuth {
    pub fn new(operator_token: String) -> Self {
        Self {
            operator_token,
            agent_tokens: std::sync::Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn operator_token(&self) -> &str {
        &self.operator_token
    }

    pub fn issue_agent_token(&self, agent_id: &str) -> String {
        let token = generate_token();
        self.agent_tokens
            .lock()
            .unwrap()
            .insert(token.clone(), agent_id.to_string());
        token
    }

    pub fn identity(&self, token: &str) -> Option<ControlIdentity> {
        if token_eq(token, &self.operator_token) {
            return Some(ControlIdentity::Operator);
        }
        self.agent_tokens
            .lock()
            .unwrap()
            .get(token)
            .cloned()
            .map(ControlIdentity::Agent)
    }
}

pub fn uuid_like() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

/// DB row → wire shape for the automations snapshot.
pub fn automation_to_snapshot(
    (
        id,
        name,
        prompt,
        command,
        workspace_id,
        permission,
        idle_secs,
        on_approval,
        last_run_at,
        interval_secs,
        next_run_at,
    ): store::AutomationRow,
) -> protocol::SnapshotAutomation {
    protocol::SnapshotAutomation {
        id,
        name,
        prompt,
        command,
        workspace_id,
        permission,
        idle_secs: idle_secs.max(0) as u64,
        on_approval,
        last_run_at,
        interval_secs: interval_secs.map(|v| v.max(0) as u64),
        next_run_at,
    }
}

/// DB row → wire shape for the autopilot-loop snapshot.
pub fn loop_to_snapshot(
    (
        loop_id,
        board_id,
        target,
        instruction,
        trigger,
        interval_secs,
        pattern,
        enabled,
        last_fired_at,
    ): store::LoopRow,
) -> protocol::SnapshotLoop {
    protocol::SnapshotLoop {
        loop_id,
        board_id,
        target,
        instruction,
        trigger,
        interval_secs: interval_secs.map(|v| v.max(0) as u64),
        pattern,
        enabled,
        last_fired_at,
    }
}

/// The repo's origin remote normalized to an https URL (None when the board
/// repo has no remote — e.g. a scratch dir). Shared by daemon and shell
/// snapshots; remotes may be proxies embedding the real host in the path, so
/// prefer the innermost github.com/… segment when one is present.
pub fn repo_url(repo_root: &Path) -> Option<String> {
    std::process::Command::new("git")
        .args([
            "-C",
            &repo_root.to_string_lossy(),
            "remote",
            "get-url",
            "origin",
        ])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|u| !u.is_empty())
        .map(|u| {
            let inner = u
                .rfind("github.com/")
                .map(|i| format!("https://{}", &u[i..]));
            let u = inner.unwrap_or_else(|| {
                u.replace("git@github.com:", "https://github.com/")
                    .replace("ssh://git@", "https://")
            });
            u.strip_suffix(".git").unwrap_or(&u).to_string()
        })
}

/// Held supervised inputs as the snapshot's approval map.
pub fn approval_lines(pending_inputs: &Mutex<HashMap<String, Vec<u8>>>) -> HashMap<String, String> {
    pending_inputs
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(id, bytes)| sensitive_line(bytes).map(|line| (id.clone(), line)))
        .collect()
}

/// Build the versioned Snapshot server message exactly once for both
/// runtimes. Everything in this shape is store-derived except live statuses,
/// transcript sizes, diff summaries, detected CLI identities, and the repo
/// remote — those need the agent manager / filesystem and are passed in.
pub fn snapshot_message(
    store: &Store,
    agents: &AgentManager,
    repo_root: &Path,
    repo_url: Option<String>,
    approvals: HashMap<String, String>,
) -> Result<ServerMsg> {
    let rows = store.agents_snapshot()?;
    let live: HashMap<String, &str> = agents.statuses().into_iter().collect();
    let agent_names: HashMap<String, String> =
        rows.iter().map(|a| (a.0.clone(), a.1.clone())).collect();
    let acct_rows = store.accounts_snapshot().unwrap_or_default();
    let acct_labels: HashMap<String, String> = acct_rows
        .iter()
        .map(|(id, _cli, label, _env)| (id.clone(), label.clone()))
        .collect();

    let snapshot_agents = rows
        .into_iter()
        .map(
            |(
                id,
                name,
                command,
                worktree,
                status,
                workspace_id,
                permission,
                board_id,
                account_id,
            )| {
                let output_bytes = repo_root
                    .join(".canvas")
                    .join("transcripts")
                    .join(format!("{id}.bin"))
                    .metadata()
                    .map(|m| m.len())
                    .unwrap_or(0);
                // Replay diff state too: a fresh client shouldn't show a
                // dirty worktree as clean until the diff ticker next fires.
                let wt = agents
                    .worktree(&id)
                    .or_else(|| store.agent_worktree_abs(&id, repo_root).ok().flatten());
                let (files, paths, branch) = wt
                    .map(|w| {
                        let paths = dirty_files(&w);
                        (paths.len() as u32, paths, worktree_branch(&w))
                    })
                    .unwrap_or_default();
                protocol::SnapshotAgent {
                    status: live
                        .get(&id)
                        .copied()
                        .unwrap_or(status.as_str())
                        .to_string(),
                    agent_id: id,
                    name,
                    command,
                    worktree,
                    permission,
                    workspace_id,
                    board_id,
                    account_label: account_id.and_then(|a| acct_labels.get(&a).cloned()),
                    output_bytes,
                    files,
                    paths,
                    branch,
                }
            },
        )
        .collect();

    Ok(ServerMsg::Snapshot {
        boards: store
            .boards_snapshot()
            .unwrap_or_default()
            .into_iter()
            .map(|(board_id, name)| protocol::SnapshotBoard { board_id, name })
            .collect(),
        agents: snapshot_agents,
        delegations: store
            .delegations_snapshot()
            .unwrap_or_default()
            .into_iter()
            .map(
                |(edge_id, from, to, task, result, state, files, created_at, resolved_at)| {
                    protocol::SnapshotDelegation {
                        edge_id,
                        from,
                        to,
                        task,
                        result,
                        files: files.unwrap_or(0) as u32,
                        state,
                        created_at,
                        resolved_at,
                    }
                },
            )
            .collect(),
        workspaces: store
            .workspaces_snapshot()
            .unwrap_or_default()
            .into_iter()
            .map(|(workspace_id, name, repo, board_id)| {
                let agent_chain = store.workspace_chain(&workspace_id).ok().flatten();
                protocol::SnapshotWorkspace {
                    workspace_id,
                    name,
                    repo,
                    board_id,
                    agent_chain,
                }
            })
            .collect(),
        layout: store.layout_map().unwrap_or_default(),
        approvals,
        automations: store
            .automations_snapshot()
            .unwrap_or_default()
            .into_iter()
            .map(automation_to_snapshot)
            .collect(),
        accounts: acct_rows
            .into_iter()
            .map(|(account_id, cli, label, env)| protocol::SnapshotAccount {
                account_id,
                cli,
                label,
                env,
            })
            .collect(),
        notes: store
            .all_notes()
            .unwrap_or_default()
            .into_iter()
            .map(
                |(note_id, board_id, col, text, pos, due)| protocol::SnapshotNote {
                    note_id,
                    board_id,
                    col,
                    text,
                    pos,
                    due,
                },
            )
            .collect(),
        artifacts: store
            .artifacts_snapshot()
            .unwrap_or_default()
            .into_iter()
            .map(
                |(artifact_id, board_id, agent_id, kind, title, path, text, created_at)| {
                    let agent_name = agent_id.as_ref().and_then(|a| agent_names.get(a).cloned());
                    protocol::SnapshotArtifact {
                        artifact_id,
                        board_id,
                        agent_id,
                        agent_name,
                        kind,
                        title,
                        path,
                        text,
                        created_at,
                    }
                },
            )
            .collect(),
        loops: store
            .loops_snapshot()
            .unwrap_or_default()
            .into_iter()
            .map(loop_to_snapshot)
            .collect(),
        repo_url,
        cli_identities: crate::detect::detect_cli_identities(crate::chain::KNOWN_CLIS),
    })
}

#[derive(Clone)]
struct ControlSocketState {
    orchestrator: Orchestrator,
    auth: ControlAuth,
}

#[derive(Deserialize)]
struct WsQuery {
    token: String,
}

/// Axum router exposing the native orchestration control socket at `/ws`.
///
/// This is intentionally the daemon's wire protocol rather than a second
/// native-only transport: `canvasctl` already speaks it, and agents should
/// not care which runtime owns the board.
pub fn router(orchestrator: Orchestrator, token: String) -> Router {
    router_with_auth(orchestrator, ControlAuth::new(token))
}

/// Router variant backed by per-agent credentials. The plain `router` helper
/// keeps tests/simple embedding unchanged; the Tauri shell uses this one.
pub fn router_with_auth(orchestrator: Orchestrator, auth: ControlAuth) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .with_state(ControlSocketState { orchestrator, auth })
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(state): State<ControlSocketState>,
) -> impl IntoResponse {
    let Some(identity) = state.auth.identity(&q.token) else {
        return (StatusCode::UNAUTHORIZED, "invalid session token").into_response();
    };
    ws.max_message_size(8 * 1024 * 1024)
        // Keep frame == message cap: some browsers (Firefox) send ws payloads
        // as a single frame, so a smaller frame cap rejects valid uploads.
        .max_frame_size(8 * 1024 * 1024)
        .on_upgrade(move |socket| handle_socket(socket, state, identity))
}

fn snapshot_for(state: &ControlSocketState) -> Result<ServerMsg> {
    let orchestrator = &state.orchestrator;
    snapshot_message(
        &orchestrator.store,
        &orchestrator.agents,
        &orchestrator.repo_root,
        repo_url(&orchestrator.repo_root),
        approval_lines(&orchestrator.pending_inputs),
    )
}

async fn handle_socket(
    mut socket: WebSocket,
    state: ControlSocketState,
    identity: ControlIdentity,
) {
    let mut control_rx = state.orchestrator.subscribe_control();
    let mut pty_rx = state.orchestrator.subscribe_pty();

    // Replay board state first — canvasctl's `agents` and `boards` commands
    // are snapshot-only clients and never send a request frame.
    match snapshot_for(&state) {
        Ok(snapshot) => {
            if let Ok(text) = serde_json::to_string(&snapshot) {
                if socket.send(Message::Text(text.into())).await.is_err() {
                    return;
                }
            }
        }
        Err(e) => {
            let err = ServerMsg::Error {
                agent_id: None,
                message: format!("snapshot failed: {e}"),
            };
            if let Ok(text) = serde_json::to_string(&err) {
                let _ = socket.send(Message::Text(text.into())).await;
            }
        }
    }
    // Transcript replay: buffered PTY scrollback so a reconnected terminal
    // shows history instead of a blank screen.
    for id in state.orchestrator.agents.list() {
        if let Some(buf) = state.orchestrator.agents.scrollback(&id) {
            if !buf.is_empty() {
                let _ = socket
                    .send(Message::Binary(
                        protocol::encode_pty_frame(&id, &buf).into(),
                    ))
                    .await;
            }
        }
    }

    // Split instead of spawning per-direction forwarding tasks: after the
    // client disconnects, a quiet task parked on broadcast.recv would otherwise
    // leak for the lifetime of the process.
    let (mut sender, mut receiver) = socket.split();
    loop {
        tokio::select! {
            control = control_rx.recv() => match control {
                Ok(msg) => {
                    let Ok(text) = serde_json::to_string(&msg) else {
                        continue;
                    };
                    if sender.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            },
            pty = pty_rx.recv() => match pty {
                Ok((id, bytes)) => {
                    if sender
                        .send(Message::Binary(protocol::encode_pty_frame(&id, &bytes).into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            },
            msg = receiver.next() => match msg {
                Some(Ok(Message::Text(text))) => {
                    handle_client_msg(&text, &state, &identity);
                }
                Some(Ok(Message::Binary(frame))) => {
                    // [id_len][agent_id][payload] — client typing into a PTY.
                    if let Some((id, payload)) = protocol::decode_pty_frame(&frame) {
                        let _ = state.orchestrator.gated_write(id, payload);
                    }
                }
                Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_))) | None => break,
                Some(Err(_)) => break,
            },
        }
    }
}

fn report<T>(orchestrator: &Orchestrator, result: Result<T, String>, agent_id: Option<String>) {
    if let Err(message) = result {
        orchestrator.emit_error(agent_id, message);
    }
}

fn create_board(orchestrator: &Orchestrator, name: String) -> Result<String, String> {
    let id = uuid_like();
    orchestrator
        .store
        .board_created(&id, &name)
        .map_err(|e| e.to_string())?;
    orchestrator.emit_control(ServerMsg::BoardCreated {
        board_id: id.clone(),
        name,
    });
    Ok(id)
}

fn move_to_board(
    orchestrator: &Orchestrator,
    node_id: String,
    board_id: String,
) -> Result<(), String> {
    match orchestrator.store.node_moved_to_board(&node_id, &board_id) {
        Ok(true) => {
            orchestrator.emit_control(ServerMsg::BoardMoved { node_id, board_id });
            Ok(())
        }
        Ok(false) => Err("no such node".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

fn rename_node(orchestrator: &Orchestrator, node_id: String, name: String) -> Result<(), String> {
    match orchestrator.store.node_renamed(&node_id, &name) {
        Ok(true) => {
            orchestrator.emit_control(ServerMsg::NodeRenamed { node_id, name });
            Ok(())
        }
        _ => Err("no such node".to_string()),
    }
}

fn rename_board(orchestrator: &Orchestrator, board_id: String, name: String) -> Result<(), String> {
    match orchestrator.store.board_renamed(&board_id, &name) {
        Ok(true) => {
            orchestrator.emit_control(ServerMsg::BoardRenamed { board_id, name });
            Ok(())
        }
        _ => Err("no such board".to_string()),
    }
}

fn delete_board(orchestrator: &Orchestrator, board_id: String) -> Result<(), String> {
    match orchestrator.store.board_deleted(&board_id) {
        Ok(true) => {
            orchestrator.emit_control(ServerMsg::BoardDeleted { board_id });
            Ok(())
        }
        _ => Err("board not empty or is main".to_string()),
    }
}

fn delete_delegation(orchestrator: &Orchestrator, edge_id: String) -> Result<(), String> {
    match orchestrator.store.delegation_delete(&edge_id) {
        Ok(true) => {
            orchestrator.emit_control(ServerMsg::DelegationRemoved { edge_id });
            Ok(())
        }
        _ => Err("no such delegation".to_string()),
    }
}

fn artifact_delete(orchestrator: &Orchestrator, artifact_id: String) -> Result<(), String> {
    orchestrator
        .store
        .artifact_deleted(&artifact_id)
        .map_err(|e| e.to_string())?;
    orchestrator.emit_control(ServerMsg::ArtifactDeleted { artifact_id });
    Ok(())
}

fn note_upsert(
    orchestrator: &Orchestrator,
    note_id: Option<String>,
    board_id: Option<String>,
    col: String,
    text: String,
    pos: Option<i64>,
    due: Option<String>,
) -> Result<(), String> {
    let id = note_id.unwrap_or_else(|| format!("note-{}", &uuid_like()[..8]));
    let board = board_id.unwrap_or_else(|| "main".to_string());
    let p = match pos {
        Some(p) => p,
        None => orchestrator
            .store
            .note_next_pos(&board, &col)
            .map_err(|e| e.to_string())?,
    };
    orchestrator
        .store
        .note_upsert(&id, &board, &col, &text, p, due.as_deref())
        .map_err(|e| e.to_string())?;
    orchestrator.emit_control(ServerMsg::NoteUpserted {
        note: protocol::SnapshotNote {
            note_id: id,
            board_id: board,
            col,
            text,
            pos: p,
            due,
        },
    });
    Ok(())
}

fn note_delete(orchestrator: &Orchestrator, note_id: String) -> Result<(), String> {
    orchestrator
        .store
        .note_deleted(&note_id)
        .map_err(|e| e.to_string())?;
    orchestrator.emit_control(ServerMsg::NoteDeleted { note_id });
    Ok(())
}

fn set_permission(
    orchestrator: &Orchestrator,
    agent_id: String,
    permission: String,
) -> Result<(), String> {
    let level = protocol::normalize_permission(Some(&permission));
    orchestrator.agents.set_permission(&agent_id, level);
    orchestrator
        .store
        .set_agent_permission(&agent_id, level)
        .map_err(|e| e.to_string())?;
    orchestrator.emit_control(ServerMsg::PermissionChanged {
        agent_id,
        permission: level.to_string(),
    });
    Ok(())
}

fn memory_read(orchestrator: &Orchestrator, node_id: String) {
    let path = orchestrator.memory_path(&node_id);
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    orchestrator.emit_control(ServerMsg::Memory { node_id, text });
}

fn memory_write(orchestrator: &Orchestrator, node_id: String, text: String) -> Result<(), String> {
    let path = orchestrator.memory_path(&node_id);
    if let Some(p) = path.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    std::fs::write(&path, &text).map_err(|e| e.to_string())?;
    orchestrator.emit_control(ServerMsg::Memory { node_id, text });
    Ok(())
}

fn transcript(orchestrator: &Orchestrator, agent_id: String) -> Result<(), String> {
    match orchestrator.agents.scrollback(&agent_id) {
        Some(buf) if !buf.is_empty() => {
            orchestrator.emit_pty(&agent_id, &buf);
            Ok(())
        }
        _ => Err("no transcript for agent".into()),
    }
}

fn diff_detail(orchestrator: &Orchestrator, agent_id: String) -> Result<(), String> {
    let wt = orchestrator.agents.worktree(&agent_id).or_else(|| {
        orchestrator
            .store
            .agent_worktree_abs(&agent_id, &orchestrator.repo_root)
            .ok()
            .flatten()
    });
    match wt {
        Some(wt) => {
            orchestrator.emit_control(ServerMsg::DiffDetail {
                agent_id,
                diff: dirty_diff(&wt),
            });
            Ok(())
        }
        None => Err("no such agent".into()),
    }
}

fn digest(orchestrator: &Orchestrator) {
    let rows = orchestrator.store.agents_snapshot().unwrap_or_default();
    let mut md = String::from("# Session digest\n\n");
    for (id, name, command, _wt, status, _ws, _perm, _bd, acct) in &rows {
        md.push_str(&format!("## {name} (`{command}`) — {status}"));
        if let Some(l) = acct {
            md.push_str(&format!(" · @{l}"));
        }
        md.push('\n');
        let tail = orchestrator
            .agents
            .scrollback(id)
            .map(|b| String::from_utf8_lossy(&b).to_string())
            .unwrap_or_default();
        let lines: Vec<String> = tail
            .lines()
            .filter_map(last_visible_line)
            .filter(|l| !l.is_empty())
            .collect();
        for l in lines.iter().rev().take(6).rev() {
            md.push_str(&format!("    {l}\n"));
        }
        md.push('\n');
    }
    orchestrator.emit_control(ServerMsg::SessionDigest { text: md });
}

/// Resolve a pause/resume board target to live agent ids.
fn live_targets(orchestrator: &Orchestrator, board_id: &str) -> Vec<String> {
    let live: std::collections::HashSet<String> = orchestrator.agents.ids().into_iter().collect();
    orchestrator
        .store
        .agents_snapshot()
        .unwrap_or_default()
        .into_iter()
        .filter(|a| a.7.as_deref() == Some(board_id) && live.contains(&a.0))
        .map(|a| a.0)
        .collect()
}

fn unsupported(orchestrator: &Orchestrator, cmd: &str) {
    orchestrator.emit_error(
        None,
        format!("{cmd} is outside the native control socket scope"),
    );
}

/// Handle one JSON control frame. The implemented surface is deliberately
/// the orchestration/core board subset an in-PTY agent needs; heavy UI file
/// browsers and daemon scheduling surfaces stay on their existing native or
/// daemon transports rather than being reimplemented behind agent tokens.
fn handle_client_msg(text: &str, state: &ControlSocketState, identity: &ControlIdentity) {
    let orchestrator = &state.orchestrator;
    let msg: ClientMsg = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            orchestrator.emit_error(None, format!("bad message: {e}"));
            return;
        }
    };

    match msg {
        ClientMsg::SpawnAgent {
            name,
            command,
            cwd,
            workspace_id,
            permission,
            board_id,
            account_id,
            initial_input,
        } => {
            let mut params = SpawnParams {
                name,
                command,
                cwd,
                workspace_id,
                permission,
                board_id,
                account_id,
                initial_input,
            };
            if let ControlIdentity::Agent(caller) = identity {
                // A child can never climb above the authenticated caller. If
                // the caller row has disappeared, fail closed at supervised
                // rather than treating the stale token as operator power.
                let parent = orchestrator
                    .store
                    .agent_permission(caller)
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "supervised".to_string());
                let requested = protocol::normalize_permission(params.permission.as_deref());
                params.permission =
                    Some(protocol::clamp_to_parent(requested, Some(&parent)).to_string());
            }
            report(
                orchestrator,
                orchestrator.spawn_node(params).map(|_| ()),
                None,
            )
        }
        ClientMsg::Delegate {
            from,
            name,
            command,
            task,
            cwd,
            workspace_id,
            permission,
            account_id,
            board_id,
            initial_input,
        } => {
            let caller_matches = match identity {
                ControlIdentity::Operator => true,
                ControlIdentity::Agent(caller) => caller == &from,
            };
            if !caller_matches {
                orchestrator.emit_error(
                    None,
                    "delegate parent does not match the authenticated agent",
                );
            } else {
                report(
                    orchestrator,
                    orchestrator
                        .delegate(DelegateParams {
                            from,
                            name,
                            command,
                            task,
                            cwd,
                            workspace_id,
                            permission,
                            account_id,
                            board_id,
                            initial_input,
                            allow_unpersisted_parent: matches!(identity, ControlIdentity::Operator),
                        })
                        .map(|_| ()),
                    None,
                )
            }
        }
        ClientMsg::ArtifactCreate {
            board_id,
            agent_id,
            kind,
            title,
            path,
            text,
        } => {
            let mut agent_id = agent_id;
            let attribution_matches = match identity {
                ControlIdentity::Operator => true,
                ControlIdentity::Agent(caller) => {
                    let claimed = agent_id.as_deref();
                    if claimed.is_none_or(|id| id == caller) {
                        agent_id = Some(caller.clone());
                        true
                    } else {
                        false
                    }
                }
            };
            if !attribution_matches {
                orchestrator.emit_error(
                    None,
                    "artifact agent does not match the authenticated agent",
                );
            } else {
                report(
                    orchestrator,
                    orchestrator
                        .artifact_create(board_id, agent_id, kind, title, path, text)
                        .map(|_| ()),
                    None,
                )
            }
        }
        ClientMsg::ArtifactDelete { artifact_id } => report(
            orchestrator,
            artifact_delete(orchestrator, artifact_id),
            None,
        ),
        ClientMsg::CreateBoard { name } => report(
            orchestrator,
            create_board(orchestrator, name).map(|_| ()),
            None,
        ),
        ClientMsg::MoveToBoard { node_id, board_id } => report(
            orchestrator,
            move_to_board(orchestrator, node_id, board_id),
            None,
        ),
        ClientMsg::RenameNode { node_id, name } => {
            report(orchestrator, rename_node(orchestrator, node_id, name), None)
        }
        ClientMsg::RenameBoard { board_id, name } => report(
            orchestrator,
            rename_board(orchestrator, board_id, name),
            None,
        ),
        ClientMsg::DeleteBoard { board_id } => {
            report(orchestrator, delete_board(orchestrator, board_id), None)
        }
        ClientMsg::DeleteDelegation { edge_id } => {
            report(orchestrator, delete_delegation(orchestrator, edge_id), None)
        }
        ClientMsg::NoteUpsert {
            note_id,
            board_id,
            col,
            text,
            pos,
            due,
        } => report(
            orchestrator,
            note_upsert(orchestrator, note_id, board_id, col, text, pos, due),
            None,
        ),
        ClientMsg::NoteDelete { note_id } => {
            report(orchestrator, note_delete(orchestrator, note_id), None)
        }
        ClientMsg::SetPermission {
            agent_id,
            permission,
        } => {
            if matches!(identity, ControlIdentity::Agent(_)) {
                // Permission is the caller's security ceiling; letting an
                // agent raise it would make spawn/delegation clamping useless.
                orchestrator
                    .emit_error(Some(agent_id), "set_permission requires operator identity");
            } else {
                let id = agent_id.clone();
                report(
                    orchestrator,
                    set_permission(orchestrator, agent_id, permission),
                    Some(id),
                )
            }
        }
        ClientMsg::SetAgentChain {
            workspace_id,
            chain,
        } => report(
            orchestrator,
            orchestrator
                .store
                .set_workspace_chain(&workspace_id, &chain)
                .map_err(|e| e.to_string()),
            None,
        ),
        ClientMsg::PtyInput { agent_id, data } => {
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(&data)
                .map_err(|e| format!("bad base64: {e}"));
            match decoded {
                Ok(bytes) => {
                    if !orchestrator.gated_write(&agent_id, &bytes) {
                        orchestrator.emit_error(Some(agent_id), "pty write failed");
                    }
                }
                Err(message) => orchestrator.emit_error(Some(agent_id), message),
            }
        }
        ClientMsg::PtyResize {
            agent_id,
            cols,
            rows,
            request_id,
        } => {
            let id = agent_id.clone();
            match orchestrator.agents.resize(&agent_id, cols, rows) {
                Ok(()) => {
                    if let Some(request_id) = request_id {
                        orchestrator.emit_control(ServerMsg::PtyResized {
                            agent_id: id,
                            request_id,
                        });
                    }
                }
                Err(error) => orchestrator.emit_error(Some(id), error.to_string()),
            }
        }
        ClientMsg::KillAgent { agent_id } => {
            orchestrator.emit_error(Some(agent_id), "kill requires confirm_destructive")
        }
        // Operator confirmations must be a human gesture on the native UI,
        // never something a token-bearing agent can perform for itself or for
        // another terminal. Kill already requires this command, so both sides
        // of the destructive/approval surface stay unavailable here.
        ClientMsg::ConfirmDestructive { .. } => unsupported(orchestrator, "confirm_destructive"),
        ClientMsg::ApproveInput { .. } => unsupported(orchestrator, "approve_input"),
        ClientMsg::DenyInput { .. } => unsupported(orchestrator, "deny_input"),
        ClientMsg::MoveNode { agent_id, x, y } => report(
            orchestrator,
            orchestrator
                .store
                .save_node_position(&agent_id, x, y)
                .map_err(|e| e.to_string()),
            None,
        ),
        ClientMsg::MemoryRead { node_id } => memory_read(orchestrator, node_id),
        ClientMsg::MemoryWrite { node_id, text } => report(
            orchestrator,
            memory_write(orchestrator, node_id, text),
            None,
        ),
        ClientMsg::Transcript { agent_id } => {
            let id = agent_id.clone();
            report(orchestrator, transcript(orchestrator, agent_id), Some(id))
        }
        ClientMsg::DiffDetail { agent_id } => {
            let id = agent_id.clone();
            report(orchestrator, diff_detail(orchestrator, agent_id), Some(id))
        }
        ClientMsg::Digest => digest(orchestrator),
        ClientMsg::PauseAll { board_id } => {
            let board = board_id.unwrap_or_else(|| "main".to_string());
            let n = orchestrator
                .agents
                .suspend_many(&live_targets(orchestrator, &board));
            orchestrator.emit_error(None, format!("paused {n} agents"));
        }
        ClientMsg::ResumeAll { board_id } => {
            let board = board_id.unwrap_or_else(|| "main".to_string());
            let n = orchestrator
                .agents
                .resume_many(&live_targets(orchestrator, &board));
            orchestrator.emit_error(None, format!("resumed {n} agents"));
        }

        // Deliberately out of the native control-socket v1 scope. These are
        // either UI file-browser surfaces (vault/repo), operator account and
        // automation management, or daemon-specific scheduling surfaces. They
        // remain available through the native Tauri commands or the daemon's
        // full control socket; agent self-orchestration does not need them.
        ClientMsg::CreateWorkspace { .. } => unsupported(orchestrator, "create_workspace"),
        ClientMsg::DeleteWorkspace { .. } => unsupported(orchestrator, "delete_workspace"),
        ClientMsg::VaultList { .. } => unsupported(orchestrator, "vault_list"),
        ClientMsg::RepoTree { .. } => unsupported(orchestrator, "repo_tree"),
        ClientMsg::RepoRead { .. } => unsupported(orchestrator, "repo_read"),
        ClientMsg::RepoWrite { .. } => unsupported(orchestrator, "repo_write"),
        ClientMsg::VaultRead { .. } => unsupported(orchestrator, "vault_read"),
        ClientMsg::VaultPeek { .. } => unsupported(orchestrator, "vault_peek"),
        ClientMsg::VaultAsset { .. } => unsupported(orchestrator, "vault_asset"),
        ClientMsg::VaultAppend { .. } => unsupported(orchestrator, "vault_append"),
        ClientMsg::VaultWrite { .. } => unsupported(orchestrator, "vault_write"),
        ClientMsg::VaultWriteAsset { .. } => unsupported(orchestrator, "vault_write_asset"),
        ClientMsg::VaultDelete { .. } => unsupported(orchestrator, "vault_delete"),
        ClientMsg::VaultRename { .. } => unsupported(orchestrator, "vault_rename"),
        ClientMsg::VaultGraph { .. } => unsupported(orchestrator, "vault_graph"),
        ClientMsg::VaultSearch { .. } => unsupported(orchestrator, "vault_search"),
        ClientMsg::VaultDiscover => unsupported(orchestrator, "vault_discover"),
        ClientMsg::VaultRegister { .. } => unsupported(orchestrator, "vault_register"),
        ClientMsg::GitPush { .. } => unsupported(orchestrator, "git_push"),
        ClientMsg::StudioDoc { .. } => unsupported(orchestrator, "studio_doc"),
        ClientMsg::CreateAccount { .. } => unsupported(orchestrator, "create_account"),
        ClientMsg::DeleteAccount { .. } => unsupported(orchestrator, "delete_account"),
        ClientMsg::CreateAutomation { .. } => unsupported(orchestrator, "create_automation"),
        ClientMsg::RunAutomation { .. } => unsupported(orchestrator, "run_automation"),
        ClientMsg::DeleteAutomation { .. } => unsupported(orchestrator, "delete_automation"),
        ClientMsg::CreateLoop { .. } => unsupported(orchestrator, "create_loop"),
        ClientMsg::DeleteLoop { .. } => unsupported(orchestrator, "delete_loop"),
        ClientMsg::SetLoopEnabled { .. } => unsupported(orchestrator, "set_loop_enabled"),
        ClientMsg::RunLoop { .. } => unsupported(orchestrator, "run_loop"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_compare_is_exact_and_constant_shape() {
        assert!(token_eq("abc", "abc"));
        assert!(!token_eq("abc", "abd"));
        assert!(!token_eq("abc", "abcd"));
        assert!(!token_eq("", "x"));
    }

    #[test]
    fn control_auth_distinguishes_operator_and_issued_agent_tokens() {
        let auth = ControlAuth::new("operator-token".to_string());
        let agent_token = auth.issue_agent_token("agent-1");
        assert_eq!(
            auth.identity("operator-token"),
            Some(ControlIdentity::Operator)
        );
        assert_eq!(
            auth.identity(&agent_token),
            Some(ControlIdentity::Agent("agent-1".to_string()))
        );
        assert_eq!(auth.identity("other"), None);
    }

    #[test]
    fn operator_confirmation_messages_are_rejected_on_the_agent_socket() {
        let tmp = tempfile::tempdir().unwrap();
        let store = std::sync::Arc::new(Store::open(&tmp.path().join("c.db")).unwrap());
        let orchestrator = Orchestrator::new(
            store,
            std::sync::Arc::new(crate::agent::AgentManager::new()),
            tmp.path().to_path_buf(),
            crate::orchestrate::tokio_task_spawner(),
        );
        let auth = ControlAuth::new("operator-token".to_string());
        let state = ControlSocketState {
            orchestrator: orchestrator.clone(),
            auth,
        };
        let mut rx = orchestrator.subscribe_control();
        for msg in [
            serde_json::json!({"cmd":"confirm_destructive","agent_id":"a","action":"kill"}),
            serde_json::json!({"cmd":"approve_input","agent_id":"a"}),
            serde_json::json!({"cmd":"deny_input","agent_id":"a"}),
        ] {
            handle_client_msg(
                &serde_json::to_string(&msg).unwrap(),
                &state,
                &ControlIdentity::Operator,
            );
            match rx.try_recv() {
                Ok(ServerMsg::Error { message, .. }) => {
                    assert!(
                        message.contains("outside the native control socket scope"),
                        "unexpected error: {message}"
                    );
                }
                other => panic!("expected unsupported error, got {other:?}"),
            }
        }
    }

    #[test]
    fn generated_tokens_are_64_hex_chars_and_unique() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}
