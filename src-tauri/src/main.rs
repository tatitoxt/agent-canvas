//! Canvas — Tauri shell.
//!
//! Same frontend as the web client, same core as canvasd: the Tauri app
//! replaces the WebSocket transport with native commands + events.
//! Control events → `canvas://control` (the same ServerMsg JSON as the WS
//! protocol); PTY output → `canvas://pty` { agent_id, data(base64) }.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use canvasd::agent::{canvas_result_line, dirty_diff, dirty_file_count, dirty_files, sensitive_line, worktree_branch, AgentManager};
use canvasd::protocol::{AgentStatus, ServerMsg, SnapshotAgent, SnapshotAutomation, SnapshotDelegation};
use canvasd::store::Store;
use std::collections::{HashMap, HashSet};
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

/// Memory file for a node: the board repo's `.canvas/memory.md`, or the
/// workspace's repo memory when node_id is a workspace.
fn memory_path(state: &CanvasState, node_id: &str) -> PathBuf {
    let repo = if node_id == "main" {
        state.repo_root.clone()
    } else {
        state
            .store
            .workspace_repo(node_id)
            .ok()
            .flatten()
            .map(PathBuf::from)
            .unwrap_or_else(|| state.repo_root.clone())
    };
    repo.join(".canvas").join("memory.md")
}

/// Spawn a PTY agent wired to emit events + persist. Shared by spawn_agent
/// and delegate.
#[allow(clippy::too_many_arguments)]
fn spawn_wired(
    app: &AppHandle,
    state: &CanvasState,
    name: &str,
    command: &str,
    cwd: &str,
    workspace_id: Option<&str>,
    permission: &str,
    board_id: Option<&str>,
    account_id: Option<&str>,
) -> Result<(String, Option<String>), String> {
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
    // Named account: per-account config dir so several sign-ins of the
    // same CLI coexist.
    let pty_env: Vec<(String, String)> = account_id
        .and_then(|a| state.store.account_record(a).ok().flatten())
        .and_then(|(cli, _label, dir)| {
            let abs = state.repo_root.join(&dir);
            let _ = std::fs::create_dir_all(&abs);
            canvasd::agent::account_env_key(&cli)
                .map(|k| vec![(k.to_string(), abs.to_string_lossy().to_string())])
        })
        .unwrap_or_default();
    // Workspace (or board) memory — injected as CANVAS_MEMORY.
    let mem_scope = workspace_id.unwrap_or("main");
    let mem_path = memory_path(state, mem_scope);
    if let Some(p) = mem_path.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    if !mem_path.exists() {
        let _ = std::fs::write(&mem_path, "");
    }
    let mut pty_env = pty_env;
    pty_env.push(("CANVAS_MEMORY".to_string(), mem_path.to_string_lossy().to_string()));
    let id = state
        .agents
        .spawn(name, command, cwd, &repo_root, permission, out_tx, exit_tx, &pty_env)
        .map_err(|e| e.to_string())?;
    // Board: explicit, else the workspace's board, else 'main'.
    let board = board_id
        .map(|b| b.to_string())
        .or_else(|| {
            workspace_id.and_then(|w| state.store.workspace_board(w).ok().flatten())
        });
    if let Err(e) = state.store.agent_spawned(
        &id,
        name,
        command,
        &format!(".canvas-worktrees/{id}"),
        workspace_id,
        permission,
        board.as_deref(),
        account_id,
    ) {
        warn!(error = %e, "failed to persist agent");
    }
    Ok((id, board))
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
    board_id: Option<String>,
    account_id: Option<String>,
    initial_input: Option<String>,
) -> Result<String, String> {
    let level = canvasd::protocol::normalize_permission(permission.as_deref());
    let (id, board) = spawn_wired(&app, state.inner(), &name, &command, &cwd, workspace_id.as_deref(), level, board_id.as_deref(), account_id.as_deref())?;
    if let Some(text) = initial_input {
        // Quick request: type the task once the CLI has booted.
        let app2 = app.clone();
        let target = id.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            let mut data = text.into_bytes();
            data.push(b'\r');
            let st = app2.state::<CanvasState>();
            let _ = st.agents.write(&target, &data);
        });
    }
    emit_control(&app, &ServerMsg::Spawned { agent_id: id.clone(), name, command, permission: level.to_string(), workspace_id, board_id: board });
    Ok(id)
}

#[tauri::command]
fn create_board(
    app: AppHandle,
    state: State<'_, CanvasState>,
    name: String,
) -> Result<String, String> {
    let id = uuid_v4ish();
    state
        .store
        .board_created(&id, &name)
        .map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::BoardCreated { board_id: id.clone(), name });
    Ok(id)
}

#[tauri::command]
fn create_account(
    app: AppHandle,
    state: State<'_, CanvasState>,
    cli: String,
    label: String,
) -> Result<String, String> {
    let account_id = format!("acct-{}", &uuid_v4ish()[..8]);
    let dir = format!(".canvas/accounts/{account_id}");
    let _ = std::fs::create_dir_all(state.repo_root.join(&dir));
    state
        .store
        .account_created(&account_id, &cli, &label, &dir)
        .map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::AccountCreated { account_id: account_id.clone(), cli, label });
    Ok(account_id)
}

#[tauri::command]
fn delete_account(
    app: AppHandle,
    state: State<'_, CanvasState>,
    account_id: String,
) -> Result<(), String> {
    state
        .store
        .account_deleted(&account_id)
        .map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::AccountDeleted { account_id });
    Ok(())
}

#[tauri::command]
fn move_to_board(
    app: AppHandle,
    state: State<'_, CanvasState>,
    node_id: String,
    board_id: String,
) -> Result<(), String> {
    match state.store.node_moved_to_board(&node_id, &board_id) {
        Ok(true) => {
            emit_control(&app, &ServerMsg::BoardMoved { node_id, board_id });
            Ok(())
        }
        Ok(false) => Err("no such node".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn rename_node(
    app: AppHandle,
    state: State<'_, CanvasState>,
    node_id: String,
    name: String,
) -> Result<(), String> {
    match state.store.node_renamed(&node_id, &name) {
        Ok(true) => {
            emit_control(&app, &ServerMsg::NodeRenamed { node_id, name });
            Ok(())
        }
        _ => Err("no such node".to_string()),
    }
}

#[tauri::command]
fn rename_board(
    app: AppHandle,
    state: State<'_, CanvasState>,
    board_id: String,
    name: String,
) -> Result<(), String> {
    match state.store.board_renamed(&board_id, &name) {
        Ok(true) => {
            emit_control(&app, &ServerMsg::BoardRenamed { board_id, name });
            Ok(())
        }
        _ => Err("no such board".to_string()),
    }
}

#[tauri::command]
fn delete_board(
    app: AppHandle,
    state: State<'_, CanvasState>,
    board_id: String,
) -> Result<(), String> {
    match state.store.board_deleted(&board_id) {
        Ok(true) => {
            emit_control(&app, &ServerMsg::BoardDeleted { board_id });
            Ok(())
        }
        _ => Err("board not empty or is main".to_string()),
    }
}

#[tauri::command]
fn delete_delegation(
    app: AppHandle,
    state: State<'_, CanvasState>,
    edge_id: String,
) -> Result<(), String> {
    match state.store.delegation_delete(&edge_id) {
        Ok(true) => {
            emit_control(&app, &ServerMsg::DelegationRemoved { edge_id });
            Ok(())
        }
        _ => Err("no such delegation".to_string()),
    }
}

#[tauri::command]
fn studio_doc(app: AppHandle, state: State<'_, CanvasState>, board_id: Option<String>) -> Result<(), String> {
    let board = board_id.unwrap_or_else(|| "main".to_string());
    let mut md = String::from("# Studio — repo dossier

");
    let repo = &state.repo_root;
    md.push_str(&format!("## Tree — {}\n\n```\n", repo.display()));
    fn walk(d: &std::path::Path, depth: usize, prefix: &str, out: &mut String) {
        if depth > 2 { return; }
        let mut entries: Vec<_> = std::fs::read_dir(d).map(|rd| rd.flatten().collect()).unwrap_or_default();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || matches!(name.as_str(), "node_modules" | "target" | "dist" | "build") { continue; }
            out.push_str(&format!("{prefix}{name}{}\n", if e.path().is_dir() { "/" } else { "" }));
            if e.path().is_dir() { walk(&e.path(), depth + 1, &format!("{prefix}  "), out); }
        }
    }
    walk(repo, 0, "", &mut md);
    md.push_str("```\n\n");
    if let Ok(readme) = std::fs::read_to_string(repo.join("README.md")) {
        let head: String = readme.lines().take(40).collect::<Vec<_>>().join("\n");
        md.push_str(&format!("## README (head)\n\n{head}\n\n"));
    }
    let agents = state.store.agents_snapshot().unwrap_or_default();
    md.push_str("## Agents\n\n");
    for (_id, name, command, _wt, status, _ws, _perm, bd, acct) in &agents {
        if bd.as_deref().unwrap_or("main") != board { continue; }
        md.push_str(&format!("- **{name}** (`{command}`) — {status}{}\n", acct.as_ref().map(|l| format!(" · @{l}")).unwrap_or_default()));
    }
    let notes = state.store.all_notes().unwrap_or_default();
    let board_notes: Vec<_> = notes.iter().filter(|n| n.1 == board).collect();
    if !board_notes.is_empty() {
        md.push_str("\n## Notes\n\n");
        for (_id, _b, col, text, _pos, due) in &board_notes {
            md.push_str(&format!("- [{col}] {text}{}\n", due.as_ref().map(|d| format!(" (due {d})")).unwrap_or_default()));
        }
    }
    let arts = state.store.artifacts_snapshot().unwrap_or_default();
    let board_arts: Vec<_> = arts.iter().filter(|a| a.1 == board).collect();
    if !board_arts.is_empty() {
        md.push_str("\n## Artifacts\n\n");
        for (id, _bd, agent, kind, title, _p, _t, at) in &board_arts {
            md.push_str(&format!("- `{kind}` **{title}** — {} ({at}, `{id}`)\n", agent.as_deref().unwrap_or("-")));
        }
    }
    emit_control(&app, &ServerMsg::StudioDocMd { text: md });
    Ok(())
}

/// Image attachments Obsidian shows in the file explorer — listed beside
/// the notes so `![[img.png]]` embeds can resolve them.
fn is_vault_image(name: &str) -> bool {
    matches!(
        name.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "ico"
    )
}

fn vault_list_entries(root: &PathBuf) -> Vec<String> {
    let mut entries = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(d) = stack.pop() {
        if let Ok(rd) = std::fs::read_dir(&d) {
            for e in rd.flatten() {
                let p = e.path();
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with('.')
                    || matches!(name.as_str(), "node_modules" | "target" | "dist" | "build")
                {
                    continue;
                }
                if e.file_type().map(|t| t.is_symlink()).unwrap_or(true) {
                    continue;
                }
                if p.is_dir() && stack.len() + entries.len() < 5000 {
                    stack.push(p);
                } else if name.ends_with(".md") || is_vault_image(&name) {
                    if let Ok(rel) = p.strip_prefix(root) {
                        entries.push(rel.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    entries.sort();
    entries
}

fn vault_links(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("[[") {
        let inner = &rest[start + 2..];
        let Some(end) = inner.find("]]") else { break };
        let name = inner[..end].split('|').next().unwrap_or("").trim();
        if !name.is_empty() { out.push(name.to_string()); }
        rest = &inner[end + 2..];
    }
    let mut rest = text;
    while let Some(pos) = rest.find("](") {
        let inner = &rest[pos + 2..];
        let Some(end) = inner.find(')') else { break };
        let target = inner[..end].trim();
        if target.ends_with(".md") { out.push(target.to_string()); }
        rest = &inner[end..];
    }
    out
}

/// Default vault to auto-mount on first run: ~/Documents/Orkelya-Memory
/// when it exists, else ~/Documents, else the home dir.
#[tauri::command]
fn default_vault_dir() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    for cand in [format!("{home}/Documents/Orkelya-Memory"), format!("{home}/Documents"), home] {
        if PathBuf::from(&cand).is_dir() {
            return Some(cand);
        }
    }
    None
}

#[tauri::command]
fn vault_discover(app: AppHandle) -> Result<(), String> {
    emit_control(&app, &ServerMsg::VaultDiscovered { vaults: canvasd::vault::discover() });
    Ok(())
}

#[tauri::command]
fn vault_register(app: AppHandle, dir: String) -> Result<(), String> {
    let vaults = canvasd::vault::register(&dir)?;
    emit_control(&app, &ServerMsg::VaultDiscovered { vaults });
    Ok(())
}

#[tauri::command]
fn vault_list(app: AppHandle, dir: String) -> Result<(), String> {
    let root = PathBuf::from(&dir);
    let mut entries = vault_list_entries(&root);
    entries.truncate(2000);
    emit_control(&app, &ServerMsg::VaultListing { dir, entries });
    Ok(())
}

#[tauri::command]
fn vault_graph(app: AppHandle, dir: String) -> Result<(), String> {
    let root = PathBuf::from(&dir);
    let nodes = vault_list_entries(&root);
    let resolve = |name: &str| -> Option<String> {
        let n = name.trim();
        nodes.iter().find(|e| {
            e.as_str() == n
                || **e == format!("{n}.md")
                || e.ends_with(&format!("/{n}.md"))
                || e.trim_end_matches(".md") == n
        }).cloned()
    };
    let mut edges: Vec<(String, String)> = Vec::new();
    for e in &nodes {
        if let Ok(text) = std::fs::read_to_string(root.join(e)) {
            for name in vault_links(&text) {
                if let Some(t) = resolve(&name) {
                    if t != *e { edges.push((e.clone(), t)); }
                }
            }
        }
    }
    edges.sort();
    edges.dedup();
    emit_control(&app, &ServerMsg::VaultGraph { dir, nodes, edges });
    Ok(())
}

#[tauri::command]
fn vault_search(app: AppHandle, dir: String, query: String) -> Result<(), String> {
    let root = PathBuf::from(&dir);
    let needle = query.to_lowercase();
    let mut hits = Vec::new();
    let mut scanned = 0usize;
    if needle.len() >= 2 {
        let mut stack = vec![root.clone()];
        while let Some(d) = stack.pop() {
            if hits.len() >= 60 || scanned >= 500 {
                break;
            }
            if let Ok(rd) = std::fs::read_dir(&d) {
                for e in rd.flatten() {
                    if hits.len() >= 60 {
                        break;
                    }
                    let p = e.path();
                    let name = e.file_name().to_string_lossy().to_string();
                    if name.starts_with('.')
                        || matches!(name.as_str(), "node_modules" | "target" | "dist" | "build")
                    {
                        continue;
                    }
                    if e.file_type().map(|t| t.is_symlink()).unwrap_or(true) {
                        continue;
                    }
                    if p.is_dir() {
                        stack.push(p);
                        continue;
                    }
                    if !name.ends_with(".md") {
                        continue;
                    }
                    scanned += 1;
                    let Ok(text) = std::fs::read_to_string(&p) else {
                        continue;
                    };
                    let Ok(rel) = p.strip_prefix(&root) else {
                        continue;
                    };
                    let rel = rel.to_string_lossy().to_string();
                    for (i, line) in text.lines().enumerate() {
                        if line.to_lowercase().contains(&needle) {
                            hits.push(canvasd::protocol::VaultHit {
                                path: rel.clone(),
                                line: (i + 1) as u32,
                                text: line.trim().chars().take(160).collect(),
                            });
                            if hits.len() >= 60 {
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
    emit_control(&app, &ServerMsg::VaultHits { dir, query, hits });
    Ok(())
}

#[tauri::command]
fn vault_read(app: AppHandle, dir: String, path: String) -> Result<(), String> {
    let file = PathBuf::from(&dir).join(&path);
    if path.contains("..") || !path.ends_with(".md") || !file.is_file() {
        return Err("not a markdown file in the vault".into());
    }
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::VaultFile { path, text });
    Ok(())
}

/// Read a vault file without making it the open note — powers `![[embeds]]`.
#[tauri::command]
fn vault_peek(app: AppHandle, dir: String, path: String) -> Result<(), String> {
    let file = PathBuf::from(&dir).join(&path);
    if path.contains("..") || !path.ends_with(".md") || !file.is_file() {
        return Err("not a markdown file in the vault".into());
    }
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::VaultPeeked { path, text });
    Ok(())
}

/// Read a binary vault asset (image) as base64 — powers `![[image.png]]`.
#[tauri::command]
fn vault_asset(app: AppHandle, dir: String, path: String) -> Result<(), String> {
    let file = PathBuf::from(&dir).join(&path);
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => return Err("not an image asset".into()),
    };
    if path.contains("..") || !file.is_file() {
        return Err("not a file in the vault".into());
    }
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("asset too large".into());
    }
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    emit_control(&app, &ServerMsg::VaultAssetData { path, mime: mime.to_string(), data });
    Ok(())
}

#[tauri::command]
fn vault_append(app: AppHandle, dir: String, path: String, text: String) -> Result<(), String> {
    let file = PathBuf::from(&dir).join(&path);
    if path.contains("..") || !path.ends_with(".md") {
        return Err("vault append refused".into());
    }
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&file).map_err(|e| e.to_string())?;
    writeln!(f, "{text}").map_err(|e| e.to_string())?;
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::VaultFile { path, text });
    Ok(())
}

#[tauri::command]
fn vault_delete(app: AppHandle, dir: String, path: String) -> Result<(), String> {
    let file = PathBuf::from(&dir).join(&path);
    if path.contains("..") || !path.ends_with(".md") || !file.is_file() {
        return Err("vault delete refused".into());
    }
    // Obsidian-style trash: move to <vault>/.trash/, recoverable always.
    let trash = PathBuf::from(&dir).join(".trash");
    let base = file.file_name().ok_or("bad name")?;
    let mut dest = trash.join(base);
    if dest.exists() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        let stem = file.file_stem().ok_or("bad name")?.to_string_lossy();
        dest = trash.join(format!("{stem}.{stamp}.md"));
    }
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    std::fs::rename(&file, &dest).map_err(|e| e.to_string())?;
    vault_list(app, dir)
}

#[tauri::command]
fn vault_rename(app: AppHandle, dir: String, path: String, new_path: String) -> Result<(), String> {
    let root = PathBuf::from(&dir);
    let from = root.join(&path);
    let to = root.join(&new_path);
    if path.contains("..") || new_path.contains("..") || !path.ends_with(".md") || !new_path.ends_with(".md") || !from.is_file() {
        return Err("vault rename refused".into());
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
    let text = std::fs::read_to_string(&to).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::VaultFile { path: new_path, text });
    vault_list(app, dir)
}

#[tauri::command]
fn vault_write(app: AppHandle, dir: String, path: String, text: String) -> Result<(), String> {
    let file = PathBuf::from(&dir).join(&path);
    if path.contains("..") || !path.ends_with(".md") {
        return Err("vault write refused".into());
    }
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&file, &text).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::VaultFile { path, text });
    Ok(())
}

#[tauri::command]
fn git_push(app: AppHandle, state: State<'_, CanvasState>, agent_id: String) -> Result<(), String> {
    let wt = state
        .store
        .agent_worktree(&agent_id)
        .map_err(|e| e.to_string())?
        .map(|w| state.repo_root.join(&w))
        .filter(|p| p.is_dir())
        .ok_or("no worktree for agent")?;
    let out = std::process::Command::new("git")
        .args(["-C"])
        .arg(&wt)
        .args(["push", "-u", "origin", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        emit_control(&app, &ServerMsg::GitPushed {
            agent_id,
            output: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        });
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[tauri::command]
fn artifact_create(
    app: AppHandle,
    state: State<'_, CanvasState>,
    board_id: Option<String>,
    agent_id: Option<String>,
    kind: String,
    title: String,
    path: Option<String>,
    text: Option<String>,
) -> Result<(), String> {
    let id = format!("art-{}", &uuid_v4ish()[..8]);
    let board = board_id
        .or_else(|| agent_id.as_deref().and_then(|a| state.store.agent_board(a).ok().flatten()))
        .unwrap_or_else(|| "main".to_string());
    let agent_name = agent_id
        .as_deref()
        .and_then(|a| state.store.agent_name(a).ok().flatten());
    state
        .store
        .artifact_created(&id, &board, agent_id.as_deref(), &kind, &title, path.as_deref(), text.as_deref())
        .map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::ArtifactCreated {
        artifact: canvasd::protocol::SnapshotArtifact {
            artifact_id: id, board_id: board, agent_id, agent_name, kind, title, path, text,
            created_at: String::new(),
        },
    });
    Ok(())
}

#[tauri::command]
fn artifact_delete(app: AppHandle, state: State<'_, CanvasState>, artifact_id: String) -> Result<(), String> {
    state.store.artifact_deleted(&artifact_id).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::ArtifactDeleted { artifact_id });
    Ok(())
}

#[tauri::command]
fn note_upsert(
    app: AppHandle,
    state: State<'_, CanvasState>,
    note_id: Option<String>,
    board_id: Option<String>,
    col: String,
    text: String,
    pos: Option<i64>,
    due: Option<String>,
) -> Result<(), String> {
    let id = note_id.unwrap_or_else(|| format!("note-{}", &uuid_v4ish()[..8]));
    let board = board_id.unwrap_or_else(|| "main".to_string());
    let p = match pos {
        Some(p) => p,
        None => state.store.note_next_pos(&board, &col).map_err(|e| e.to_string())?,
    };
    state.store.note_upsert(&id, &board, &col, &text, p, due.as_deref()).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::NoteUpserted {
        note: canvasd::protocol::SnapshotNote { note_id: id, board_id: board, col, text, pos: p, due },
    });
    Ok(())
}

#[tauri::command]
fn note_delete(app: AppHandle, state: State<'_, CanvasState>, note_id: String) -> Result<(), String> {
    state.store.note_deleted(&note_id).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::NoteDeleted { note_id });
    Ok(())
}

#[tauri::command]
fn session_digest(app: AppHandle, state: State<'_, CanvasState>) -> Result<(), String> {
    let rows = state.store.agents_snapshot().map_err(|e| e.to_string())?;
    let mut md = String::from("# Session digest\n\n");
    for (id, name, command, _wt, status, _ws, _perm, _bd, acct) in &rows {
        md.push_str(&format!("## {name} (`{command}`) — {status}"));
        if let Some(l) = acct {
            md.push_str(&format!(" · @{l}"));
        }
        md.push_str("\n");
        let tail = state
            .agents
            .scrollback(id)
            .map(|b| String::from_utf8_lossy(&b).to_string())
            .unwrap_or_default();
        let lines: Vec<String> = tail
            .lines()
            .filter_map(canvasd::agent::last_visible_line)
            .filter(|l| !l.is_empty())
            .collect();
        for l in lines.iter().rev().take(6).rev() {
            md.push_str(&format!("    {l}\n"));
        }
        md.push_str("\n");
    }
    emit_control(&app, &ServerMsg::SessionDigest { text: md });
    Ok(())
}

#[tauri::command]
fn memory_read(state: State<'_, CanvasState>, node_id: String) -> Result<String, String> {
    Ok(std::fs::read_to_string(memory_path(state.inner(), &node_id)).unwrap_or_default())
}

#[tauri::command]
fn memory_write(app: AppHandle, state: State<'_, CanvasState>, node_id: String, text: String) -> Result<(), String> {
    let path = memory_path(state.inner(), &node_id);
    if let Some(p) = path.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    std::fs::write(&path, &text).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::Memory { node_id, text });
    Ok(())
}

#[tauri::command]
fn delete_workspace(
    app: AppHandle,
    state: State<'_, CanvasState>,
    workspace_id: String,
) -> Result<(), String> {
    match state.store.workspace_deleted(&workspace_id) {
        Ok(true) => {
            emit_control(&app, &ServerMsg::WorkspaceDeleted { workspace_id });
            Ok(())
        }
        _ => Err("workspace has live agents".to_string()),
    }
}

#[tauri::command]
fn create_workspace(
    app: AppHandle,
    state: State<'_, CanvasState>,
    name: String,
    repo: String,
    board_id: Option<String>,
) -> Result<String, String> {
    let id = uuid_v4ish();
    state
        .store
        .workspace_created(&id, &name, &repo, board_id.as_deref())
        .map_err(|e| e.to_string())?;
    emit_control(
        &app,
        &ServerMsg::WorkspaceCreated { workspace_id: id.clone(), name, repo, board_id },
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
    account_id: Option<String>,
    board_id: Option<String>,
    initial_input: Option<String>,
) -> Result<String, String> {
    let parent_level = state.store.agent_permission(&from).ok().flatten();
    let requested = canvasd::protocol::normalize_permission(permission.as_deref());
    let level = canvasd::protocol::clamp_to_parent(requested, parent_level.as_deref());
    // The child lands on the requested board, else its parent's
    // (orchestrator nodes aren't agents — they carry theirs over).
    let parent_board = board_id.or(state.store.agent_board(&from).ok().flatten());
    let (id, board) = spawn_wired(&app, state.inner(), &name, &command, &cwd, workspace_id.as_deref(), level, parent_board.as_deref(), account_id.as_deref())?;
    let edge_id = format!("edge-{}", &id[..8.min(id.len())]);
    let _ = state.store.delegation_created(&edge_id, &from, &id, &task);
    state
        .pending_results
        .lock()
        .unwrap()
        .insert(id.clone(), edge_id.clone());
    if let Some(text) = initial_input {
        // Type the brief once the CLI has booted (same delay as spawn_agent).
        let app2 = app.clone();
        let target = id.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            let mut data = text.into_bytes();
            data.push(b'\r');
            let st = app2.state::<CanvasState>();
            let _ = st.agents.write(&target, &data);
        });
    }
    emit_control(&app, &ServerMsg::Spawned { agent_id: id.clone(), name, command, permission: level.to_string(), workspace_id, board_id: board });
    emit_control(
        &app,
        &ServerMsg::Delegation { edge_id, from, to: id.clone(), task },
    );
    Ok(id)
}

fn loop_to_snapshot(
    (loop_id, board_id, target, instruction, trigger, interval_secs, pattern, enabled, last_fired_at): canvasd::store::LoopRow,
) -> canvasd::protocol::SnapshotLoop {
    canvasd::protocol::SnapshotLoop {
        loop_id, board_id, target, instruction, trigger,
        interval_secs: interval_secs.map(|v| v.max(0) as u64),
        pattern, enabled, last_fired_at,
    }
}

fn loop_targets(state: &CanvasState, board_id: &str, target: &str) -> Vec<String> {
    let live: HashSet<String> = state.agents.ids().into_iter().collect();
    if target == "*" {
        state
            .store
            .agents_snapshot()
            .unwrap_or_default()
            .into_iter()
            .filter(|a| a.7.as_deref() == Some(board_id) && live.contains(&a.0))
            .map(|a| a.0)
            .collect()
    } else {
        live.contains(target).then(|| target.to_string()).into_iter().collect()
    }
}

/// Fire a loop: write its instruction to every resolved target — gated
/// exactly like the automation prompt (supervised + sensitive → held).
fn fire_loop(app: &AppHandle, state: &CanvasState, row: &canvasd::store::LoopRow) {
    let (loop_id, board_id, target, instruction, _, _, _, _, _) = row;
    for id in loop_targets(state, board_id, target) {
        let bytes = format!("{instruction}\n");
        let gated = state
            .agents
            .permission(&id)
            .map(|p| p == "supervised")
            .unwrap_or(false)
            && sensitive_line(bytes.as_bytes()).is_some();
        if gated {
            if let Some(line) = sensitive_line(bytes.as_bytes()) {
                state.pending_inputs.lock().unwrap().insert(id.clone(), bytes.into_bytes());
                emit_control(app, &ServerMsg::NeedsApproval { agent_id: id, line });
                continue;
            }
        }
        let _ = state.agents.write(&id, bytes.as_bytes());
    }
    let _ = state.store.loop_fired(loop_id);
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn create_loop(
    app: AppHandle,
    state: State<'_, CanvasState>,
    board_id: String,
    target: String,
    instruction: String,
    trigger: String,
    interval_secs: Option<u64>,
    pattern: Option<String>,
) -> Result<String, String> {
    let trigger = match trigger.as_str() {
        "idle" | "match" => trigger.as_str(),
        _ => "interval",
    };
    let interval = interval_secs.map(|v| v.clamp(30, 86_400));
    let id = uuid_v4ish();
    state
        .store
        .loop_insert(&id, &board_id, &target, &instruction, trigger, interval, pattern.as_deref())
        .map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::LoopSaved {
        l: canvasd::protocol::SnapshotLoop {
            loop_id: id.clone(), board_id, target, instruction,
            trigger: trigger.to_string(), interval_secs: interval,
            pattern, enabled: true, last_fired_at: None,
        },
    });
    Ok(id)
}

#[tauri::command]
fn run_loop(
    app: AppHandle,
    state: State<'_, CanvasState>,
    loop_id: String,
) -> Result<(), String> {
    let row = state
        .store
        .loops_snapshot()
        .unwrap_or_default()
        .into_iter()
        .find(|r| r.0 == loop_id)
        .ok_or_else(|| format!("loop not found: {loop_id}"))?;
    fire_loop(&app, &state, &row);
    if let Some(l) = state
        .store
        .loops_snapshot()
        .unwrap_or_default()
        .into_iter()
        .find(|r| r.0 == loop_id)
        .map(loop_to_snapshot)
    {
        emit_control(&app, &ServerMsg::LoopSaved { l });
    }
    Ok(())
}

#[tauri::command]
fn delete_loop(
    app: AppHandle,
    state: State<'_, CanvasState>,
    loop_id: String,
) -> Result<(), String> {
    state.store.loop_deleted(&loop_id).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::LoopDeleted { loop_id });
    Ok(())
}

#[tauri::command]
fn pause_all(
    state: State<'_, CanvasState>,
    board_id: Option<String>,
) -> Result<usize, String> {
    let board = board_id.unwrap_or_else(|| "main".to_string());
    let ids = loop_targets(&state, &board, "*");
    Ok(state.agents.suspend_many(&ids))
}

#[tauri::command]
fn resume_all(
    state: State<'_, CanvasState>,
    board_id: Option<String>,
) -> Result<usize, String> {
    let board = board_id.unwrap_or_else(|| "main".to_string());
    let ids = loop_targets(&state, &board, "*");
    Ok(state.agents.resume_many(&ids))
}

#[tauri::command]
fn set_loop_enabled(
    app: AppHandle,
    state: State<'_, CanvasState>,
    loop_id: String,
    enabled: bool,
) -> Result<(), String> {
    state
        .store
        .loop_set_enabled(&loop_id, enabled)
        .map_err(|e| e.to_string())?;
    if let Some(l) = state
        .store
        .loops_snapshot()
        .unwrap_or_default()
        .into_iter()
        .find(|r| r.0 == loop_id)
        .map(loop_to_snapshot)
    {
        emit_control(&app, &ServerMsg::LoopSaved { l });
    }
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn create_automation(
    app: AppHandle,
    state: State<'_, CanvasState>,
    name: String,
    prompt: String,
    command: String,
    workspace_id: Option<String>,
    permission: Option<String>,
    idle_secs: Option<u64>,
    on_approval: Option<String>,
    interval_secs: Option<u64>,
) -> Result<String, String> {
    let level = canvasd::protocol::normalize_permission(permission.as_deref());
    let policy = if on_approval.as_deref() == Some("deny") { "deny" } else { "hold" };
    let idle = idle_secs.unwrap_or(300).clamp(10, 86_400);
    let interval = interval_secs.map(|v| v.clamp(60, 86_400));
    let id = uuid_v4ish();
    state
        .store
        .automation_created(&id, &name, &prompt, &command, workspace_id.as_deref(), level, idle, policy, interval)
        .map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::AutomationSaved {
        automation: SnapshotAutomation {
            id: id.clone(),
            name,
            prompt,
            command,
            workspace_id,
            permission: level.to_string(),
            idle_secs: idle,
            on_approval: policy.to_string(),
            last_run_at: None,
            interval_secs: interval,
            next_run_at: None,
        },
    });
    Ok(id)
}

#[tauri::command]
fn run_automation(
    app: AppHandle,
    state: State<'_, CanvasState>,
    automation_id: String,
) -> Result<String, String> {
    let row = state
        .store
        .automation_row(&automation_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no such automation".to_string())?;
    run_automation_row(&app, &state, row)
}

/// Shared by the manual run_automation command and the schedule ticker.
fn run_automation_row(
    app: &AppHandle,
    state: &CanvasState,
    row: canvasd::store::AutomationRow,
) -> Result<String, String> {
    let (automation_id, name, prompt, command, workspace_id, permission, idle_secs, on_approval, _, _, _) = row;
    let (id, run_board) = spawn_wired(app, state, &name, &command, ".", workspace_id.as_deref(), &permission, None, None)?;
    state
        .agents
        .set_automation(&id, idle_secs.max(0) as u64, on_approval == "deny");
    let _ = state.store.automation_ran(&automation_id);
    emit_control(app, &ServerMsg::Spawned {
        agent_id: id.clone(),
        name,
        command,
        permission,
        workspace_id,
        board_id: run_board,
    });
    // Inject the saved prompt — the kernel PTY buffer holds it until the
    // CLI reads stdin, gated like operator input.
    let bytes = format!("{prompt}\n");
    if state
        .agents
        .permission(&id)
        .map(|p| p == "supervised")
        .unwrap_or(false)
    {
        if let Some(line) = sensitive_line(bytes.as_bytes()) {
            if !state
                .agents
                .automation(&id)
                .map(|m| m.deny_approvals)
                .unwrap_or(false)
            {
                state
                    .pending_inputs
                    .lock()
                    .unwrap()
                    .insert(id.clone(), bytes.into_bytes());
                emit_control(app, &ServerMsg::NeedsApproval { agent_id: id.clone(), line });
                return Ok(id);
            }
            emit_control(app, &ServerMsg::NeedsAttention {
                agent_id: id.clone(),
                reason: format!("automation policy denied: {line}"),
            });
            return Ok(id);
        }
    }
    state.agents.write(&id, bytes.as_bytes()).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn delete_automation(
    app: AppHandle,
    state: State<'_, CanvasState>,
    automation_id: String,
) -> Result<(), String> {
    state
        .store
        .automation_deleted(&automation_id)
        .map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::AutomationDeleted { automation_id });
    Ok(())
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
            // Automation guardrail: a run whose approval policy is "deny"
            // drops gated input instead of waiting on a human forever.
            if state
                .agents
                .automation(&agent_id)
                .map(|m| m.deny_approvals)
                .unwrap_or(false)
            {
                emit_control(&app, &ServerMsg::NeedsAttention {
                    agent_id,
                    reason: format!("automation policy denied: {line}"),
                });
                return Ok(());
            }
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
fn set_permission(
    app: AppHandle,
    state: State<'_, CanvasState>,
    agent_id: String,
    permission: String,
) -> Result<(), String> {
    let level = canvasd::protocol::normalize_permission(Some(&permission));
    state.agents.set_permission(&agent_id, level);
    state
        .store
        .set_agent_permission(&agent_id, level)
        .map_err(|e| e.to_string())?;
    emit_control(
        &app,
        &ServerMsg::PermissionChanged {
            agent_id,
            permission: level.to_string(),
        },
    );
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
        "forget" => {
            let _ = state.agents.kill(&agent_id); // no-op if already gone
            state.store.remove_agent(&agent_id).map_err(|e| e.to_string())?;
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

/// Stream an exited agent's on-disk transcript back as PTY frames —
/// opening a dead node's terminal shows its history, not a blank screen.
#[tauri::command]
fn transcript(
    app: AppHandle,
    state: State<'_, CanvasState>,
    agent_id: String,
) -> Result<(), String> {
    match state.agents.scrollback(&agent_id) {
        Some(buf) if !buf.is_empty() => {
            emit_pty(&app, &agent_id, &buf);
            Ok(())
        }
        _ => Err("no transcript for agent".into()),
    }
}

#[tauri::command]
fn diff_detail(
    app: AppHandle,
    state: State<'_, CanvasState>,
    agent_id: String,
) -> Result<(), String> {
    let wt = state
        .agents
        .worktree(&agent_id)
        .or_else(|| {
            state
                .store
                .agent_worktree(&agent_id)
                .ok()
                .flatten()
                .map(std::path::PathBuf::from)
        });
    match wt {
        Some(wt) => {
            emit_control(&app, &ServerMsg::DiffDetail { agent_id, diff: dirty_diff(&wt) });
            Ok(())
        }
        None => Err("no such agent".into()),
    }
}

#[tauri::command]
fn snapshot(
    app: AppHandle,
    state: State<'_, CanvasState>,
) -> Result<serde_json::Value, String> {
    // Transcript replay: buffered PTY scrollback so a reopened terminal
    // shows history instead of a blank screen.
    for id in state.agents.list() {
        if let Some(buf) = state.agents.scrollback(&id) {
            if !buf.is_empty() {
                emit_pty(&app, &id, &buf);
            }
        }
    }
    let live: HashMap<String, &str> = state.agents.statuses().into_iter().collect();
    let acct_labels: HashMap<String, String> = state
        .store
        .accounts_snapshot()
        .unwrap_or_default()
        .into_iter()
        .map(|(id, _cli, label)| (id, label))
        .collect();
    let agents: Vec<SnapshotAgent> = state
        .store
        .agents_snapshot()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(id, name, command, worktree, status, workspace_id, permission, board_id, account_id)| {
            let ob = state
                .repo_root
                .join(".canvas")
                .join("transcripts")
                .join(format!("{id}.bin"))
                .metadata()
                .map(|m| m.len())
                .unwrap_or(0);
            SnapshotAgent {
            status: live.get(&id).copied().unwrap_or(status.as_str()).to_string(),
            account_label: account_id.and_then(|a| acct_labels.get(&a).cloned()),
            agent_id: id,
            name,
            command,
            worktree,
            permission,
            workspace_id,
            board_id,
            output_bytes: ob,
        }
        })
        .collect();
    let workspaces: Vec<canvasd::protocol::SnapshotWorkspace> = state
        .store
        .workspaces_snapshot()
        .unwrap_or_default()
        .into_iter()
        .map(|(workspace_id, name, repo, board_id)| canvasd::protocol::SnapshotWorkspace {
            workspace_id,
            name,
            repo,
            board_id,
        })
        .collect();
    let boards: Vec<canvasd::protocol::SnapshotBoard> = state
        .store
        .boards_snapshot()
        .unwrap_or_default()
        .into_iter()
        .map(|(board_id, name)| canvasd::protocol::SnapshotBoard { board_id, name })
        .collect();
    let delegations: Vec<SnapshotDelegation> = state
        .store
        .delegations_snapshot()
        .unwrap_or_default()
        .into_iter()
        .map(|(edge_id, from, to, task, result, state, files, created_at, resolved_at)| SnapshotDelegation {
            edge_id, from, to, task, result, files: files.unwrap_or(0) as u32, state, created_at, resolved_at,
        })
        .collect();
    let accts: Vec<canvasd::protocol::SnapshotAccount> = state
        .store
        .accounts_snapshot()
        .unwrap_or_default()
        .into_iter()
        .map(|(account_id, cli, label)| canvasd::protocol::SnapshotAccount { account_id, cli, label })
        .collect();
    let layout = state.store.layout_map().unwrap_or_default();
    // Same remote normalization as canvasd's Snapshot::repo_url.
    let repo_url = std::process::Command::new("git")
        .args(["-C", &state.repo_root.to_string_lossy(), "remote", "get-url", "origin"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|u| !u.is_empty())
        .map(|u| {
            let inner = u.rfind("github.com/").map(|i| format!("https://{}", &u[i..]));
            let u = inner.unwrap_or_else(|| {
                u.replace("git@github.com:", "https://github.com/")
                    .replace("ssh://git@", "https://")
            });
            u.strip_suffix(".git").unwrap_or(&u).to_string()
        });
    let agent_names: std::collections::HashMap<String, String> = state
        .store
        .agents_snapshot()
        .unwrap_or_default()
        .into_iter()
        .map(|a| (a.0, a.1))
        .collect();
    let artifacts = state
        .store
        .artifacts_snapshot()
        .unwrap_or_default()
        .into_iter()
        .map(|(artifact_id, board_id, agent_id, kind, title, path, text, created_at)| {
            let agent_name = agent_id.as_ref().and_then(|a| agent_names.get(a).cloned());
            canvasd::protocol::SnapshotArtifact {
                artifact_id, board_id, agent_id, agent_name, kind, title, path, text, created_at,
            }
        })
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "type": "snapshot",
        "boards": boards,
        "accounts": accts,
        "agents": agents,
        "delegations": delegations,
        "workspaces": workspaces,
        "layout": layout,
        "repo_url": repo_url,
        "artifacts": artifacts,
        "notes": state
            .store
            .all_notes()
            .unwrap_or_default()
            .into_iter()
            .map(|(note_id, board_id, col, text, pos, due)| canvasd::protocol::SnapshotNote {
                note_id, board_id, col, text, pos, due,
            })
            .collect::<Vec<_>>(),
        "automations": state
            .store
            .automations_snapshot()
            .unwrap_or_default()
            .into_iter()
            .map(|(id, name, prompt, command, workspace_id, permission, idle_secs, on_approval, last_run_at, interval_secs, next_run_at)| SnapshotAutomation {
                id, name, prompt, command, workspace_id, permission,
                idle_secs: idle_secs.max(0) as u64, on_approval, last_run_at,
                interval_secs: interval_secs.map(|v| v.max(0) as u64), next_run_at,
            })
            .collect::<Vec<_>>(),
        "loops": state
            .store
            .loops_snapshot()
            .unwrap_or_default()
            .into_iter()
            .map(loop_to_snapshot)
            .collect::<Vec<_>>(),
        "approvals": state
            .pending_inputs
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(id, bytes)| sensitive_line(bytes).map(|line| (id.clone(), line)))
            .collect::<HashMap<_, _>>(),
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
            // Sweep: results that landed while the app was closed.
            {
                let tdir = repo_root.join(".canvas").join("transcripts");
                for (edge_id, to_node) in store.unresolved_delegations().unwrap_or_default() {
                    let summary = std::fs::read(tdir.join(format!("{to_node}.bin")))
                        .ok()
                        .map(|b| {
                            let tail = &b[b.len().saturating_sub(8192)..];
                            String::from_utf8_lossy(tail).to_string()
                        })
                        .and_then(|t| canvas_result_line(&t));
                    if let Some(summary) = summary {
                        let _ = store.delegation_resolved(&edge_id, summary.trim(), 0);
                    }
                }
            }
            let agents = AgentManager::new();
            agents.set_transcript_dir(repo_root.join(".canvas").join("transcripts"));
            app.manage(CanvasState {
                agents,
                store,
                repo_root,
                pending_results: Mutex::new(HashMap::new()),
                pending_inputs: Mutex::new(HashMap::new()),
            });

            // 1s ticker: derived statuses + CANVAS_RESULT returns + diffs.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut last: HashMap<String, &'static str> = HashMap::new();
                let mut last_diff: HashMap<String, (Vec<String>, String)> = HashMap::new();
                // Edge detection for 'match' loops — fire once per
                // appearance of the pattern, not every tick.
                let mut match_seen: HashMap<String, bool> = HashMap::new();
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
                                .or_else(|| {
                                    state
                                        .agents
                                        .scrollback(agent_id)
                                        .map(|b| String::from_utf8_lossy(&b).to_string())
                                })
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
                                let paths = dirty_files(&wt);
                                let files = paths.len() as u32;
                                let branch = worktree_branch(&wt);
                                if last_diff.get(&id) != Some(&(paths.clone(), branch.clone())) {
                                    last_diff.insert(id.clone(), (paths.clone(), branch.clone()));
                                    emit_control(
                                        &handle,
                                        &ServerMsg::Diff { agent_id: id, files, paths, branch },
                                    );
                                }
                            }
                        }
                    }

                    // Automation guardrail pass: alert once when a run goes
                    // silent past its idle limit (clears on fresh output).
                    for id in state.agents.automation_ids() {
                        if let (Some(meta), Some(silent)) = (
                            state.agents.automation(&id),
                            state.agents.silent_for(&id),
                        ) {
                            if silent >= meta.idle_secs && !meta.hang_notified {
                                state.agents.set_hang_notified(&id, true);
                                emit_control(
                                    &handle,
                                    &ServerMsg::NeedsAttention {
                                        agent_id: id,
                                        reason: format!("silent {}s (limit {}s)", silent, meta.idle_secs),
                                    },
                                );
                            } else if silent < 5 && meta.hang_notified {
                                state.agents.set_hang_notified(&id, false);
                            }
                        }
                    }

                    // Schedule pass (every 15th tick): run due automations.
                    if tick_n.is_multiple_of(15) {
                        match state.store.automations_due() {
                            Ok(rows) => {
                                for row in rows {
                                    if let Err(e) = run_automation_row(&handle, &state, row) {
                                        emit_control(&handle, &ServerMsg::Error {
                                            agent_id: None,
                                            message: e,
                                        });
                                    }
                                }
                            }
                            Err(e) => {
                                emit_control(&handle, &ServerMsg::Error {
                                    agent_id: None,
                                    message: e.to_string(),
                                });
                            }
                        }
                        // Loops pass: interval loops due + 'match' loops
                        // edge-detected on the PTY tail.
                        if let Ok(rows) = state.store.loops_interval_due() {
                            for row in &rows {
                                fire_loop(&handle, &state, row);
                            }
                        }
                        if let Ok(rows) = state.store.loops_enabled() {
                            for row in &rows {
                                if row.4 != "match" {
                                    continue;
                                }
                                let Some(pat) = row.6.as_deref() else { continue };
                                if pat.is_empty() { continue; }
                                for id in loop_targets(&state, &row.1, &row.2) {
                                    let key = format!("{}:{}", row.0, id);
                                    let hit = state
                                        .agents
                                        .tail_text(&id)
                                        .map(|t| t.contains(pat))
                                        .unwrap_or(false);
                                    if hit && !match_seen.get(&key).copied().unwrap_or(false) {
                                        fire_loop(&handle, &state, row);
                                    }
                                    match_seen.insert(key, hit);
                                }
                            }
                        }
                    }

                    // Derived statuses.
                    for (id, status) in state.agents.statuses() {
                        if last.get(&id) != Some(&status) {
                            let prev = last.get(&id).copied();
                            last.insert(id.clone(), status);
                            // 'idle' loops: working→quiet transition gets
                            // the next instruction.
                            if prev == Some("working") && status == "idle" {
                                if let Ok(rows) = state.store.loops_enabled() {
                                    for row in rows.iter().filter(|r| {
                                        r.4 == "idle" && (r.2 == id || r.2 == "*")
                                    }) {
                                        if row.2 == "*"
                                            && !loop_targets(&state, &row.1, "*").contains(&id)
                                        {
                                            continue;
                                        }
                                        fire_loop(&handle, &state, row);
                                    }
                                }
                            }
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
            create_board,
            create_account,
            delete_account,
            rename_node,
            rename_board,
            delete_board,
            delete_workspace,
            memory_read,
            memory_write,
            session_digest,
            note_upsert,
            note_delete,
            artifact_create,
            artifact_delete,
            git_push,
            studio_doc,
            vault_list,
            vault_search,
            vault_read,
            vault_peek,
            vault_asset,
            vault_append,
            vault_write,
            vault_delete,
            vault_rename,
            vault_graph,
            vault_discover,
            vault_register,
            default_vault_dir,
            create_workspace,
            move_to_board,
            delegate,
            pty_input,
            approve_input,
            deny_input,
            set_permission,
            pty_resize,
            confirm_destructive,
            move_node,
            create_automation,
            create_loop,
            delete_loop,
            delete_delegation,
            run_loop,
            set_loop_enabled,
            pause_all,
            resume_all,
            run_automation,
            delete_automation,
            transcript,
            diff_detail,
            snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running canvas");
}
