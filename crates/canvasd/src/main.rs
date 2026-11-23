//! canvasd — local daemon for the agent canvas.
//!
//! Binds to 127.0.0.1 only. Every connection requires the per-launch session
//! token (`?token=` on /ws, `Authorization: Bearer` on /api/*).

use canvasd::agent::{canvas_result_line, dirty_file_count, last_visible_line, AgentManager};
use canvasd::protocol;
use canvasd::store;
use anyhow::Result;
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    http::{header, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use base64::Engine;
use protocol::{decode_pty_frame, encode_pty_frame, AgentStatus, ClientMsg, ServerMsg};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::sync::{broadcast, mpsc};
use tracing::{info, warn};

type AgentId = String;

#[derive(Clone)]
struct AppState {
    token: String,
    events: broadcast::Sender<Event>,
    agents: Arc<AgentManager>,
    store: Arc<store::Store>,
    repo_root: PathBuf,
    /// agent_id → delegation edge_id: which child still owes a CANVAS_RESULT.
    pending_results: Arc<std::sync::Mutex<std::collections::HashMap<String, String>>>,
}

/// Wire event: control (JSON) or raw PTY output (binary).
#[derive(Debug, Clone)]
enum Event {
    Control(ServerMsg),
    PtyOutput(AgentId, Vec<u8>),
}

#[derive(Debug, Deserialize)]
struct WsQuery {
    token: String,
}

#[derive(Debug, Serialize)]
struct Health {
    status: &'static str,
    version: &'static str,
}

async fn health() -> Json<Health> {
    Json(Health { status: "ok", version: env!("CARGO_PKG_VERSION") })
}

/// Spawn a PTY agent wired to the event bus + store. Used by both
/// `spawn_agent` (standalone node) and `delegate` (edge-owned child).
/// A workspace-scoped agent runs inside that workspace's repo, not the
/// daemon's default board repo.
fn spawn_agent(
    state: &Arc<AppState>,
    name: &str,
    command: &str,
    cwd: &str,
    workspace_id: Option<&str>,
    permission: &str,
) -> Result<String> {
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<(String, Vec<u8>)>();
    let (exit_tx, mut exit_rx) = mpsc::unbounded_channel::<String>();
    let ev = state.events.clone();
    tokio::spawn(async move {
        while let Some((id, bytes)) = out_rx.recv().await {
            let _ = ev.send(Event::PtyOutput(id, bytes));
        }
    });
    let ev2 = state.events.clone();
    let store2 = state.store.clone();
    let pending = state.pending_results.clone();
    tokio::spawn(async move {
        while let Some(id) = exit_rx.recv().await {
            let _ = store2.agent_status(&id, "exited");
            pending.lock().unwrap().remove(&id);
            let _ = ev2.send(Event::Control(ServerMsg::Status {
                agent_id: id,
                status: AgentStatus::Exited,
            }));
        }
    });
    let repo_root = match workspace_id.and_then(|w| state.store.workspace_repo(w).ok().flatten()) {
        Some(repo) => PathBuf::from(repo),
        None => state.repo_root.clone(),
    };
    let id = state
        .agents
        .spawn(name, command, cwd, &repo_root, out_tx, exit_tx)?;
    if let Err(e) = state.store.agent_spawned(
        &id,
        name,
        command,
        &format!(".canvas-worktrees/{id}"),
        workspace_id,
        permission,
    ) {
        warn!(error = %e, "failed to persist agent");
    }
    Ok(id)
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    if q.token != state.token {
        return (StatusCode::UNAUTHORIZED, "invalid session token").into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    let mut rx = state.events.subscribe();
    info!("websocket client connected");

    // Replay board state: every agent this board knows (live status for the
    // ones still running) plus saved node positions.
    if let Ok(agents) = state.store.agents_snapshot() {
        let live: std::collections::HashMap<String, &str> =
            state.agents.statuses().into_iter().collect();
        let snapshot = ServerMsg::Snapshot {
            agents: agents
                .into_iter()
                .map(|(id, name, command, worktree, status, workspace_id, permission)| protocol::SnapshotAgent {
                    status: live.get(&id).copied().unwrap_or(status.as_str()).to_string(),
                    agent_id: id,
                    name,
                    command,
                    worktree,
                    permission,
                    workspace_id,
                })
                .collect(),
            workspaces: state
                .store
                .workspaces_snapshot()
                .unwrap_or_default()
                .into_iter()
                .map(|(workspace_id, name, repo)| protocol::SnapshotWorkspace {
                    workspace_id,
                    name,
                    repo,
                })
                .collect(),
            delegations: state
                .store
                .delegations_snapshot()
                .unwrap_or_default()
                .into_iter()
                .map(|(edge_id, from, to, task, result, state)| {
                    protocol::SnapshotDelegation { edge_id, from, to, task, result, state }
                })
                .collect(),
            layout: state.store.layout_map().unwrap_or_default(),
        };
        if let Ok(text) = serde_json::to_string(&snapshot) {
            let _ = socket.send(Message::Text(text.into())).await;
        }
    }

    // Fan-out task: broadcast events → socket (JSON for control, binary for PTY).
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(256);
    let writer_state = state.clone();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(Event::Control(msg)) => {
                    let Ok(text) = serde_json::to_string(&msg) else { continue };
                    if out_tx.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                Ok(Event::PtyOutput(id, bytes)) => {
                    if out_tx
                        .send(Message::Binary(encode_pty_frame(&id, &bytes).into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "client lagged on board events");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
        drop(writer_state);
    });

    let send_control = |msg: ServerMsg| {
        let _ = state.events.send(Event::Control(msg));
    };

    loop {
        tokio::select! {
            out = out_rx.recv() => match out {
                Some(msg) => {
                    if socket.send(msg).await.is_err() {
                        break;
                    }
                }
                None => break,
            },
            msg = socket.recv() => match msg {
                Some(Ok(Message::Text(text))) => {
                    handle_client_msg(&text, &state, &send_control);
                }
                Some(Ok(Message::Binary(frame))) => {
                    // [id_len][agent_id][payload] — client typing into a PTY.
                    if let Some((id, payload)) = decode_pty_frame(&frame) {
                        if let Err(e) = state.agents.write(id, payload) {
                            send_control(ServerMsg::Error {
                                agent_id: Some(id.to_string()),
                                message: e.to_string(),
                            });
                        }
                    }
                }
                Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_))) | None => break,
                Some(Err(_)) => break,
            },
        }
    }
    info!("websocket client disconnected");
}

fn handle_client_msg(
    text: &str,
    state: &Arc<AppState>,
    send_control: &impl Fn(ServerMsg),
) {
    let msg: ClientMsg = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            send_control(ServerMsg::Error {
                agent_id: None,
                message: format!("bad message: {e}"),
            });
            return;
        }
    };

    match msg {
        ClientMsg::CreateWorkspace { name, repo } => {
            // Path validated on spawn side; a workspace is just a named
            // container + its repo.
            let id = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
            match state.store.workspace_created(&id, &name, &repo) {
                Ok(()) => send_control(ServerMsg::WorkspaceCreated {
                    workspace_id: id,
                    name,
                    repo,
                }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::SpawnAgent { name, command, cwd, workspace_id, permission } => {
            let level = protocol::normalize_permission(permission.as_deref());
            match spawn_agent(state, &name, &command, &cwd, workspace_id.as_deref(), level) {
                Ok(id) => send_control(ServerMsg::Spawned { agent_id: id, name, command, permission: level.to_string(), workspace_id }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::Delegate { from, name, command, task, cwd, workspace_id, permission } => {
            // A delegation IS a spawn + a persisted edge. The edge returns
            // when the child's PTY prints `CANVAS_RESULT: <summary>`.
            let parent_level = state.store.agent_permission(&from).ok().flatten();
            let requested = protocol::normalize_permission(permission.as_deref());
            let level = protocol::clamp_to_parent(requested, parent_level.as_deref());
            match spawn_agent(state, &name, &command, &cwd, workspace_id.as_deref(), level) {
                Ok(id) => {
                    let edge_id = format!("edge-{}", &id[..8.min(id.len())]);
                    if let Err(e) = state.store.delegation_created(&edge_id, &from, &id, &task) {
                        warn!(error = %e, "failed to persist delegation");
                    }
                    state.pending_results.lock().unwrap().insert(id.clone(), edge_id.clone());
                    send_control(ServerMsg::Spawned {
                        agent_id: id.clone(),
                        name,
                        command,
                        permission: level.to_string(),
                        workspace_id: workspace_id.clone(),
                    });
                    send_control(ServerMsg::Delegation {
                        edge_id,
                        from,
                        to: id,
                        task,
                    });
                }
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::PtyInput { agent_id, data } => {
            match base64::engine::general_purpose::STANDARD.decode(&data) {
                Ok(bytes) => {
                    if let Err(e) = state.agents.write(&agent_id, &bytes) {
                        send_control(ServerMsg::Error {
                            agent_id: Some(agent_id),
                            message: e.to_string(),
                        });
                    }
                }
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: Some(agent_id),
                    message: format!("bad base64: {e}"),
                }),
            }
        }
        ClientMsg::PtyResize { agent_id, cols, rows } => {
            if let Err(e) = state.agents.resize(&agent_id, cols, rows) {
                send_control(ServerMsg::Error {
                    agent_id: Some(agent_id),
                    message: e.to_string(),
                });
            }
        }
        ClientMsg::ConfirmDestructive { agent_id, action } => {
            // The ONLY path to destructive actions — never prompt text.
            match action.as_str() {
                "kill" => match state.agents.kill(&agent_id) {
                    Ok(()) => {
                        let _ = state.store.agent_status(&agent_id, "exited");
                        send_control(ServerMsg::Status {
                            agent_id,
                            status: AgentStatus::Exited,
                        });
                    }
                    Err(e) => send_control(ServerMsg::Error {
                        agent_id: Some(agent_id),
                        message: e.to_string(),
                    }),
                },
                other => send_control(ServerMsg::Error {
                    agent_id: Some(agent_id),
                    message: format!("unknown destructive action: {other}"),
                }),
            }
        }
        ClientMsg::KillAgent { agent_id } => {
            // Direct kill requests are refused: require ConfirmDestructive.
            send_control(ServerMsg::Error {
                agent_id: Some(agent_id),
                message: "kill requires confirm_destructive".into(),
            });
        }
        ClientMsg::MoveNode { agent_id, x, y } => {
            if let Err(e) = state.store.save_node_position(&agent_id, x, y) {
                warn!(error = %e, "failed to save node position");
            }
        }
    }
}

async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let ok = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v == format!("Bearer {}", state.token))
        .unwrap_or(false);
    if ok {
        next.run(req).await
    } else {
        (StatusCode::UNAUTHORIZED, "invalid session token").into_response()
    }
}

fn generate_token() -> String {
    use rand::RngCore;
    let mut buf = [0u8; 32];
    rand::rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "canvasd=info".into()),
        )
        .init();

    let repo_root = std::env::var("CANVAS_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap());

    let token = generate_token();
    let (events, _) = broadcast::channel(512);
    let store = Arc::new(store::Store::open(&repo_root)?);
    store.mark_all_exited()?;
    let state = Arc::new(AppState {
        token: token.clone(),
        events,
        agents: Arc::new(AgentManager::new()),
        store,
        repo_root,
        pending_results: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
    });

    let api = Router::new()
        .route("/health", get(health))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .nest("/api", api)
        .with_state(state.clone());

    let port: u16 = std::env::var("CANVASD_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(4242);
    // Status ticker: re-derive every agent's status each second and emit a
    // Status event only when it changed (CLI-agnostic until real hooks land).
    {
        let agents = state.agents.clone();
        let ev = state.events.clone();
        let store = state.store.clone();
        let pending = state.pending_results.clone();
        tokio::spawn(async move {
            let mut last: std::collections::HashMap<String, &'static str> =
                std::collections::HashMap::new();
            let mut last_line: std::collections::HashMap<String, String> =
                std::collections::HashMap::new();
            let mut last_diff: std::collections::HashMap<String, u32> =
                std::collections::HashMap::new();
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
            let mut tick_n: u32 = 0;
            loop {
                tick.tick().await;
                tick_n = tick_n.wrapping_add(1);
                // Result-return pass: a delegation edge resolves when the
                // child's PTY prints `CANVAS_RESULT: <summary>` on a line.
                {
                    let mut resolved: Vec<(String, String, String)> = Vec::new();
                    {
                        let map = pending.lock().unwrap();
                        for (agent_id, edge_id) in map.iter() {
                            let summary = agents
                                .tail_text(agent_id)
                                .and_then(|t| canvas_result_line(&t));
                            if let Some(summary) = summary {
                                resolved.push((
                                    agent_id.clone(),
                                    edge_id.clone(),
                                    summary.trim().to_string(),
                                ));
                            }
                        }
                    }
                    for (agent_id, edge_id, summary) in resolved {
                        pending.lock().unwrap().remove(&agent_id);
                        let _ = store.delegation_resolved(&edge_id, &summary);
                        let _ = ev.send(Event::Control(ServerMsg::Result {
                            edge_id,
                            summary,
                        }));
                    }
                }
                // Activity pass: broadcast the agent's latest PTY line
                // when it changed — the node card previews live output.
                for id in agents.ids() {
                    let line = agents.tail_text(&id).and_then(|t| last_visible_line(&t));
                    if let Some(line) = line {
                        if last_line.get(&id) != Some(&line) {
                            last_line.insert(id.clone(), line.clone());
                            let _ = ev.send(Event::Control(ServerMsg::Activity {
                                agent_id: id,
                                line,
                            }));
                        }
                    }
                }
                // Diff pass (every 3rd tick): uncommitted file count per
                // worktree — the node badge shows what the agent produced.
                if tick_n.is_multiple_of(3) {
                    for id in agents.ids() {
                        if let Some(wt) = agents.worktree(&id) {
                            let files = dirty_file_count(&wt);
                            if last_diff.get(&id) != Some(&files) {
                                last_diff.insert(id.clone(), files);
                                let _ = ev.send(Event::Control(ServerMsg::Diff {
                                    agent_id: id,
                                    files,
                                }));
                            }
                        }
                    }
                }
                for (id, status) in agents.statuses() {
                    if last.get(&id) != Some(&status) {
                        last.insert(id.clone(), status);
                        let _ = store.agent_status(&id, status);
                        let s = match status {
                            "working" => AgentStatus::Working,
                            "waiting" => AgentStatus::Waiting,
                            "blocked" => AgentStatus::Blocked,
                            "done" => AgentStatus::Done,
                            "exited" => AgentStatus::Exited,
                            _ => AgentStatus::Idle,
                        };
                        let _ = ev.send(Event::Control(ServerMsg::Status {
                            agent_id: id,
                            status: s,
                        }));
                    }
                }
            }
        });
    }

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!(%addr, "canvasd listening (localhost only)");
    println!("CANVASD_TOKEN={token}");

    axum::serve(listener, app).await?;
    Ok(())
}
