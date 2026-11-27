//! Canvas — Tauri shell.
//!
//! Same frontend as the web client, same core as canvasd: the Tauri app
//! replaces the WebSocket transport with native commands + events.
//! Control events → `canvas://control` (the same ServerMsg JSON as the WS
//! protocol); PTY output → `canvas://pty` { agent_id, data(base64) }.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use canvasd::agent::{
    canvas_result_line, dirty_diff, dirty_file_count, dirty_files, worktree_branch, AgentManager,
};
use canvasd::orchestrate::{
    DelegateParams, InputDisposition, Orchestrator, SpawnParams, TaskSpawner,
};
use canvasd::protocol::{AgentStatus, ServerMsg, SnapshotAutomation};
use canvasd::store::Store;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::broadcast;
use tracing::warn;

/// Published artifacts: share id → (title, mime, bytes). Same shape as the
/// daemon's — one contract, two serving runtimes.
type ShareMap = Arc<Mutex<HashMap<String, (String, String, Vec<u8>)>>>;

struct CanvasState {
    agents: Arc<AgentManager>,
    store: Arc<Store>,
    repo_root: PathBuf,
    // Arc'd like the daemon's: exit-watcher and input-injection tasks
    // outlive the spawning call, so they clone these instead of borrowing
    // the managed state.
    pending_results: Arc<Mutex<HashMap<String, String>>>, // agent_id → edge_id
    pending_inputs: Arc<Mutex<HashMap<String, Vec<u8>>>>, // agent_id → held PTY input
    /// agent_id → chain-retry state: a fresh PTY dying within seconds
    /// respawns as the next fallback CLI instead of dying silently.
    pending_fallbacks: Arc<Mutex<HashMap<String, canvasd::orchestrate::FallbackState>>>,
    /// Canonicalized roots vault file operations may touch — the board repo
    /// plus user-granted vault/workspace roots. Mutex because mounting a
    /// vault from the UI appends at runtime.
    allowed_roots: Arc<Mutex<Vec<PathBuf>>>,
    /// In-memory published artifacts behind the embedded share server.
    shares: ShareMap,
    /// Port the embedded localhost server bound (share links + control WS).
    /// None when the bind failed — share_create and agent orchestration then
    /// error instead of minting dead links/dead environment variables.
    share_port: Option<u16>,
    /// Transport-independent orchestration core. The Arc fields above are
    /// shared with it; keeping them mirrored preserves the existing command
    /// code while all spawn/delegate logic lives in one place.
    orchestrator: Orchestrator,
    control_events: broadcast::Sender<ServerMsg>,
    pty_events: broadcast::Sender<(String, Vec<u8>)>,
}

fn emit_control(app: &AppHandle, msg: &ServerMsg) {
    // The control bus is the single event source: one subscription feeds the
    // webview, another feeds `/ws` clients. Before state management (or in
    // minimal tests) fall back to direct emission rather than dropping.
    if let Some(state) = app.try_state::<CanvasState>() {
        let _ = state.control_events.send(msg.clone());
    } else if let Err(e) = app.emit("canvas://control", msg) {
        warn!(error = %e, "emit control failed");
    }
}

fn emit_pty(app: &AppHandle, agent_id: &str, bytes: &[u8]) {
    if let Some(state) = app.try_state::<CanvasState>() {
        let _ = state
            .pty_events
            .send((agent_id.to_string(), bytes.to_vec()));
        return;
    }
    let payload = serde_json::json!({
        "agent_id": agent_id,
        "data": base64::engine::general_purpose::STANDARD.encode(bytes),
    });
    if let Err(e) = app.emit("canvas://pty", payload) {
        warn!(error = %e, "emit pty failed");
    }
}

/// Write PTY input through the shared orchestration core's permission gate.
/// The Tauri-shaped helper remains because loop firing and automation prompt
/// injection predate the transport-independent core.
fn gated_write(state: &CanvasState, agent_id: &str, bytes: &[u8]) -> bool {
    state.orchestrator.gated_write(agent_id, bytes)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn spawn_agent(
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
    state.orchestrator.spawn_node(SpawnParams {
        name,
        command,
        cwd,
        workspace_id,
        permission,
        board_id,
        account_id,
        initial_input,
    })
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
    emit_control(
        &app,
        &ServerMsg::BoardCreated {
            board_id: id.clone(),
            name,
        },
    );
    Ok(id)
}

#[tauri::command]
fn create_account(
    app: AppHandle,
    state: State<'_, CanvasState>,
    cli: String,
    label: String,
    env: Option<String>,
) -> Result<String, String> {
    let account_id = format!("acct-{}", &uuid_v4ish()[..8]);
    let dir = format!(".canvas/accounts/{account_id}");
    let _ = std::fs::create_dir_all(state.repo_root.join(&dir));
    state
        .store
        .account_created(&account_id, &cli, &label, &dir, env.as_deref())
        .map_err(|e| e.to_string())?;
    emit_control(
        &app,
        &ServerMsg::AccountCreated {
            account_id: account_id.clone(),
            cli,
            label,
            env,
        },
    );
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
fn studio_doc(
    app: AppHandle,
    state: State<'_, CanvasState>,
    board_id: Option<String>,
) -> Result<(), String> {
    let board = board_id.unwrap_or_else(|| "main".to_string());
    let mut md = String::from(
        "# Studio — repo dossier

",
    );
    let repo = &state.repo_root;
    md.push_str(&format!("## Tree — {}\n\n```\n", repo.display()));
    fn walk(d: &std::path::Path, depth: usize, prefix: &str, out: &mut String) {
        if depth > 2 {
            return;
        }
        let mut entries: Vec<_> = std::fs::read_dir(d)
            .map(|rd| rd.flatten().collect())
            .unwrap_or_default();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.')
                || matches!(name.as_str(), "node_modules" | "target" | "dist" | "build")
            {
                continue;
            }
            out.push_str(&format!(
                "{prefix}{name}{}\n",
                if e.path().is_dir() { "/" } else { "" }
            ));
            if e.path().is_dir() {
                walk(&e.path(), depth + 1, &format!("{prefix}  "), out);
            }
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
        if bd.as_deref().unwrap_or("main") != board {
            continue;
        }
        md.push_str(&format!(
            "- **{name}** (`{command}`) — {status}{}\n",
            acct.as_ref()
                .map(|l| format!(" · @{l}"))
                .unwrap_or_default()
        ));
    }
    let notes = state.store.all_notes().unwrap_or_default();
    let board_notes: Vec<_> = notes.iter().filter(|n| n.1 == board).collect();
    if !board_notes.is_empty() {
        md.push_str("\n## Notes\n\n");
        for (_id, _b, col, text, _pos, due) in &board_notes {
            md.push_str(&format!(
                "- [{col}] {text}{}\n",
                due.as_ref()
                    .map(|d| format!(" (due {d})"))
                    .unwrap_or_default()
            ));
        }
    }
    let arts = state.store.artifacts_snapshot().unwrap_or_default();
    let board_arts: Vec<_> = arts.iter().filter(|a| a.1 == board).collect();
    if !board_arts.is_empty() {
        md.push_str("\n## Artifacts\n\n");
        for (id, _bd, agent, kind, title, _p, _t, at) in &board_arts {
            md.push_str(&format!(
                "- `{kind}` **{title}** — {} ({at}, `{id}`)\n",
                agent.as_deref().unwrap_or("-")
            ));
        }
    }
    emit_control(&app, &ServerMsg::StudioDocMd { text: md });
    Ok(())
}

/// Image attachments Obsidian shows in the file explorer — listed beside
/// the notes so `![[img.png]]` embeds can resolve them.
fn is_vault_image(name: &str) -> bool {
    matches!(
        name.rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
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

/// Flat repository file list for the Code Editor. Repositories must already
/// be registered as workspaces; don't let a renderer-provided path grant
/// itself access to arbitrary files on the host.
fn repo_tree_entries(root: &PathBuf) -> Vec<String> {
    let mut entries = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(read_dir) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.')
                || matches!(name.as_str(), "node_modules" | "target" | "dist" | "build")
            {
                continue;
            }
            if entry
                .file_type()
                .map(|kind| kind.is_symlink())
                .unwrap_or(true)
            {
                continue;
            }
            if path.is_dir() && stack.len() + entries.len() < 6000 {
                stack.push(path);
            } else if path.is_file() {
                if let Ok(relative) = path.strip_prefix(root) {
                    entries.push(relative.to_string_lossy().to_string());
                }
            }
        }
    }
    entries.sort();
    entries
}

fn read_repo_file(root: &PathBuf, path: &str) -> Result<String, String> {
    let rel = std::path::Path::new(path);
    if rel.is_absolute()
        || rel.components().any(|c| {
            matches!(
                c,
                std::path::Component::Prefix(_)
                    | std::path::Component::RootDir
                    | std::path::Component::ParentDir
            )
        })
    {
        return Err("access denied: path escapes the repository".into());
    }
    let canonical =
        std::fs::canonicalize(root.join(rel)).map_err(|_| format!("read failed: {path}"))?;
    let root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    if !canonical.starts_with(&root) || !canonical.is_file() {
        return Err("access denied: path is outside the repository".into());
    }
    let metadata = std::fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if metadata.len() > 256 * 1024 {
        return Err(format!("file too large to view (256 KiB cap): {path}"));
    }
    let bytes = std::fs::read(&canonical).map_err(|e| e.to_string())?;
    if bytes.len() > 256 * 1024 || bytes[..bytes.len().min(8192)].contains(&0) {
        return Err(format!("binary or oversized file — not viewable: {path}"));
    }
    String::from_utf8(bytes).map_err(|_| format!("file is not UTF-8 text: {path}"))
}

fn atomic_replace_file(path: &std::path::Path, text: &str) -> Result<(), String> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    let parent = path
        .parent()
        .ok_or_else(|| "write failed: missing parent directory".to_string())?;
    let name = path
        .file_name()
        .ok_or_else(|| "write failed: missing file name".to_string())?
        .to_string_lossy();
    let permissions = std::fs::metadata(path)
        .map_err(|e| format!("write failed: {e}"))?
        .permissions();
    let mut last_error = None;
    for _ in 0..8 {
        let temp = parent.join(format!(
            ".{name}.canvas-save-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            use std::os::unix::fs::PermissionsExt;
            options.mode(permissions.mode());
        }
        match options.open(&temp) {
            Ok(mut file) => {
                let result = (|| {
                    file.write_all(text.as_bytes())
                        .map_err(|e| format!("write failed: {e}"))?;
                    file.sync_all().map_err(|e| format!("write failed: {e}"))?;
                    std::fs::set_permissions(&temp, permissions)
                        .map_err(|e| format!("write failed: {e}"))?;
                    std::fs::rename(&temp, path).map_err(|e| format!("write failed: {e}"))
                })();
                if result.is_err() {
                    let _ = std::fs::remove_file(&temp);
                }
                return result;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                last_error = Some(error)
            }
            Err(error) => return Err(format!("write failed: {error}")),
        }
    }
    Err(format!(
        "write failed: {}",
        last_error
            .map(|e| e.to_string())
            .unwrap_or_else(|| "could not allocate temporary file".into())
    ))
}

fn write_repo_file(root: &PathBuf, path: &str, text: &str, base_text: &str) -> Result<(), String> {
    if text.len() > 256 * 1024 || text.as_bytes().contains(&0) {
        return Err("file exceeds the 256 KiB text editor limit".into());
    }
    let current = read_repo_file(root, path)?;
    if current != base_text {
        return Err(format!(
            "file changed on disk; reload before saving: {path}"
        ));
    }
    let rel = std::path::Path::new(path);
    let canonical =
        std::fs::canonicalize(root.join(rel)).map_err(|_| format!("write failed: {path}"))?;
    let canonical_root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err("access denied: path is outside the repository".into());
    }
    atomic_replace_file(&canonical, text)
}

fn expand_home_path(path: &str) -> PathBuf {
    if path == "~" || path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(path.strip_prefix("~/").unwrap_or(""));
        }
    }
    PathBuf::from(path)
}

#[cfg(not(windows))]
const SANDBOX_HINT: &str = " — open the vault from the Vault panel to grant access, or add its path to ~/.config/canvas/allowed-roots (one per line)";
#[cfg(windows)]
const SANDBOX_HINT: &str = " — open the vault from the Vault panel to grant access, or add its path to %APPDATA%\\canvas\\allowed-roots (one per line)";

/// Canonicalize a path that may not fully exist yet: canonicalize the
/// deepest existing ancestor and re-append the missing tail. New vault
/// folders inside an allowed root therefore initialize fine, while a
/// missing ancestor outside every root still fails the caller's
/// allowed-roots check.
fn canon_through_missing(path: &Path) -> Option<PathBuf> {
    let mut probe = path.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if std::fs::symlink_metadata(&probe).is_ok() {
            break;
        }
        match (probe.file_name(), probe.parent()) {
            (Some(name), Some(parent)) => {
                tail.push(name.to_os_string());
                probe = parent.to_path_buf();
            }
            _ => return None,
        }
    }
    let mut resolved = std::fs::canonicalize(&probe).ok()?;
    for comp in tail.iter().rev() {
        resolved.push(comp);
    }
    Some(resolved)
}

fn root_allowed(allowed_roots: &Mutex<Vec<PathBuf>>, canon_root: &Path) -> bool {
    allowed_roots
        .lock()
        .unwrap()
        .iter()
        .any(|root| canon_root.starts_with(root))
}

fn push_allowed_root(roots: &mut Vec<PathBuf>, canon_root: PathBuf) {
    if !roots.iter().any(|root| canon_root.starts_with(root)) {
        roots.push(canon_root);
    }
}

/// Persist a newly mounted vault root in the same user-level grant file the
/// daemon uses (`allowed-roots` under Canvas's config dir). The native app
/// keeps its own in-memory copy — there is no live shared state with a
/// running canvasd — but both processes converge on the same user grants.
///
/// Unlike the daemon's legacy fallback, this deliberately never reads or
/// writes a repo-local grant file: a cloned repository must not be able to
/// grant itself access to the operator's disk.
fn persist_allowed_root(allowed_roots: &Mutex<Vec<PathBuf>>, canon_root: &Path) {
    {
        let mut roots = allowed_roots.lock().unwrap();
        if roots.iter().any(|root| canon_root.starts_with(root)) {
            return;
        }
        roots.push(canon_root.to_path_buf());
    }

    let Some(config) = canvasd::paths::canvas_config_dir() else {
        return;
    };
    // A newline in the path would smuggle extra grant lines into the config
    // on the next boot — pathological, but cheap to refuse.
    let line = canon_root.to_string_lossy().to_string();
    if line.contains('\n') || line.contains('\r') {
        return;
    }
    let list = config.join("allowed-roots");
    if let Some(parent) = list.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let prev = std::fs::read_to_string(&list).unwrap_or_default();
    if prev.lines().any(|l| l.trim() == line) {
        return;
    }
    // Append rather than rewrite the whole file: canvasd may be holding the
    // same user-level grant list, and a read/modify/write race must not drop
    // a grant the daemon just appended. Duplicate lines are harmless.
    use std::io::Write;
    let mut addition = String::new();
    if !prev.is_empty() && !prev.ends_with('\n') {
        addition.push('\n');
    }
    addition.push_str(&line);
    addition.push('\n');
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&list)
    {
        let _ = file.write_all(addition.as_bytes());
    }
}

/// Initial sandbox roots: the board repo, operator-written lines in the
/// user-level `allowed-roots` file, and repos already registered as
/// workspaces (those were explicit operator gestures when created).
fn initial_allowed_roots(repo_root: &Path, store: &Store) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(canon) = std::fs::canonicalize(repo_root) {
        push_allowed_root(&mut roots, canon);
    }
    if let Some(list) = canvasd::paths::canvas_config_dir().map(|dir| dir.join("allowed-roots")) {
        if let Ok(text) = std::fs::read_to_string(&list) {
            for line in text.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                let expanded = canvasd::paths::expand_tilde(line);
                if let Ok(canon) = std::fs::canonicalize(&expanded) {
                    push_allowed_root(&mut roots, canon);
                }
            }
        }
    }
    if let Ok(workspaces) = store.workspaces_snapshot() {
        for (_, _, repo, _) in workspaces {
            let expanded = canvasd::paths::expand_tilde(&repo);
            if let Some(canon) = canon_through_missing(&expanded) {
                push_allowed_root(&mut roots, canon);
            }
        }
    }
    roots
}

/// Deska-style sandbox: every vault path is validated in the native shell,
/// never trusted from the renderer.
///
/// - `path` must be relative — an absolute path would make `root.join`
///   REPLACE the root, escaping the vault entirely.
/// - no `..`/root/prefix components — no traversal above the root.
/// - the canonicalized vault root must sit inside an allowed root.
/// - the target, canonicalized through its deepest existing ancestor,
///   must stay inside the canonical root — kills symlink escapes, which
///   the naive `!path.contains("..")` checks never saw.
fn vault_sandbox_resolve(
    allowed_roots: &Mutex<Vec<PathBuf>>,
    dir: &str,
    path: &str,
) -> Result<PathBuf, String> {
    let rel = Path::new(path);
    if rel.is_absolute() {
        return Err("access denied: absolute paths are not allowed".into());
    }
    // Reject roots/prefixes component-wise too, not just `..`: on Windows
    // `\foo` carries a RootDir without being `is_absolute` (no drive
    // prefix), and `C:` is a drive-relative Prefix — both would bend the
    // probe away from the vault root before the final containment check
    // caught them.
    if rel.components().any(|c| {
        matches!(
            c,
            std::path::Component::Prefix(_)
                | std::path::Component::RootDir
                | std::path::Component::ParentDir
        )
    }) {
        return Err("access denied: path escapes the vault".into());
    }
    let canon_root = canon_through_missing(Path::new(dir))
        .ok_or_else(|| format!("access denied: vault root not found: {dir}"))?;
    if !root_allowed(allowed_roots, &canon_root) {
        return Err(format!(
            "access denied: path is outside allowed directories{SANDBOX_HINT}"
        ));
    }
    // Walk the components that exist: any symlink in the chain must resolve
    // inside the vault. `symlink_metadata` (lstat) sees dangling links that
    // `exists()` misses — a dangling symlink is never a legitimate write
    // target, because the write would follow it and create the file wherever
    // it points.
    let mut probe = canon_root.clone();
    for comp in rel.components() {
        probe.push(comp.as_os_str());
        if let Ok(meta) = std::fs::symlink_metadata(&probe) {
            if meta.file_type().is_symlink() {
                match std::fs::canonicalize(&probe) {
                    Ok(canon) if canon.starts_with(&canon_root) => {
                        probe = canon;
                    }
                    // Dangling or escaping link — refuse outright.
                    _ => return Err("access denied: path is outside allowed directories".into()),
                }
            }
        }
    }
    if !probe.starts_with(&canon_root) {
        return Err("access denied: path is outside allowed directories".into());
    }
    Ok(probe)
}

fn vault_sandbox_dir(allowed_roots: &Mutex<Vec<PathBuf>>, dir: &str) -> Result<PathBuf, String> {
    let canon_root = canon_through_missing(Path::new(dir))
        .ok_or_else(|| format!("access denied: vault root not found: {dir}"))?;
    if root_allowed(allowed_roots, &canon_root) {
        Ok(canon_root)
    } else {
        Err(format!(
            "access denied: path is outside allowed directories{SANDBOX_HINT}"
        ))
    }
}

fn resolve_registered_repo_dir(dir: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let requested_path = expand_home_path(dir);
    for root_path in roots {
        let Ok(root) = std::fs::canonicalize(root_path) else {
            continue;
        };
        let candidate = if requested_path.is_absolute() {
            requested_path.clone()
        } else {
            root.join(&requested_path)
        };
        let Ok(requested) = std::fs::canonicalize(candidate) else {
            continue;
        };
        if requested.starts_with(&root) && requested.is_dir() {
            return Ok(requested);
        }
    }
    Err(format!(
        "access denied: repository is not registered or not found: {dir}"
    ))
}

fn registered_repo_root(state: &CanvasState, dir: &str) -> Result<PathBuf, String> {
    let mut registered = vec![state.repo_root.clone()];
    let workspaces = state
        .store
        .workspaces_snapshot()
        .map_err(|e| e.to_string())?;
    registered.extend(
        workspaces
            .into_iter()
            .map(|(_, _, repo, _)| expand_home_path(&repo)),
    );
    // Restored snapshots can carry a repository-relative worktree such as
    // `.canvas-worktrees/<id>`. Resolve it against each registered workspace,
    // then canonicalize before checking containment so symlinks cannot escape.
    resolve_registered_repo_dir(dir, &registered)
}

#[tauri::command]
fn repo_tree(app: AppHandle, state: State<'_, CanvasState>, dir: String) -> Result<(), String> {
    let root = match registered_repo_root(state.inner(), &dir) {
        Ok(root) => root,
        Err(message) => {
            emit_control(
                &app,
                &ServerMsg::Error {
                    agent_id: None,
                    message,
                },
            );
            return Ok(());
        }
    };
    let mut entries = repo_tree_entries(&root);
    entries.truncate(4000);
    emit_control(&app, &ServerMsg::RepoListing { dir, entries });
    Ok(())
}

#[tauri::command]
fn repo_read(
    app: AppHandle,
    state: State<'_, CanvasState>,
    dir: String,
    path: String,
) -> Result<(), String> {
    let result =
        registered_repo_root(state.inner(), &dir).and_then(|root| read_repo_file(&root, &path));
    let text = match result {
        Ok(text) => text,
        Err(message) => {
            emit_control(
                &app,
                &ServerMsg::Error {
                    agent_id: None,
                    message,
                },
            );
            return Ok(());
        }
    };
    emit_control(&app, &ServerMsg::RepoFile { dir, path, text });
    Ok(())
}

#[tauri::command]
fn repo_write(
    app: AppHandle,
    state: State<'_, CanvasState>,
    dir: String,
    path: String,
    text: String,
    base_text: String,
) -> Result<(), String> {
    let result = registered_repo_root(state.inner(), &dir)
        .and_then(|root| write_repo_file(&root, &path, &text, &base_text));
    if let Err(message) = result {
        emit_control(
            &app,
            &ServerMsg::Error {
                agent_id: None,
                message,
            },
        );
        return Ok(());
    }
    emit_control(&app, &ServerMsg::RepoFile { dir, path, text });
    Ok(())
}

#[cfg(test)]
mod repo_explorer_tests {
    use super::{
        expand_home_path, read_repo_file, repo_tree_entries, resolve_registered_repo_dir,
        uri_component, write_repo_file,
    };
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

    fn temp_root() -> PathBuf {
        loop {
            let root = std::env::temp_dir().join(format!(
                "canvas-repo-explorer-{}-{}",
                std::process::id(),
                NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
            ));
            match std::fs::create_dir(&root) {
                Ok(()) => return root,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => panic!("could not create test repo: {e}"),
            }
        }
    }

    #[test]
    fn lists_source_files_and_skips_hidden_and_dependency_directories() {
        let root = temp_root();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join("src/main.ts"), "export {};").unwrap();
        std::fs::write(root.join("node_modules/pkg/index.js"), "ignored").unwrap();
        std::fs::write(root.join(".git/config"), "ignored").unwrap();

        assert_eq!(repo_tree_entries(&root), vec!["src/main.ts"]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_text_but_rejects_traversal_binary_and_oversized_files() {
        let root = temp_root();
        std::fs::write(root.join("README.md"), "hello").unwrap();
        std::fs::write(root.join("binary.dat"), [0, 1, 2]).unwrap();
        std::fs::write(root.join("large.txt"), vec![b'x'; 256 * 1024 + 1]).unwrap();

        assert_eq!(read_repo_file(&root, "README.md").unwrap(), "hello");
        assert!(read_repo_file(&root, "../outside")
            .unwrap_err()
            .contains("access denied"));
        assert!(read_repo_file(&root, "binary.dat")
            .unwrap_err()
            .contains("binary"));
        assert!(read_repo_file(&root, "large.txt")
            .unwrap_err()
            .contains("too large"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn writes_existing_repo_text_and_rejects_stale_drafts_and_traversal() {
        let root = temp_root();
        std::fs::write(root.join("README.md"), "before").unwrap();
        write_repo_file(&root, "README.md", "after", "before").unwrap();
        assert_eq!(read_repo_file(&root, "README.md").unwrap(), "after");
        assert!(write_repo_file(&root, "README.md", "clobber", "before")
            .unwrap_err()
            .contains("changed on disk"));
        assert!(write_repo_file(&root, "../outside", "x", "")
            .unwrap_err()
            .contains("access denied"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_invalid_utf8_without_changing_original_bytes() {
        let root = temp_root();
        let original = [0x66, 0x80, 0x6f];
        std::fs::write(root.join("README.md"), original).unwrap();
        assert!(read_repo_file(&root, "README.md")
            .unwrap_err()
            .contains("UTF-8"));
        assert!(write_repo_file(&root, "README.md", "replacement", "foo").is_err());
        assert_eq!(std::fs::read(root.join("README.md")).unwrap(), original);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn expands_home_workspace_paths_and_keeps_relative_paths_relative() {
        let home = std::env::var("HOME").unwrap();
        assert_eq!(
            expand_home_path("~/projects/demo"),
            PathBuf::from(home).join("projects/demo")
        );
        assert_eq!(
            expand_home_path("relative/worktree"),
            PathBuf::from("relative/worktree")
        );
    }

    #[test]
    fn repo_root_prefers_canvas_repo_then_board_cwd_then_user_default() {
        use super::pick_repo_root;
        let home = PathBuf::from("/home/tester");

        // CANVAS_REPO always wins — even over a board-looking cwd.
        let cwd = temp_root();
        std::fs::create_dir(cwd.join(".git")).unwrap();
        assert_eq!(
            pick_repo_root(Some("/elsewhere/board"), &cwd, &home),
            PathBuf::from("/elsewhere/board")
        );
        // Blank values count as unset.
        assert_eq!(pick_repo_root(Some("  "), &cwd, &home), cwd);

        // A cwd with board evidence (.git or .canvas) stays the cwd, as the
        // daemon always did for terminal launches.
        std::fs::remove_dir_all(cwd.join(".git")).unwrap();
        std::fs::create_dir(cwd.join(".canvas")).unwrap();
        assert_eq!(pick_repo_root(None, &cwd, &home), cwd);
        std::fs::remove_dir_all(cwd).unwrap();

        // Finder/launchd launches (cwd is the filesystem root) and random
        // folders fall to the per-user default — the launch crash this
        // resolution order prevents.
        assert_eq!(
            pick_repo_root(None, Path::new("/"), &home),
            home.join("Canvas")
        );
        assert_eq!(
            pick_repo_root(None, Path::new("/usr/local/bin"), &home),
            home.join("Canvas")
        );
    }

    #[test]
    fn obsidian_uri_components_encode_spaces_unicode_and_query_delimiters() {
        assert_eq!(
            uri_component("Team Notes/visión & plan"),
            "Team%20Notes%2Fvisi%C3%B3n%20%26%20plan"
        );
    }

    #[test]
    fn resolves_relative_worktrees_only_inside_registered_roots() {
        let root = temp_root();
        let worktree = root.join(".canvas-worktrees/agent-1");
        std::fs::create_dir_all(&worktree).unwrap();
        std::fs::write(worktree.join("README.md"), "worktree").unwrap();

        let canonical_root = std::fs::canonicalize(&root).unwrap();
        let candidate =
            resolve_registered_repo_dir(".canvas-worktrees/agent-1", std::slice::from_ref(&root))
                .unwrap();
        assert!(candidate.starts_with(&canonical_root));
        assert!(candidate.is_dir());
        assert!(resolve_registered_repo_dir("../", std::slice::from_ref(&root)).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_that_escape_the_repository() {
        let root = temp_root();
        let outside = temp_root();
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("secret.txt")).unwrap();

        assert!(read_repo_file(&root, "secret.txt")
            .unwrap_err()
            .contains("access denied"));
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(outside).unwrap();
    }
}

fn vault_links(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("[[") {
        let inner = &rest[start + 2..];
        let Some(end) = inner.find("]]") else { break };
        let name = inner[..end].split('|').next().unwrap_or("").trim();
        if !name.is_empty() {
            out.push(name.to_string());
        }
        rest = &inner[end + 2..];
    }
    let mut rest = text;
    while let Some(pos) = rest.find("](") {
        let inner = &rest[pos + 2..];
        let Some(end) = inner.find(')') else { break };
        let target = inner[..end].trim();
        if target.ends_with(".md") {
            out.push(target.to_string());
        }
        rest = &inner[end..];
    }
    out
}

/// Default vault to auto-mount on first run: ~/Documents/Orkelya-Memory
/// when it exists, else ~/Documents, else the home dir.
#[tauri::command]
fn default_vault_dir() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    [
        format!("{home}/Documents/Orkelya-Memory"),
        format!("{home}/Documents"),
        home,
    ]
    .into_iter()
    .find(|cand| PathBuf::from(cand.as_str()).is_dir())
}

#[tauri::command]
fn vault_discover(app: AppHandle) -> Result<(), String> {
    emit_control(
        &app,
        &ServerMsg::VaultDiscovered {
            vaults: canvasd::vault::discover(),
        },
    );
    Ok(())
}

#[tauri::command]
fn vault_register(
    app: AppHandle,
    state: State<'_, CanvasState>,
    dir: String,
) -> Result<(), String> {
    // Registration creates `.obsidian` inside the target folder, so it is a
    // filesystem write and must not become a way to write into an ungranted
    // directory. The Vault panel mount gesture (`vault_list`) is what grants
    // the root; this command only registers an already-mounted vault.
    let root = vault_sandbox_dir(&state.allowed_roots, &dir)?;
    let root = root.to_string_lossy().to_string();
    let vaults = canvasd::vault::register(&root)?;
    emit_control(&app, &ServerMsg::VaultDiscovered { vaults });
    Ok(())
}

fn uri_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.~".contains(byte) {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[tauri::command]
fn open_obsidian(
    state: State<'_, CanvasState>,
    vault_dir: String,
    path: String,
) -> Result<(), String> {
    let root = vault_sandbox_dir(&state.allowed_roots, &vault_dir)
        .map_err(|_| "Obsidian vault folder is unavailable or not mounted".to_string())?;
    if !root.is_dir() {
        return Err("Obsidian vault folder is unavailable".into());
    }
    if !path.trim().is_empty() {
        let target = vault_sandbox_resolve(&state.allowed_roots, &vault_dir, &path)?;
        if !target.is_file() {
            return Err("note path must stay inside the selected vault".into());
        }
    }
    let vault_name = root
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| "could not determine the Obsidian vault name".to_string())?;
    let mut uri = format!("obsidian://open?vault={}", uri_component(vault_name));
    if !path.trim().is_empty() {
        let file = path.strip_suffix(".md").unwrap_or(&path);
        uri.push_str(&format!("&file={}", uri_component(file)));
    }

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&uri).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer.exe").arg(&uri).spawn();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&uri).spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let result: std::io::Result<std::process::Child> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "opening Obsidian links is unsupported on this platform",
    ));
    result
        .map(|_| ())
        .map_err(|e| format!("could not open Obsidian: {e}"))
}

/// Emit a vault listing after treating the list request as the Vault panel's
/// mount gesture. This mirrors canvasd: opening a directory in the panel is
/// what grants that canonical root to the sandbox and persists the grant in
/// the user-level `allowed-roots` file.
fn emit_vault_listing(app: &AppHandle, state: &CanvasState, dir: String) {
    if let Some(canon) = canon_through_missing(Path::new(&dir)) {
        if !root_allowed(&state.allowed_roots, &canon) {
            persist_allowed_root(&state.allowed_roots, &canon);
        }
    }
    match vault_sandbox_dir(&state.allowed_roots, &dir) {
        Ok(root) => {
            let mut entries = vault_list_entries(&root);
            entries.truncate(2000);
            emit_control(app, &ServerMsg::VaultListing { dir, entries });
        }
        Err(message) => emit_control(
            app,
            &ServerMsg::Error {
                agent_id: None,
                message,
            },
        ),
    }
}

#[tauri::command]
fn vault_list(app: AppHandle, state: State<'_, CanvasState>, dir: String) -> Result<(), String> {
    emit_vault_listing(&app, state.inner(), dir);
    Ok(())
}

#[tauri::command]
fn vault_graph(app: AppHandle, state: State<'_, CanvasState>, dir: String) -> Result<(), String> {
    let root = match vault_sandbox_dir(&state.allowed_roots, &dir) {
        Ok(root) => root,
        Err(message) => {
            emit_control(
                &app,
                &ServerMsg::Error {
                    agent_id: None,
                    message,
                },
            );
            return Ok(());
        }
    };
    let nodes = vault_list_entries(&root);
    let resolve = |name: &str| -> Option<String> {
        let n = name.trim();
        nodes
            .iter()
            .find(|e| {
                e.as_str() == n
                    || **e == format!("{n}.md")
                    || e.ends_with(&format!("/{n}.md"))
                    || e.trim_end_matches(".md") == n
            })
            .cloned()
    };
    let mut edges: Vec<(String, String)> = Vec::new();
    for e in &nodes {
        if let Ok(text) = std::fs::read_to_string(root.join(e)) {
            for name in vault_links(&text) {
                if let Some(t) = resolve(&name) {
                    if t != *e {
                        edges.push((e.clone(), t));
                    }
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
fn vault_search(
    app: AppHandle,
    state: State<'_, CanvasState>,
    dir: String,
    query: String,
) -> Result<(), String> {
    let root = match vault_sandbox_dir(&state.allowed_roots, &dir) {
        Ok(root) => root,
        Err(message) => {
            emit_control(
                &app,
                &ServerMsg::Error {
                    agent_id: None,
                    message,
                },
            );
            return Ok(());
        }
    };
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
fn vault_read(
    app: AppHandle,
    state: State<'_, CanvasState>,
    dir: String,
    path: String,
) -> Result<(), String> {
    if !path.ends_with(".md") {
        return Err("not a markdown file in the vault".into());
    }
    let file = vault_sandbox_resolve(&state.allowed_roots, &dir, &path)?;
    if !file.is_file() {
        return Err("not a markdown file in the vault".into());
    }
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::VaultFile { path, text });
    Ok(())
}

/// Read a vault file without making it the open note — powers `![[embeds]]`.
#[tauri::command]
fn vault_peek(
    app: AppHandle,
    state: State<'_, CanvasState>,
    dir: String,
    path: String,
) -> Result<(), String> {
    if !path.ends_with(".md") {
        return Err("not a markdown file in the vault".into());
    }
    let file = vault_sandbox_resolve(&state.allowed_roots, &dir, &path)?;
    if !file.is_file() {
        return Err("not a markdown file in the vault".into());
    }
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::VaultPeeked { path, text });
    Ok(())
}

/// Read a binary vault asset (image) as base64 — powers `![[image.png]]`.
#[tauri::command]
fn vault_asset(
    app: AppHandle,
    state: State<'_, CanvasState>,
    dir: String,
    path: String,
) -> Result<(), String> {
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
    let file = vault_sandbox_resolve(&state.allowed_roots, &dir, &path)?;
    if !file.is_file() {
        return Err("not a file in the vault".into());
    }
    if std::fs::metadata(&file)
        .map(|m| m.len() > 8 * 1024 * 1024)
        .unwrap_or(false)
    {
        return Err("asset too large".into());
    }
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("asset too large".into());
    }
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    emit_control(
        &app,
        &ServerMsg::VaultAssetData {
            path,
            mime: mime.to_string(),
            data,
        },
    );
    Ok(())
}

#[tauri::command]
fn vault_append(
    app: AppHandle,
    state: State<'_, CanvasState>,
    dir: String,
    path: String,
    text: String,
) -> Result<(), String> {
    if !path.ends_with(".md") {
        return Err("vault append refused".into());
    }
    let file = vault_sandbox_resolve(&state.allowed_roots, &dir, &path)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .map_err(|e| e.to_string())?;
    writeln!(f, "{text}").map_err(|e| e.to_string())?;
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::VaultFile { path, text });
    Ok(())
}

#[tauri::command]
fn vault_delete(
    app: AppHandle,
    state: State<'_, CanvasState>,
    dir: String,
    path: String,
) -> Result<(), String> {
    if !path.ends_with(".md") {
        return Err("vault delete refused".into());
    }
    let file = vault_sandbox_resolve(&state.allowed_roots, &dir, &path)?;
    let root = vault_sandbox_dir(&state.allowed_roots, &dir)?;
    if !file.is_file() {
        return Err("vault delete refused".into());
    }
    // Obsidian-style trash: move to <vault>/.trash/, recoverable always.
    // A `.trash` symlink would move notes outside the vault — refuse the
    // delete rather than follow it.
    let trash = root.join(".trash");
    if std::fs::symlink_metadata(&trash)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("vault delete refused: .trash is a symlink".into());
    }
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
    emit_vault_listing(&app, state.inner(), dir);
    Ok(())
}

#[tauri::command]
fn vault_rename(
    app: AppHandle,
    state: State<'_, CanvasState>,
    dir: String,
    path: String,
    new_path: String,
) -> Result<(), String> {
    if !path.ends_with(".md") || !new_path.ends_with(".md") {
        return Err("vault rename refused".into());
    }
    let from = vault_sandbox_resolve(&state.allowed_roots, &dir, &path)?;
    let to = vault_sandbox_resolve(&state.allowed_roots, &dir, &new_path)?;
    if !from.is_file() {
        return Err("vault rename refused".into());
    }
    // Never clobber: the resolved destination is canonical, so renaming onto
    // an in-vault symlink would overwrite the LINKED file's contents, not the
    // link.
    if to.exists() {
        return Err(format!("vault rename refused: {new_path} already exists"));
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
    let text = std::fs::read_to_string(&to).map_err(|e| e.to_string())?;
    emit_control(
        &app,
        &ServerMsg::VaultFile {
            path: new_path,
            text,
        },
    );
    emit_vault_listing(&app, state.inner(), dir);
    Ok(())
}

#[tauri::command]
fn vault_write(
    app: AppHandle,
    state: State<'_, CanvasState>,
    dir: String,
    path: String,
    text: String,
) -> Result<(), String> {
    if !path.ends_with(".md") {
        return Err("vault write refused".into());
    }
    let file = vault_sandbox_resolve(&state.allowed_roots, &dir, &path)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&file, &text).map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::VaultFile { path, text });
    Ok(())
}

/// Sandbox and write a base64-encoded vault asset. Split from the Tauri
/// command so the traversal/symlink/dedupe behavior is directly unit-testable
/// without constructing an AppHandle.
fn write_vault_asset_sandboxed(
    allowed_roots: &Mutex<Vec<PathBuf>>,
    dir: &str,
    path: &str,
    data: &str,
) -> Result<(), String> {
    if dir.is_empty() {
        return Err("vault write-asset refused: no vault dir".into());
    }
    if path.is_empty() || path.ends_with('/') {
        return Err(format!("vault write-asset refused: {path}"));
    }
    // Assets obey the exact same sandbox as every other vault operation: the
    // destination is resolved through the canonical, allowed vault root before
    // any directory is created or byte is written. In particular
    // `root.join(path)` must never see the renderer-supplied path directly — an
    // absolute path would replace the root, and an intermediate symlink could
    // point outside it.
    let file = vault_sandbox_resolve(allowed_roots, dir, path)?;
    let root = vault_sandbox_dir(allowed_roots, dir)?;
    if file == root {
        // Unlike markdown writes, assets have no extension gate. `.` (or a
        // link back to the vault root) resolves to the root directory itself;
        // treating that as a file would make the dedupe parent the vault's
        // PARENT and invent names like `vault-2` outside the sandbox.
        return Err(format!("vault write-asset refused: {path}"));
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("vault asset too large".into());
    }

    // Never clobber: foo.png → foo-2.png. Open with create_new (O_EXCL) per
    // candidate — atomic, so concurrent drops can't race a check-then-write
    // into an overwrite, and a dangling symlink fails EEXIST instead of being
    // written through.
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let stem = file
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = file
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let parent = file.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let mut wrote = false;
    for cand in std::iter::once(file.clone())
        .chain((2..100).map(|i| parent.join(format!("{stem}-{i}{ext}"))))
    {
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&cand)
        {
            Ok(f) => {
                // Reserve the name atomically, write the bytes to a sibling tmp
                // file, then rename over the reservation — a failed write never
                // leaves a truncated final file.
                drop(f);
                let tmp = cand.parent().unwrap_or(&root).join(format!(
                    ".{}.tmp-{}",
                    cand.file_name().unwrap_or_default().to_string_lossy(),
                    std::process::id(),
                ));
                // create_new on the tmp too — a vault file that happens to
                // share the tmp name must never be truncated; cleanup only
                // removes files we made.
                let outcome = match std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&tmp)
                {
                    Ok(mut f) => {
                        let r = std::io::Write::write_all(&mut f, &bytes);
                        drop(f);
                        r.and_then(|()| std::fs::rename(&tmp, &cand))
                            .inspect_err(|_| {
                                let _ = std::fs::remove_file(&tmp);
                            })
                    }
                    Err(e) => Err(e), // preexisting tmp — never touch it
                };
                if let Err(e) = outcome {
                    let _ = std::fs::remove_file(&cand); // our empty reservation
                    return Err(e.to_string());
                }
                wrote = true;
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    if !wrote {
        return Err(format!("no free name for {path}"));
    }
    Ok(())
}

#[tauri::command]
fn vault_write_asset(
    app: AppHandle,
    state: State<'_, CanvasState>,
    dir: String,
    path: String,
    data: String,
) -> Result<(), String> {
    write_vault_asset_sandboxed(&state.allowed_roots, &dir, &path, &data)?;
    emit_vault_listing(&app, state.inner(), dir);
    Ok(())
}

#[cfg(test)]
mod vault_write_asset_sandbox_tests {
    use super::write_vault_asset_sandboxed;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    struct Fixture {
        allowed_roots: Mutex<Vec<PathBuf>>,
        vault: PathBuf,
        tmp: tempfile::TempDir,
    }

    /// A vault two levels below the temp root: `../../etc/passwd` from it
    /// lands at `<tmp>/etc/passwd`, so a vulnerable write is observable
    /// without ever touching the host's real `/etc`.
    fn fixture(allow_vault: bool) -> Fixture {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let vault = tmp.path().join("sandbox").join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        let mut roots = vec![std::fs::canonicalize(repo).unwrap()];
        if allow_vault {
            roots.push(std::fs::canonicalize(&vault).unwrap());
        }
        Fixture {
            allowed_roots: Mutex::new(roots),
            vault,
            tmp,
        }
    }

    /// `cG5n` is the base64 for the bytes `png`; using one payload keeps the
    /// filesystem assertions focused on path handling rather than encoding.
    fn write_asset(fixture: &Fixture, path: &str) -> Result<(), String> {
        let dir = fixture.vault.to_string_lossy().to_string();
        write_vault_asset_sandboxed(&fixture.allowed_roots, &dir, path, "cG5n")
    }

    fn assert_access_denied(result: Result<(), String>, needle: &str) {
        let error = result.expect_err("the sandboxed write should have been refused");
        assert!(
            error.contains(needle),
            "expected an access-denied error containing {needle:?}; got {error:?}"
        );
    }

    #[test]
    fn rejects_parent_traversal_before_creating_anything() {
        let fixture = fixture(true);
        let result = write_asset(&fixture, "../../etc/passwd");
        assert_access_denied(result, "path escapes the vault");
        assert!(
            !fixture.tmp.path().join("etc").join("passwd").exists(),
            "parent traversal must not create a file outside the vault"
        );
    }

    #[test]
    fn rejects_absolute_paths_even_inside_the_scratch_area() {
        let fixture = fixture(true);
        let target = fixture.tmp.path().join("outside").join("absolute.png");
        let absolute = target.to_string_lossy().to_string();
        let result = write_asset(&fixture, &absolute);
        assert_access_denied(result, "absolute paths are not allowed");
        assert!(
            !target.exists(),
            "an absolute target outside the vault must not be written"
        );
    }

    #[test]
    fn rejects_the_vault_root_itself_as_a_file_target() {
        let fixture = fixture(true);
        let sibling_escape = fixture.vault.parent().unwrap().join("vault-2");
        let error = write_asset(&fixture, ".").expect_err("the vault root is not a file target");
        assert!(
            error.contains("vault write-asset refused"),
            "expected the root target to be refused; got {error:?}"
        );
        assert!(
            !sibling_escape.exists(),
            "dedupe must never invent a sibling outside the vault root"
        );
    }

    #[cfg(unix)]
    fn symlink_dir(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[cfg(windows)]
    fn symlink_dir(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_dir(target, link)
    }

    #[cfg(not(any(unix, windows)))]
    fn symlink_dir(_target: &Path, _link: &Path) -> std::io::Result<()> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "directory symlinks are unsupported on this platform",
        ))
    }

    #[test]
    fn rejects_symlinked_directories_that_escape_the_vault() {
        let fixture = fixture(true);
        let outside = fixture.tmp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        let link = fixture.vault.join("linked");
        if let Err(e) = symlink_dir(&outside, &link) {
            // Windows may require Developer Mode or elevation for symlink
            // creation. That does not weaken coverage where symlinks exist;
            // it only keeps the portable test suite runnable in restricted CI.
            assert!(
                matches!(
                    e.kind(),
                    std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::Unsupported
                ),
                "test symlink setup failed unexpectedly: {e}"
            );
            eprintln!("skipping symlink assertion: {e}");
            return;
        }

        let result = write_asset(&fixture, "linked/escape.png");
        assert_access_denied(result, "outside allowed directories");
        assert!(
            !outside.join("escape.png").exists(),
            "a symlinked directory must not carry the write outside the vault"
        );

        // A link back to the vault root is containment-valid as a path, but it
        // is not a file target: without a root-target guard the dedupe step
        // would look for `vault-2` beside the vault, outside the sandbox.
        let root_link = fixture.vault.join("root-link");
        symlink_dir(&fixture.vault, &root_link).unwrap();
        let error = write_asset(&fixture, "root-link")
            .expect_err("a symlink resolving to the vault root must be refused as a file target");
        assert!(
            error.contains("vault write-asset refused"),
            "expected a root-resolving symlink to be refused; got {error:?}"
        );
        assert!(
            !fixture.vault.parent().unwrap().join("vault-2").exists(),
            "root-resolving symlink must not create a sibling outside the vault"
        );
    }

    #[test]
    fn rejects_a_vault_root_that_was_never_granted() {
        let fixture = fixture(false);
        let result = write_asset(&fixture, "pic.png");
        assert_access_denied(result, "outside allowed directories");
        assert!(
            !fixture.vault.join("pic.png").exists(),
            "an ungranted vault root must not become writable just because it exists"
        );
    }

    #[test]
    fn legitimate_nested_write_still_lands_in_the_vault_and_dedupes() {
        let fixture = fixture(true);
        write_asset(&fixture, "attachments/pic.png").unwrap();
        assert_eq!(
            std::fs::read(fixture.vault.join("attachments").join("pic.png")).unwrap(),
            b"png"
        );

        write_asset(&fixture, "attachments/pic.png").unwrap();
        assert_eq!(
            std::fs::read(fixture.vault.join("attachments").join("pic-2.png")).unwrap(),
            b"png"
        );
        assert_eq!(
            std::fs::read(fixture.vault.join("attachments").join("pic.png")).unwrap(),
            b"png",
            "the original file must never be clobbered"
        );
    }
}

#[tauri::command]
fn git_push(app: AppHandle, state: State<'_, CanvasState>, agent_id: String) -> Result<(), String> {
    let wt = state
        .store
        .agent_worktree(&agent_id)
        .map_err(|e| e.to_string())?
        .map(|w| {
            state
                .store
                .agent_repo(&agent_id)
                .ok()
                .flatten()
                .map(PathBuf::from)
                .unwrap_or_else(|| state.repo_root.clone())
                .join(&w)
        })
        .filter(|p| p.is_dir())
        .ok_or("no worktree for agent")?;
    let out = std::process::Command::new("git")
        .args(["-C"])
        .arg(&wt)
        .args(["push", "-u", "origin", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        emit_control(
            &app,
            &ServerMsg::GitPushed {
                agent_id,
                output: String::from_utf8_lossy(&out.stderr).trim().to_string(),
            },
        );
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn artifact_create(
    state: State<'_, CanvasState>,
    board_id: Option<String>,
    agent_id: Option<String>,
    kind: String,
    title: String,
    path: Option<String>,
    text: Option<String>,
) -> Result<(), String> {
    state
        .orchestrator
        .artifact_create(board_id, agent_id, kind, title, path, text)
        .map(|_| ())
}

#[tauri::command]
fn artifact_delete(
    app: AppHandle,
    state: State<'_, CanvasState>,
    artifact_id: String,
) -> Result<(), String> {
    state
        .store
        .artifact_deleted(&artifact_id)
        .map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::ArtifactDeleted { artifact_id });
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
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
        None => state
            .store
            .note_next_pos(&board, &col)
            .map_err(|e| e.to_string())?,
    };
    state
        .store
        .note_upsert(&id, &board, &col, &text, p, due.as_deref())
        .map_err(|e| e.to_string())?;
    emit_control(
        &app,
        &ServerMsg::NoteUpserted {
            note: canvasd::protocol::SnapshotNote {
                note_id: id,
                board_id: board,
                col,
                text,
                pos: p,
                due,
            },
        },
    );
    Ok(())
}

#[tauri::command]
fn note_delete(
    app: AppHandle,
    state: State<'_, CanvasState>,
    note_id: String,
) -> Result<(), String> {
    state
        .store
        .note_deleted(&note_id)
        .map_err(|e| e.to_string())?;
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
        md.push('\n');
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
        md.push('\n');
    }
    emit_control(&app, &ServerMsg::SessionDigest { text: md });
    Ok(())
}

#[tauri::command]
fn memory_read(state: State<'_, CanvasState>, node_id: String) -> Result<String, String> {
    Ok(std::fs::read_to_string(state.orchestrator.memory_path(&node_id)).unwrap_or_default())
}

#[tauri::command]
fn memory_write(
    app: AppHandle,
    state: State<'_, CanvasState>,
    node_id: String,
    text: String,
) -> Result<(), String> {
    let path = state.orchestrator.memory_path(&node_id);
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
    // Registering a workspace is an explicit operator gesture — its repo joins
    // the sandbox so the explorer and vault operations can browse it later.
    let expanded_repo = canvasd::paths::expand_tilde(&repo);
    if let Some(canon) = canon_through_missing(&expanded_repo) {
        if !root_allowed(&state.allowed_roots, &canon) {
            persist_allowed_root(&state.allowed_roots, &canon);
        }
    }
    let id = uuid_v4ish();
    state
        .store
        .workspace_created(&id, &name, &repo, board_id.as_deref())
        .map_err(|e| e.to_string())?;
    emit_control(
        &app,
        &ServerMsg::WorkspaceCreated {
            workspace_id: id.clone(),
            name,
            repo,
            board_id,
        },
    );
    Ok(id)
}

/// Set the ordered CLI fallback chain for a workspace — spawned agents
/// whose CLI dies at launch retry with the next entry automatically.
/// Empty means "back to auto" (the machine's auto-detected chain). The
/// board store updates optimistically, so — like the daemon's handler —
/// a success emits nothing; the next snapshot carries the chain either way.
#[tauri::command]
fn set_agent_chain(
    state: State<'_, CanvasState>,
    workspace_id: String,
    chain: Vec<String>,
) -> Result<(), String> {
    state
        .store
        .set_workspace_chain(&workspace_id, &chain)
        .map_err(|e| e.to_string())
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
#[allow(clippy::too_many_arguments)]
fn delegate(
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
    state.orchestrator.delegate(DelegateParams {
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
    })
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
        live.contains(target)
            .then(|| target.to_string())
            .into_iter()
            .collect()
    }
}

/// Fire a loop: write its instruction to every resolved target — gated
/// exactly like the automation prompt (supervised + sensitive → held).
fn fire_loop(state: &CanvasState, row: &canvasd::store::LoopRow) {
    let (loop_id, board_id, target, instruction, _, _, _, _, _) = row;
    for id in loop_targets(state, board_id, target) {
        let bytes = format!("{instruction}\n");
        // Same supervised-input gate as operator input and automation prompts.
        if !gated_write(state, &id, bytes.as_bytes()) {
            warn!(agent_id = %id, "loop instruction write failed");
        }
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
        .loop_insert(
            &id,
            &board_id,
            &target,
            &instruction,
            trigger,
            interval,
            pattern.as_deref(),
        )
        .map_err(|e| e.to_string())?;
    emit_control(
        &app,
        &ServerMsg::LoopSaved {
            l: canvasd::protocol::SnapshotLoop {
                loop_id: id.clone(),
                board_id,
                target,
                instruction,
                trigger: trigger.to_string(),
                interval_secs: interval,
                pattern,
                enabled: true,
                last_fired_at: None,
            },
        },
    );
    Ok(id)
}

#[tauri::command]
fn run_loop(app: AppHandle, state: State<'_, CanvasState>, loop_id: String) -> Result<(), String> {
    let row = state
        .store
        .loops_snapshot()
        .unwrap_or_default()
        .into_iter()
        .find(|r| r.0 == loop_id)
        .ok_or_else(|| format!("loop not found: {loop_id}"))?;
    fire_loop(&state, &row);
    if let Some(l) = state
        .store
        .loops_snapshot()
        .unwrap_or_default()
        .into_iter()
        .find(|r| r.0 == loop_id)
        .map(canvasd::control::loop_to_snapshot)
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
    state
        .store
        .loop_deleted(&loop_id)
        .map_err(|e| e.to_string())?;
    emit_control(&app, &ServerMsg::LoopDeleted { loop_id });
    Ok(())
}

#[tauri::command]
fn pause_all(state: State<'_, CanvasState>, board_id: Option<String>) -> Result<usize, String> {
    let board = board_id.unwrap_or_else(|| "main".to_string());
    let ids = loop_targets(&state, &board, "*");
    Ok(state.agents.suspend_many(&ids))
}

#[tauri::command]
fn resume_all(state: State<'_, CanvasState>, board_id: Option<String>) -> Result<usize, String> {
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
        .map(canvasd::control::loop_to_snapshot)
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
    let policy = if on_approval.as_deref() == Some("deny") {
        "deny"
    } else {
        "hold"
    };
    let idle = idle_secs.unwrap_or(300).clamp(10, 86_400);
    let interval = interval_secs.map(|v| v.clamp(60, 86_400));
    let id = uuid_v4ish();
    state
        .store
        .automation_created(
            &id,
            &name,
            &prompt,
            &command,
            workspace_id.as_deref(),
            level,
            idle,
            policy,
            interval,
        )
        .map_err(|e| e.to_string())?;
    emit_control(
        &app,
        &ServerMsg::AutomationSaved {
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
        },
    );
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
    let (
        automation_id,
        name,
        prompt,
        command,
        workspace_id,
        permission,
        idle_secs,
        on_approval,
        _,
        _,
        _,
    ) = row;
    let (id, run_board, ready) = state.orchestrator.spawn(
        &name,
        &command,
        ".",
        workspace_id.as_deref(),
        &permission,
        None,
        None,
        // The prompt rides the fallback state: a chain fallback before
        // injection re-runs the automation on the replacement CLI.
        Some(&prompt),
        None,
        // Guardrails attach inside the spawn — before the registration
        // gate fires — and ride the fallback state, so a replacement keeps
        // the idle alert and approval policy of the original run.
        Some((idle_secs.max(0) as u64, on_approval == "deny")),
    )?;
    let _ = state.store.automation_ran(&automation_id);
    let wt = state
        .agents
        .worktree(&id)
        .map(|p| p.to_string_lossy().to_string());
    emit_control(
        app,
        &ServerMsg::Spawned {
            agent_id: id.clone(),
            name,
            command,
            permission,
            workspace_id,
            board_id: run_board,
            fallback_from: None,
            worktree: wt,
        },
    );
    // Inject the saved prompt — the kernel PTY buffer holds it until the
    // CLI reads stdin, through the same supervised-input gate as operator input.
    let bytes = format!("{prompt}\n");
    let disposition = state
        .orchestrator
        .gated_write_disposition(&id, bytes.as_bytes());
    // Prompt disposition vs. fallback retry:
    // - written or held: the fallback-state copy STAYS — fallback only
    //   fires when the original died within seconds of launch, so its copy
    //   of the prompt never completed (a write into the kernel PTY buffer
    //   of a dying CLI delivers nothing); the replacement re-runs it.
    // - dropped by deny-policy: a deliberate drop must NOT retry on the
    //   replacement — clear the copy so fallback skips re-injection.
    if matches!(disposition, Ok(InputDisposition::Denied)) {
        if let Some(fb) = state.pending_fallbacks.lock().unwrap().get_mut(&id) {
            fb.initial_input = None;
        }
    }
    // Registration for this run is complete (guardrails inside orchestrator spawn,
    // prompt disposition above) — release the exit watcher before surfacing a
    // write error, so even that path cannot strand the exit watcher.
    let _ = ready.send(());
    disposition?;
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
fn pty_input(state: State<'_, CanvasState>, agent_id: String, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| e.to_string())?;
    if gated_write(&state, &agent_id, &bytes) {
        Ok(())
    } else {
        Err("pty write failed".to_string())
    }
}

#[tauri::command]
fn approve_input(state: State<'_, CanvasState>, agent_id: String) -> Result<(), String> {
    state.orchestrator.approve_input(&agent_id)
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
    state
        .agents
        .resize(&agent_id, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn confirm_destructive(
    state: State<'_, CanvasState>,
    agent_id: String,
    action: String,
) -> Result<(), String> {
    state.orchestrator.confirm_destructive(&agent_id, &action)
}

#[tauri::command]
fn move_node(
    state: State<'_, CanvasState>,
    agent_id: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    state
        .store
        .save_node_position(&agent_id, x, y)
        .map_err(|e| e.to_string())
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
    let wt = state.agents.worktree(&agent_id).or_else(|| {
        state
            .store
            .agent_worktree(&agent_id)
            .ok()
            .flatten()
            .map(std::path::PathBuf::from)
    });
    match wt {
        Some(wt) => {
            emit_control(
                &app,
                &ServerMsg::DiffDetail {
                    agent_id,
                    diff: dirty_diff(&wt),
                },
            );
            Ok(())
        }
        None => Err("no such agent".into()),
    }
}

#[tauri::command]
fn snapshot(app: AppHandle, state: State<'_, CanvasState>) -> Result<serde_json::Value, String> {
    // Transcript replay stays a Tauri-only transport concern: buffered PTY
    // scrollback is emitted before the snapshot so a reopened terminal shows
    // history instead of a blank screen. The snapshot payload itself is the
    // exact shared ServerMsg construction used by both WS control sockets.
    for id in state.agents.list() {
        if let Some(buf) = state.agents.scrollback(&id) {
            if !buf.is_empty() {
                emit_pty(&app, &id, &buf);
            }
        }
    }
    let approvals = canvasd::control::approval_lines(&state.pending_inputs);
    let msg = canvasd::control::snapshot_message(
        &state.store,
        &state.agents,
        &state.repo_root,
        canvasd::control::repo_url(&state.repo_root),
        approvals,
    )
    .map_err(|e| e.to_string())?;
    serde_json::to_value(msg).map_err(|e| e.to_string())
}

/// One bookmark-bar entry for the web launcher's bookmarks section.
#[derive(serde::Serialize)]
struct ChromeBookmark {
    name: String,
    url: String,
    /// Name of the bookmark_bar folder it sits in (None = loose on the bar).
    folder: Option<String>,
}

fn collect_bookmarks(
    node: &serde_json::Value,
    folder: Option<&str>,
    out: &mut Vec<ChromeBookmark>,
) {
    if out.len() >= 40 {
        return;
    }
    match node.get("type").and_then(|t| t.as_str()) {
        Some("url") => {
            if let (Some(name), Some(url)) = (
                node.get("name").and_then(|v| v.as_str()),
                node.get("url").and_then(|v| v.as_str()),
            ) {
                out.push(ChromeBookmark {
                    name: name.to_string(),
                    url: url.to_string(),
                    folder: folder.map(String::from),
                });
            }
        }
        Some("folder") => {
            let name = node
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("bookmarks")
                .to_string();
            if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
                for c in children {
                    collect_bookmarks(c, Some(&name), out);
                }
            }
        }
        _ => {}
    }
}

/// Local Chrome bookmark bar — the web launcher renders these as chips.
/// Desktop-only: the daemon client hides the section entirely.
#[tauri::command]
fn chrome_bookmarks() -> Vec<ChromeBookmark> {
    let Some(home) = std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
    else {
        return Vec::new();
    };
    let roots = [
        home.join(".config/google-chrome"),
        home.join(".config/chromium"),
        home.join("Library/Application Support/Google/Chrome"),
        home.join("AppData/Local/Google/Chrome/User Data"),
    ];
    // Every profile holds its own Bookmarks file — users browsing from a
    // secondary profile would otherwise see nothing (or the wrong bar).
    let mut paths: Vec<PathBuf> = Vec::new();
    for root in roots.iter().filter(|r| r.is_dir()) {
        let mut profiles: Vec<PathBuf> = std::fs::read_dir(root)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .map(|n| n == "Default" || n.starts_with("Profile "))
                            .unwrap_or(false)
                    })
                    .collect()
            })
            .unwrap_or_default();
        profiles.sort();
        paths.extend(profiles.into_iter().map(|p| p.join("Bookmarks")));
    }
    let mut out = Vec::new();
    for path in paths {
        if out.len() >= 40 {
            break;
        }
        let Some(json) = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        else {
            continue;
        };
        if let Some(children) = json
            .get("roots")
            .and_then(|r| r.get("bookmark_bar"))
            .and_then(|b| b.get("children"))
            .and_then(|c| c.as_array())
        {
            for c in children {
                collect_bookmarks(c, None, &mut out);
            }
        }
    }
    out
}

/// One shelled-out probe: `Some((success, stdout))` when the binary ran at
/// all, `None` when it couldn't even spawn (not installed). The process
/// output type is sealed, so tests inject this shape rather than fabricate
/// a `std::process::Output`.
type ProcResult = Option<(bool, Vec<u8>)>;

/// Boxed process runner — injectable so the gh→curl fallback chain is
/// unit-testable without touching the real PATH.
type ProcRunner = dyn FnMut(
        String,
        Vec<String>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ProcResult> + Send>>
    + Send;

fn system_proc_runner(
    cmd: String,
    args: Vec<String>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ProcResult> + Send>> {
    Box::pin(async move {
        tokio::process::Command::new(cmd)
            .args(&args)
            .output()
            .await
            .ok()
            .map(|o| (o.status.success(), o.stdout))
    })
}

/// GitHub REST response body for `path` (e.g. `repos/o/r/pulls?state=open`):
/// `gh api` first — it carries the user's auth, so private repos work and
/// the rate limit is the authenticated one — then unauthenticated curl,
/// then the same unavailable-message JSON the daemon serves. Mirrors
/// canvasd's `/api/github` exactly; `std::process::Output` can't be
/// constructed in tests, so the probe results arrive as `(success, stdout)`.
async fn github_body(path: &str, run: &mut ProcRunner) -> Vec<u8> {
    if let Some((true, stdout)) = run("gh".into(), vec!["api".into(), path.to_string()]).await {
        return stdout;
    }
    match run(
        "curl".into(),
        vec![
            "-sf".into(),
            "-H".into(),
            "Accept: application/vnd.github+json".into(),
            format!("https://api.github.com/{path}"),
        ],
    )
    .await
    {
        Some((true, stdout)) => stdout,
        _ => br#"{"message":"github unavailable - install gh or retry later"}"#.to_vec(),
    }
}

/// GET /api/github's native answer — the panel's fetch goes through this
/// command instead of a daemon route. Returns the upstream body verbatim
/// (it is always JSON), exactly like the daemon's proxy.
#[tauri::command]
async fn github_proxy(path: String) -> Result<String, String> {
    let body = github_body(&path, &mut system_proc_runner).await;
    Ok(String::from_utf8_lossy(&body).to_string())
}

#[cfg(test)]
mod github_proxy_tests {
    use super::{github_body, ProcResult};
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    /// Every process invocation the fallback chain made, in order.
    type RecordedCalls = Arc<Mutex<Vec<(String, Vec<String>)>>>;

    /// Scripted runner: records every (cmd, args) invocation and answers
    /// from a queue of canned results keyed in call order.
    struct Scripted {
        calls: RecordedCalls,
        answers: VecDeque<ProcResult>,
    }

    impl Scripted {
        fn new(answers: Vec<ProcResult>) -> (Self, RecordedCalls) {
            let calls = Arc::new(Mutex::new(Vec::new()));
            (
                Scripted {
                    calls: calls.clone(),
                    answers: answers.into(),
                },
                calls,
            )
        }

        fn runner(
            mut self,
        ) -> impl FnMut(
            String,
            Vec<String>,
        )
            -> std::pin::Pin<Box<dyn std::future::Future<Output = ProcResult> + Send>>
               + Send {
            move |cmd, args| {
                self.calls.lock().unwrap().push((cmd, args));
                let answer = self.answers.pop_front().unwrap_or(None);
                Box::pin(async move { answer })
            }
        }
    }

    fn ok(body: &str) -> ProcResult {
        Some((true, body.as_bytes().to_vec()))
    }

    fn failed() -> ProcResult {
        Some((false, Vec::new()))
    }

    #[tokio::test]
    async fn gh_success_short_circuits_curl() {
        let (scripted, calls) = Scripted::new(vec![ok("[{\"number\":1}]")]);
        let mut runner = scripted.runner();
        let body = github_body("repos/o/r/pulls?state=open", &mut runner).await;
        assert_eq!(body, b"[{\"number\":1}]");
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1, "curl must not run when gh succeeds");
        assert_eq!(
            calls[0],
            (
                "gh".to_string(),
                vec!["api".to_string(), "repos/o/r/pulls?state=open".to_string()]
            )
        );
    }

    #[tokio::test]
    async fn gh_failure_falls_back_to_anonymous_curl() {
        let (scripted, calls) = Scripted::new(vec![failed(), ok("{\"items\":[]}")]);
        let mut runner = scripted.runner();
        let body = github_body("repos/o/r/issues", &mut runner).await;
        assert_eq!(body, b"{\"items\":[]}");
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1].0, "curl");
        assert_eq!(
            calls[1].1,
            vec![
                "-sf".to_string(),
                "-H".to_string(),
                "Accept: application/vnd.github+json".to_string(),
                "https://api.github.com/repos/o/r/issues".to_string()
            ]
        );
    }

    #[tokio::test]
    async fn missing_gh_and_curl_serve_the_unavailable_message() {
        // None = the binary never even spawned (not installed).
        let (scripted, _) = Scripted::new(vec![None, None]);
        let mut runner = scripted.runner();
        let body = github_body("repos/o/r/pulls", &mut runner).await;
        let text = String::from_utf8(body).unwrap();
        assert!(text.contains("github unavailable"));
    }

    #[tokio::test]
    async fn gh_success_with_empty_stdout_wins_over_curl() {
        // `gh api` success is authoritative even when the body is empty —
        // matching the daemon, which returns gh's stdout verbatim on exit 0.
        let (scripted, calls) = Scripted::new(vec![Some((true, Vec::new()))]);
        let mut runner = scripted.runner();
        let body = github_body("user", &mut runner).await;
        assert!(body.is_empty());
        assert_eq!(calls.lock().unwrap().len(), 1);
    }
}

/// State for the embedded share server: the published bytes plus the store
/// the export endpoint reads from.
#[derive(Clone)]
struct ShareServerState {
    shares: ShareMap,
    store: Arc<Store>,
}

/// GET /share/{id} — same contract as the daemon's: public (the unguessable
/// id is the capability), bytes streamed inline with their mime type.
async fn share_server_get(
    axum::extract::State(state): axum::extract::State<ShareServerState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let doc = state.shares.lock().unwrap().get(&id).cloned();
    match doc {
        Some((title, mime, body)) => (
            [
                (axum::http::header::CONTENT_TYPE, mime),
                (
                    axum::http::header::CONTENT_DISPOSITION,
                    canvasd::share::content_disposition(&title),
                ),
            ],
            axum::body::Body::from(body),
        )
            .into_response(),
        None => (
            axum::http::StatusCode::NOT_FOUND,
            "share not found — it lives only while the app runs",
        )
            .into_response(),
    }
}

/// GET /api/export — the same store dump the daemon serves. Localhost-only
/// exposure: this reveals nothing a local process can't already read from
/// `.canvas/board.db` on disk (unlike the daemon, which can be LAN-bound
/// and therefore keeps it behind the session token).
async fn share_server_export(
    axum::extract::State(state): axum::extract::State<ShareServerState>,
) -> axum::Json<serde_json::Value> {
    axum::Json(canvasd::export::state_json(&state.store))
}

/// The share server's routes, factored out so tests can serve the real
/// router over a real socket — axum 0.8's `{id}` path syntax is exactly
/// the kind of wiring detail a handler-level test never exercises.
fn share_router(shares: ShareMap, store: Arc<Store>) -> axum::Router {
    axum::Router::new()
        .route("/share/{id}", axum::routing::get(share_server_get))
        .route("/api/export", axum::routing::get(share_server_export))
        .with_state(ShareServerState { shares, store })
}

/// Embedded HTTP server behind share-by-link. The native shell runs no
/// daemon, but a share link is only useful when a browser can open it —
/// the webview's `tauri://` origin can't serve anything. Binds 127.0.0.1 on
/// an ephemeral port: never a fixed one, because the daemon owns 4242 and
/// two coexisting Canvas runtimes must not fight over a well-known port.
/// The share URL handed to the user carries the actual port, so the
/// ephemerality is invisible to the copy-paste flow.
fn embedded_router(
    shares: ShareMap,
    store: Arc<Store>,
    orchestrator: Orchestrator,
    control_token: String,
) -> axum::Router {
    // One localhost ephemeral server, two surfaces: public unguessable share
    // links and the token-authenticated agent control socket. Sharing the
    // port means CANVAS_PORT is enough for canvasctl while share URLs keep
    // the exact same shape they had before.
    share_router(shares, store).merge(canvasd::control::router(orchestrator, control_token))
}

fn spawn_share_server(
    listener: std::net::TcpListener,
    shares: ShareMap,
    store: Arc<Store>,
    orchestrator: Orchestrator,
    control_token: String,
) {
    if let Err(e) = listener.set_nonblocking(true) {
        warn!(error = %e, "share server could not go non-blocking — sharing disabled");
        return;
    }
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(l) => l,
            Err(e) => {
                warn!(error = %e, "share server listener conversion failed");
                return;
            }
        };
        if let Err(e) = axum::serve(
            listener,
            embedded_router(shares, store, orchestrator, control_token),
        )
        .await
        {
            warn!(error = %e, "embedded server stopped");
        }
    });
}

/// What the daemon's POST /api/share answers, but with an absolute URL:
/// there is no web origin in the native shell, so the copied link has to
/// carry host and port with it.
#[derive(serde::Serialize)]
struct ShareCreated {
    id: String,
    url: String,
}

/// POST /api/share's native answer — publish artifact bytes in memory and
/// hand back the browser-openable link. Lives exactly as long as the app
/// does, same as the daemon's version.
#[tauri::command]
fn share_create(
    state: State<'_, CanvasState>,
    title: String,
    mime: String,
    b64: String,
) -> Result<ShareCreated, String> {
    let body = canvasd::share::decode_body(&b64).map_err(|e| e.message().to_string())?;
    let port = state
        .share_port
        .ok_or_else(|| "share server unavailable — restart the app".to_string())?;
    let id = canvasd::share::new_share_id();
    state.shares.lock().unwrap().insert(
        id.clone(),
        (
            canvasd::share::normalize_title(&title),
            canvasd::share::normalize_mime(&mime),
            body,
        ),
    );
    Ok(ShareCreated {
        url: format!("http://127.0.0.1:{port}/share/{id}"),
        id,
    })
}

/// GET /api/export's native answer as a command — the same JSON the
/// embedded server answers over HTTP for curl-driven workflows. Full
/// board-state dump: boards, layout, agents, workspaces, delegations.
#[tauri::command]
fn export_state(state: State<'_, CanvasState>) -> Result<serde_json::Value, String> {
    Ok(canvasd::export::state_json(&state.store))
}

#[cfg(test)]
mod share_server_tests {
    use super::{share_server_export, share_server_get, ShareMap, ShareServerState};
    use axum::extract::{Path, State as AxumState};
    use axum::response::IntoResponse;
    use canvasd::store::Store;
    use std::sync::{Arc, Mutex};

    fn fixture() -> (ShareServerState, ShareMap, tempfile::TempDir) {
        let tmp = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::open(tmp.path()).unwrap());
        let shares: ShareMap = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let state = ShareServerState {
            shares: shares.clone(),
            store,
        };
        (state, shares, tmp)
    }

    #[tokio::test]
    async fn serves_stored_bytes_with_mime_and_pdf_disposition() {
        let (state, shares, _tmp) = fixture();
        shares.lock().unwrap().insert(
            "abcdef0123456789".to_string(),
            (
                "digest".to_string(),
                "application/pdf".to_string(),
                b"%PDF".to_vec(),
            ),
        );
        let response = share_server_get(AxumState(state), Path("abcdef0123456789".to_string()))
            .await
            .into_response();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        assert_eq!(response.headers()["content-type"], "application/pdf");
        assert_eq!(
            response.headers()["content-disposition"],
            "inline; filename=\"digest.pdf\""
        );
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&body[..], b"%PDF");
    }

    #[tokio::test]
    async fn unknown_share_ids_are_a_plain_404() {
        let (state, _, _tmp) = fixture();
        let response = share_server_get(AxumState(state), Path("0000000000000000".to_string()))
            .await
            .into_response();
        assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn export_answers_the_versioned_state_dump() {
        let (state, _, _tmp) = fixture();
        let axum::Json(dump) = share_server_export(AxumState(state)).await;
        assert_eq!(dump["version"], 1);
        assert!(!dump["boards"].as_array().unwrap().is_empty());
    }

    /// Raw HTTP/1.0 GET over a real TCP stream — no client dependency, and
    /// the response is assertable as plain text.
    async fn raw_get(port: u16, path: &str) -> String {
        raw_request(port, path, "Connection: close\r\n").await
    }

    /// Raw websocket-upgrade GET. The auth decision lives after axum's
    /// upgrade extractor, so a plain GET would fail earlier with a generic
    /// 400 and prove nothing about the token gate. Reads only headers: a
    /// rejected upgrade keeps the HTTP connection alive, so read_to_end hangs.
    async fn raw_ws_upgrade_get(port: u16, path: &str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port))
            .await
            .unwrap();
        stream
            .write_all(
                format!(
                    "GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        let mut out = Vec::new();
        let mut buf = [0u8; 1024];
        while !out.windows(4).any(|w| w == b"\r\n\r\n") {
            let n = tokio::time::timeout(std::time::Duration::from_secs(2), stream.read(&mut buf))
                .await
                .expect("timed out waiting for upgrade response headers")
                .unwrap();
            if n == 0 {
                break;
            }
            out.extend_from_slice(&buf[..n]);
        }
        String::from_utf8_lossy(&out).to_string()
    }

    async fn raw_request(port: u16, path: &str, headers: &str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port))
            .await
            .unwrap();
        stream
            .write_all(
                format!("GET {path} HTTP/1.1\r\nHost: localhost\r\n{headers}\r\n").as_bytes(),
            )
            .await
            .unwrap();
        let mut out = Vec::new();
        stream.read_to_end(&mut out).await.unwrap();
        String::from_utf8_lossy(&out).to_string()
    }

    #[tokio::test]
    async fn share_routes_roundtrip_over_a_real_socket() {
        let (state, shares, _tmp) = fixture();
        shares.lock().unwrap().insert(
            "0123456789abcdef".to_string(),
            (
                "digest".to_string(),
                "application/pdf".to_string(),
                b"%PDF-1.4".to_vec(),
            ),
        );
        let router = super::share_router(state.shares.clone(), state.store.clone());
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0u16))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });

        // The share link itself: exact bytes, mime, inline disposition.
        let res = raw_get(port, "/share/0123456789abcdef").await;
        assert!(res.starts_with("HTTP/1.1 200"), "got: {res}");
        assert!(res.contains("content-type: application/pdf"));
        assert!(res.contains("content-disposition: inline; filename=\"digest.pdf\""));
        assert!(res.ends_with("%PDF-1.4"));

        // Unknown ids are the same 404 the daemon answers.
        let res = raw_get(port, "/share/ffffffffffffffff").await;
        assert!(res.starts_with("HTTP/1.1 404"), "got: {res}");
        assert!(res.contains("share not found"));

        // The export route answers the versioned dump as JSON.
        let res = raw_get(port, "/api/export").await;
        assert!(res.starts_with("HTTP/1.1 200"), "got: {res}");
        assert!(res.contains("\"version\":1"), "got: {res}");
    }

    #[tokio::test]
    async fn embedded_router_mounts_share_and_control_socket_together() {
        let (state, shares, tmp) = fixture();
        shares.lock().unwrap().insert(
            "0123456789abcdef".to_string(),
            (
                "digest".to_string(),
                "application/pdf".to_string(),
                b"%PDF-1.4".to_vec(),
            ),
        );
        let agents = Arc::new(canvasd::agent::AgentManager::new());
        agents.set_transcript_dir(tmp.path().join(".canvas").join("transcripts"));
        let orchestrator = canvasd::orchestrate::Orchestrator::new(
            state.store.clone(),
            agents,
            tmp.path().to_path_buf(),
            canvasd::orchestrate::tokio_task_spawner(),
        );
        let router = super::embedded_router(
            state.shares.clone(),
            state.store.clone(),
            orchestrator,
            "secret".to_string(),
        );
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0u16))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });

        // The public share route survived the merge.
        let res = raw_get(port, "/share/0123456789abcdef").await;
        assert!(res.starts_with("HTTP/1.1 200"), "got: {res}");
        // And /ws exists on the same port, gated before the upgrade. Without
        // the merge this path would be a router 404 rather than an auth 401.
        let res = raw_ws_upgrade_get(port, "/ws?token=wrong").await;
        assert!(res.starts_with("HTTP/1.1 401"), "got: {res}");
    }
}

/// Where the board lives when nothing points anywhere else.
///
/// - `CANVAS_REPO` wins (dev / power-user override).
/// - A terminal launch inside a canvas-looking directory (one that already
///   has `.canvas` state or is a git repo) keeps the cwd behavior the
///   daemon always had.
/// - Everything else — a Finder/launchd launch, whose cwd is `/` and where
///   `Store::open` dies trying to create `/.canvas` (the launch crash), or
///   a random folder — lands in the per-user default `~/Canvas`.
fn pick_repo_root(canvas_repo: Option<&str>, cwd: &Path, home: &Path) -> PathBuf {
    if let Some(dir) = canvas_repo.map(str::trim).filter(|dir| !dir.is_empty()) {
        return PathBuf::from(dir);
    }
    let looks_like_board = cwd.join(".canvas").is_dir() || cwd.join(".git").exists();
    if looks_like_board && cwd.parent().is_some() {
        return cwd.to_path_buf();
    }
    home.join("Canvas")
}

/// Quote one path for POSIX `/bin/sh` single-quote syntax.
fn posix_shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

/// Contents of the generated Unix canvasctl shim. The native app cannot rely
/// on a sibling canvasctl binary (the Tauri executable lives in a different
/// target/install layout), so the shim re-enters this same executable through
/// its hidden CLI mode. The implementation is the shared `canvasd::ctl` one,
/// not a divergent copy.
#[cfg(not(windows))]
fn canvasctl_shim_contents(exe: &Path) -> String {
    format!(
        "#!/bin/sh\n# Generated by Canvas; overwritten when the app path changes.\nexec {} --canvasctl \"$@\"\n",
        posix_shell_quote(&exe.to_string_lossy())
    )
}

/// Windows command-file equivalent. `%*` preserves the original argument
/// splitting closely enough for canvasctl's simple flag/value surface.
#[cfg(windows)]
fn canvasctl_shim_contents(exe: &Path) -> String {
    format!(
        "@echo off\r\nrem Generated by Canvas; overwritten when the app path changes.\r\n\"{}\" --canvasctl %*\r\n",
        exe.to_string_lossy()
    )
}

/// Install/update the user-level shim and return the directory PTYs should
/// prepend to PATH. Lives in user config, never the board repo: checkout
/// contents must not be able to replace the control binary agents execute.
fn install_canvasctl_shim() -> Option<PathBuf> {
    let dir = canvasd::paths::canvas_config_dir()?.join("bin");
    let exe = std::env::current_exe()
        .ok()
        .and_then(|p| std::fs::canonicalize(&p).ok().or(Some(p)))?;
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(if cfg!(windows) {
        "canvasctl.cmd"
    } else {
        "canvasctl"
    });
    std::fs::write(&path, canvasctl_shim_contents(&exe)).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).ok()?;
    }
    Some(dir)
}

/// Forward the transport-independent buses into the webview. This is the
/// only Tauri-specific event adaptation left: control events keep the exact
/// ServerMsg JSON shape, PTY chunks keep the existing base64 payload shape.
fn forward_core_events(app: &AppHandle, orchestrator: &Orchestrator) {
    let ui = app.clone();
    let mut control_rx = orchestrator.subscribe_control();
    tauri::async_runtime::spawn(async move {
        loop {
            match control_rx.recv().await {
                Ok(msg) => {
                    if let Err(e) = ui.emit("canvas://control", msg) {
                        warn!(error = %e, "forward control event failed");
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "webview lagged on control events");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let ui = app.clone();
    let mut pty_rx = orchestrator.subscribe_pty();
    tauri::async_runtime::spawn(async move {
        loop {
            match pty_rx.recv().await {
                Ok((agent_id, bytes)) => {
                    let payload = serde_json::json!({
                        "agent_id": agent_id,
                        "data": base64::engine::general_purpose::STANDARD.encode(bytes),
                    });
                    if let Err(e) = ui.emit("canvas://pty", payload) {
                        warn!(error = %e, "forward pty event failed");
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "webview lagged on pty output");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

#[cfg(test)]
mod canvasctl_shim_tests {
    use super::*;

    #[test]
    fn posix_single_quote_escapes_embedded_quotes() {
        assert_eq!(posix_shell_quote("/tmp/plain"), "'/tmp/plain'");
        assert_eq!(
            posix_shell_quote("/tmp/o'clock/app"),
            "'/tmp/o'\"'\"'clock/app'"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_shim_execs_current_exe_in_canvasctl_mode() {
        let text = canvasctl_shim_contents(Path::new(
            "/Applications/Canvas.app/Contents/MacOS/canvas-app",
        ));
        assert!(text.starts_with("#!/bin/sh"));
        assert!(text.contains("--canvasctl \"$@\""));
        assert!(text.contains("'/Applications/Canvas.app/Contents/MacOS/canvas-app'"));
    }
}

fn main() {
    // Generated canvasctl shims re-enter this executable instead of relying
    // on a sibling binary that packaged apps do not have. Handle that mode
    // before any GUI/tracing initialization and exit like the standalone CLI.
    if std::env::args().nth(1).as_deref() == Some("--canvasctl") {
        let args = std::env::args().skip(2).collect();
        if let Err(e) = canvasd::ctl::run_blocking(args) {
            eprintln!("Error: {e:#}");
            std::process::exit(1);
        }
        return;
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "canvas_app=info".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let repo_root = {
                let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
                let home = std::env::var("HOME")
                    .or_else(|_| std::env::var("USERPROFILE"))
                    .map(PathBuf::from)
                    .unwrap_or_else(|_| cwd.clone());
                let root =
                    pick_repo_root(std::env::var("CANVAS_REPO").ok().as_deref(), &cwd, &home);
                if root == home.join("Canvas") {
                    // The per-user default: create it, and make it a git
                    // repo so the main board can spawn worktree agents out
                    // of the box. Best effort — a missing git binary must
                    // not stop the app.
                    let _ = std::fs::create_dir_all(&root);
                    if !root.join(".git").exists() {
                        let _ = std::process::Command::new("git")
                            .arg("init")
                            .arg(&root)
                            .output();
                    }
                    // `git init` alone leaves the repo commitless — no HEAD
                    // for `git worktree add` to branch from, so every spawn
                    // died before its PTY existed. Bootstrap the empty
                    // initial commit up front (also covers a ~/Canvas that
                    // was init'ed by an older build and never committed).
                    canvasd::agent::ensure_initial_commit(&root);
                }
                root
            };
            let store = Arc::new(Store::open(&repo_root)?);
            store.mark_all_exited()?;
            // Update check on launch: downloads + installs when GitHub
            // Releases publishes a newer signed build. Silent on failure —
            // offline dev runs should not complain.
            {
                use tauri_plugin_updater::UpdaterExt;
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok(updater) = handle.updater() {
                        if let Ok(Some(update)) = updater.check().await {
                            let _ = update.download_and_install(|_, _| {}, || {}).await;
                        }
                    }
                });
            }
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
            let agents = Arc::new(AgentManager::new());
            agents.set_transcript_dir(repo_root.join(".canvas").join("transcripts"));
            // Make the generated re-entry shim visible inside PTYs. The exe
            // dir still leads PATH (canvasd development layout); this dir is
            // the first place a packaged native app can actually provide one.
            match install_canvasctl_shim() {
                Some(dir) => agents.prepend_path_entry(dir),
                None => warn!(
                    "could not install canvasctl shim — in-PTY orchestration may be unavailable"
                ),
            }
            let allowed_roots = initial_allowed_roots(&repo_root, &store);

            // Transport-independent orchestration core. Tauri commands can be
            // invoked outside a tokio thread-local context, so the core gets
            // Tauri's launcher explicitly instead of assuming `tokio::spawn`.
            let task_spawner: TaskSpawner = Arc::new(|task| {
                drop(tauri::async_runtime::spawn(task));
            });
            let orchestrator = Orchestrator::new(
                store.clone(),
                agents.clone(),
                repo_root.clone(),
                task_spawner,
            );

            // Embedded localhost server — bound before state management so
            // share_create can build absolute URLs and PTYs can receive the
            // real control port. Ephemeral only: the daemon owns 4242, and a
            // fixed port here would make coexisting runtimes fight over it.
            let shares: ShareMap = Arc::new(Mutex::new(HashMap::new()));
            let control_token = canvasd::control::generate_token();
            let (share_listener, share_port) =
                match std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0u16))
                    .and_then(|listener| listener.local_addr().map(|addr| (listener, addr.port())))
                {
                    Ok((listener, port)) => (Some(listener), Some(port)),
                    Err(e) => {
                        warn!(error = %e, "embedded server bind failed — sharing/control disabled");
                        (None, None)
                    }
                };
            if let Some(port) = share_port {
                // Same contract canvasd injects: canvasctl inside the PTY
                // reads exactly these variables and needs no native-specific mode.
                agents.set_env("CANVAS_PORT", &port.to_string());
                agents.set_env("CANVAS_TOKEN", &control_token);
                #[cfg(debug_assertions)]
                if std::env::var_os("CANVAS_PRINT_CONTROL_TOKEN").is_some() {
                    // Opt-in debug-boot smoke-test hook; release builds ignore it.
                    println!("CANVAS_CONTROL_PORT={port}");
                    println!("CANVAS_CONTROL_TOKEN={control_token}");
                }
            }
            app.manage(CanvasState {
                agents,
                store: store.clone(),
                repo_root,
                pending_results: orchestrator.pending_results.clone(),
                pending_inputs: orchestrator.pending_inputs.clone(),
                pending_fallbacks: orchestrator.pending_fallbacks.clone(),
                allowed_roots: Arc::new(Mutex::new(allowed_roots)),
                shares: shares.clone(),
                share_port,
                orchestrator: orchestrator.clone(),
                control_events: orchestrator.control_sender(),
                pty_events: orchestrator.pty_sender(),
            });
            forward_core_events(app.handle(), &orchestrator);
            if let Some(listener) = share_listener {
                spawn_share_server(listener, shares, store, orchestrator, control_token);
            }

            // 1s ticker: derived statuses + CANVAS_RESULT returns + diffs.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut last: HashMap<String, &'static str> = HashMap::new();
                let mut last_diff: HashMap<String, (Vec<String>, String)> = HashMap::new();
                let mut last_line: HashMap<String, String> = HashMap::new();
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
                            &ServerMsg::Result {
                                edge_id,
                                summary,
                                files,
                            },
                        );
                    }

                    // Activity pass: broadcast the agent's latest PTY line
                    // when it changed — the node card previews live output.
                    for id in state.agents.ids() {
                        let line = state
                            .agents
                            .tail_text(&id)
                            .and_then(|t| canvasd::agent::last_visible_line(&t));
                        if let Some(line) = line {
                            if last_line.get(&id) != Some(&line) {
                                last_line.insert(id.clone(), line.clone());
                                emit_control(&handle, &ServerMsg::Activity { agent_id: id, line });
                            }
                        }
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
                                        &ServerMsg::Diff {
                                            agent_id: id,
                                            files,
                                            paths,
                                            branch,
                                        },
                                    );
                                }
                            }
                        }
                    }

                    // Automation guardrail pass: alert once when a run goes
                    // silent past its idle limit (clears on fresh output).
                    for id in state.agents.automation_ids() {
                        if let (Some(meta), Some(silent)) =
                            (state.agents.automation(&id), state.agents.silent_for(&id))
                        {
                            if silent >= meta.idle_secs && !meta.hang_notified {
                                state.agents.set_hang_notified(&id, true);
                                emit_control(
                                    &handle,
                                    &ServerMsg::NeedsAttention {
                                        agent_id: id,
                                        reason: format!(
                                            "silent {}s (limit {}s)",
                                            silent, meta.idle_secs
                                        ),
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
                                        emit_control(
                                            &handle,
                                            &ServerMsg::Error {
                                                agent_id: None,
                                                message: e,
                                            },
                                        );
                                    }
                                }
                            }
                            Err(e) => {
                                emit_control(
                                    &handle,
                                    &ServerMsg::Error {
                                        agent_id: None,
                                        message: e.to_string(),
                                    },
                                );
                            }
                        }
                        // Loops pass: interval loops due + 'match' loops
                        // edge-detected on the PTY tail.
                        if let Ok(rows) = state.store.loops_interval_due() {
                            for row in &rows {
                                fire_loop(&state, row);
                            }
                        }
                        if let Ok(rows) = state.store.loops_enabled() {
                            for row in &rows {
                                if row.4 != "match" {
                                    continue;
                                }
                                let Some(pat) = row.6.as_deref() else {
                                    continue;
                                };
                                if pat.is_empty() {
                                    continue;
                                }
                                for id in loop_targets(&state, &row.1, &row.2) {
                                    let key = format!("{}:{}", row.0, id);
                                    let hit = state
                                        .agents
                                        .tail_text(&id)
                                        .map(|t| t.contains(pat))
                                        .unwrap_or(false);
                                    if hit && !match_seen.get(&key).copied().unwrap_or(false) {
                                        fire_loop(&state, row);
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
                                    for row in rows
                                        .iter()
                                        .filter(|r| r.4 == "idle" && (r.2 == id || r.2 == "*"))
                                    {
                                        if row.2 == "*"
                                            && !loop_targets(&state, &row.1, "*").contains(&id)
                                        {
                                            continue;
                                        }
                                        fire_loop(&state, row);
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
                                &ServerMsg::Status {
                                    agent_id: id,
                                    status: s,
                                },
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
            repo_tree,
            repo_read,
            repo_write,
            vault_search,
            vault_read,
            vault_peek,
            vault_asset,
            vault_append,
            vault_write,
            vault_write_asset,
            vault_delete,
            vault_rename,
            vault_graph,
            vault_discover,
            vault_register,
            open_obsidian,
            default_vault_dir,
            create_workspace,
            set_agent_chain,
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
            chrome_bookmarks,
            github_proxy,
            share_create,
            export_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running canvas");
}
