//! Canvas — Tauri shell.
//!
//! Same frontend as the web client, same core as canvasd: the Tauri app
//! replaces the WebSocket transport with native commands + events.
//! Control events → `canvas://control` (the same ServerMsg JSON as the WS
//! protocol); PTY output → `canvas://pty` { agent_id, data(base64) }.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use canvasd::agent::{canvas_result_line, dirty_file_count, sensitive_line, AgentManager};
use canvasd::protocol::{AgentStatus, ServerMsg, SnapshotAgent, SnapshotDelegation};
use canvasd::store::Store;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tracing::warn;

struct CanvasState {
    agents: AgentManager,
    store: Arc<Store>,
    repo_root: PathBuf,
    pending_results: Mutex<HashMap<String, String>>, // agent_id → edge_id
    pending_inputs: Mutex<HashMap<String, Vec<u8>>>, // agent_id → held PTY input
}

fn emit_control(app: &AppHandle, msg: &ServerMsg) {
    if let Err(e) = app.emit("canvas://control", msg) {
        warn!(error = %e, "emit control failed");
    }
}

fn emit_pty(app: &AppHandle, agent_id: &str, bytes: &[u8]) {
    let payload = serde_json::json!({
        "agent_id": agent_id,
        "data": base64::engine::general_purpose::STANDARD.encode(bytes),
    });
    if let Err(e) = app.emit("canvas://pty", payload) {
        warn!(error = %e, "emit pty failed");
    }
}

/// Spawn a PTY agent wired to emit events + persist. Shared by spawn_agent
/// and delegate.
fn spawn_wired(
    app: &AppHandle,
    state: &State<'_, CanvasState>,
    name: &str,
    command: &str,
    cwd: &str,
    workspace_id: Option<&str>,
    permission: &str,
) -> Result<String, String> {
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<(String, Vec<u8>)>();
    let (exit_tx, mut exit_rx) = mpsc::unbounded_channel::<String>();

    let app1 = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some((id, bytes)) = out_rx.recv().await {
            emit_pty(&app1, &id, &bytes);
        }
    });

    let app2 = app.clone();
    let store2 = state.store.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(id) = exit_rx.recv().await {
            let _ = store2.agent_status(&id, "exited");
            emit_control(
                &app2,
                &ServerMsg::Status {
                    agent_id: id,
                    status: AgentStatus::Exited,
                },
            );
        }
    });

    let repo_root = match workspace_id
        .and_then(|w| state.store.workspace_repo(w).ok().flatten())
    {
        Some(repo) => PathBuf::from(repo),
        None => state.repo_root.clone(),
    };
    let id = state
        .agents
        .spawn(name, command, cwd, &repo_root, permission, out_tx, exit_tx)
        .map_err(|e| e.to_string())?;
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

#[tauri::command]
fn spawn_agent(
    app: AppHandle,
    state: State<'_, CanvasState>,
    name: String,
    command: String,
    cwd: String,
    workspace_id: Option<String>,
    permission: Option<String>,
) -> Result<String, String> {
    let level = canvasd::protocol::normalize_permission(permission.as_deref());
    let id = spawn_wired(&app, &state, &name, &command, &cwd, workspace_id.as_deref(), level)?;
    emit_control(&app, &ServerMsg::Spawned { agent_id: id.clone(), name, command, permission: level.to_string(), workspace_id });
    Ok(id)
}

#[tauri::command]
fn create_workspace(
    app: AppHandle,
    state: State<'_, CanvasState>,
    name: String,
    repo: String,
) -> Result<String, String> {
    let id = uuid_v4ish();
    state
        .store
        .workspace_created(&id, &name, &repo)
        .map_err(|e| e.to_string())?;
    emit_control(
        &app,
        &ServerMsg::WorkspaceCreated { workspace_id: id.clone(), name, repo },
    );
    Ok(id)
}

fn uuid_v4ish() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let rand: u64 = rand::random();
    format!("{:x}{:x}", nanos, rand)[..12].to_string()
}

#[tauri::command]
fn delegate(
    app: AppHandle,
    state: State<'_, CanvasState>,
    from: String,
    name: String,
    command: String,
    task: String,
    cwd: String,
    workspace_id: Option<String>,
    permission: Option<String>,
) -> Result<String, String> {
    let parent_level = state.store.agent_permission(&from).ok().flatten();
    let requested = canvasd::protocol::normalize_permission(permission.as_deref());
    let level = canvasd::protocol::clamp_to_parent(requested, parent_level.as_deref());
    let id = spawn_wired(&app, &state, &name, &command, &cwd, workspace_id.as_deref(), level)?;
    let edge_id = format!("edge-{}", &id[..8.min(id.len())]);
    let _ = state.store.delegation_created(&edge_id, &from, &id, &task);
    state
        .pending_results
        .lock()
        .unwrap()
        .insert(id.clone(), edge_id.clone());
    emit_control(&app, &ServerMsg::Spawned { agent_id: id.clone(), name, command, permission: level.to_string(), workspace_id });
    emit_control(
        &app,
        &ServerMsg::Delegation { edge_id, from, to: id.clone(), task },
    );
    Ok(id)
}

#[tauri::command]
fn pty_input(app: AppHandle, state: State<'_, CanvasState>, agent_id: String, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| e.to_string())?;
    // Supervised-input gate: hold destructive-looking input for approval.
    let supervised = state
        .agents
        .permission(&agent_id)
        .map(|p| p == "supervised")
        .unwrap_or(false);
    if supervised {
        if let Some(line) = sensitive_line(&bytes) {
            state
                .pending_inputs
                .lock()
                .unwrap()
                .insert(agent_id.clone(), bytes);
            emit_control(&app, &ServerMsg::NeedsApproval { agent_id, line });
            return Ok(());
        }
    }
    state.agents.write(&agent_id, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn approve_input(state: State<'_, CanvasState>, agent_id: String) -> Result<(), String> {
    let bytes = state.pending_inputs.lock().unwrap().remove(&agent_id);
    match bytes {
        Some(b) => state.agents.write(&agent_id, &b).map_err(|e| e.to_string()),
        None => Err("no pending input to approve".to_string()),
    }
}

#[tauri::command]
fn deny_input(state: State<'_, CanvasState>, agent_id: String) -> Result<(), String> {
    state.pending_inputs.lock().unwrap().remove(&agent_id);
    Ok(())
}

#[tauri::command]
fn pty_resize(
    state: State<'_, CanvasState>,
    agent_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.agents.resize(&agent_id, cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
fn confirm_destructive(
    app: AppHandle,
    state: State<'_, CanvasState>,
    agent_id: String,
    action: String,
) -> Result<(), String> {
    match action.as_str() {
        "kill" => {
            state.agents.kill(&agent_id).map_err(|e| e.to_string())?;
            let _ = state.store.agent_status(&agent_id, "exited");
            state.pending_results.lock().unwrap().remove(&agent_id);
            emit_control(
                &app,
                &ServerMsg::Status { agent_id, status: AgentStatus::Exited },
            );
            Ok(())
        }
        other => Err(format!("unknown destructive action: {other}")),
    }
}

#[tauri::command]
fn move_node(state: State<'_, CanvasState>, agent_id: String, x: f64, y: f64) -> Result<(), String> {
    state.store.save_node_position(&agent_id, x, y).map_err(|e| e.to_string())
}

#[tauri::command]
fn snapshot(state: State<'_, CanvasState>) -> Result<serde_json::Value, String> {
    let live: HashMap<String, &str> = state.agents.statuses().into_iter().collect();
    let agents: Vec<SnapshotAgent> = state
        .store
        .agents_snapshot()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(id, name, command, worktree, status, workspace_id, permission)| SnapshotAgent {
            status: live.get(&id).copied().unwrap_or(status.as_str()).to_string(),
            agent_id: id,
            name,
            command,
            worktree,
            permission,
            workspace_id,
        })
        .collect();
    let workspaces: Vec<canvasd::protocol::SnapshotWorkspace> = state
        .store
        .workspaces_snapshot()
        .unwrap_or_default()
        .into_iter()
        .map(|(workspace_id, name, repo)| canvasd::protocol::SnapshotWorkspace {
            workspace_id,
            name,
            repo,
        })
        .collect();
    let delegations: Vec<SnapshotDelegation> = state
        .store
        .delegations_snapshot()
        .unwrap_or_default()
        .into_iter()
        .map(|(edge_id, from, to, task, result, state, files)| SnapshotDelegation {
            edge_id, from, to, task, result, files: files.unwrap_or(0) as u32, state,
        })
        .collect();
    let layout = state.store.layout_map().unwrap_or_default();
    Ok(serde_json::json!({
        "type": "snapshot",
        "agents": agents,
        "delegations": delegations,
        "workspaces": workspaces,
        "layout": layout,
    }))
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "canvas_app=info".into()),
        )
        .init();

    tauri::Builder::default()
        .setup(|app| {
            let repo_root = std::env::var("CANVAS_REPO")
                .map(PathBuf::from)
                .unwrap_or_else(|_| std::env::current_dir().unwrap());
            let store = Arc::new(Store::open(&repo_root)?);
            store.mark_all_exited()?;
            app.manage(CanvasState {
                agents: AgentManager::new(),
                store,
                repo_root,
                pending_results: Mutex::new(HashMap::new()),
                pending_inputs: Mutex::new(HashMap::new()),
            });

            // 1s ticker: derived statuses + CANVAS_RESULT returns + diffs.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut last: HashMap<String, &'static str> = HashMap::new();
                let mut last_diff: HashMap<String, u32> = HashMap::new();
                let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
                let mut tick_n: u32 = 0;
                loop {
                    tick.tick().await;
                    tick_n = tick_n.wrapping_add(1);
                    let state = handle.state::<CanvasState>();

                    // Result returns.
                    let mut resolved: Vec<(String, String, String)> = Vec::new();
                    {
                        let map = state.pending_results.lock().unwrap();
                        for (agent_id, edge_id) in map.iter() {
                            let summary = state
                                .agents
                                .tail_text(agent_id)
                                .and_then(|t| canvas_result_line(&t));
                            if let Some(s) = summary {
                                resolved.push((agent_id.clone(), edge_id.clone(), s));
                            }
                        }
                    }
                    for (agent_id, edge_id, summary) in resolved {
                        state.pending_results.lock().unwrap().remove(&agent_id);
                        let files = state
                            .agents
                            .worktree(&agent_id)
                            .map(|wt| dirty_file_count(&wt))
                            .unwrap_or(0);
                        let _ = state.store.delegation_resolved(&edge_id, &summary, files);
                        emit_control(
                            &handle,
                            &ServerMsg::Result { edge_id, summary, files },
                        );
                    }

                    // Diff pass (every 3rd tick): files changed per worktree.
                    if tick_n.is_multiple_of(3) {
                        for id in state.agents.ids() {
                            if let Some(wt) = state.agents.worktree(&id) {
                                let files = dirty_file_count(&wt);
                                if last_diff.get(&id) != Some(&files) {
                                    last_diff.insert(id.clone(), files);
                                    emit_control(
                                        &handle,
                                        &ServerMsg::Diff { agent_id: id, files },
                                    );
                                }
                            }
                        }
                    }

                    // Derived statuses.
                    for (id, status) in state.agents.statuses() {
                        if last.get(&id) != Some(&status) {
                            last.insert(id.clone(), status);
                            let _ = state.store.agent_status(&id, status);
                            let s = match status {
                                "working" => AgentStatus::Working,
                                "waiting" => AgentStatus::Waiting,
                                "blocked" => AgentStatus::Blocked,
                                "done" => AgentStatus::Done,
                                "exited" => AgentStatus::Exited,
                                _ => AgentStatus::Idle,
                            };
                            emit_control(
                                &handle,
                                &ServerMsg::Status { agent_id: id, status: s },
                            );
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            spawn_agent,
            create_workspace,
            delegate,
            pty_input,
            approve_input,
            deny_input,
            pty_resize,
            confirm_destructive,
            move_node,
            snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running canvas");
}
