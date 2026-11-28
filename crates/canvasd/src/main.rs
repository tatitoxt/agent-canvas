//! canvasd — local daemon for the agent canvas.
//!
//! Binds to 127.0.0.1 only. Every connection requires the per-launch session
//! token (`?token=` on /ws, `Authorization: Bearer` on /api/*).

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
use canvasd::agent::{
    canvas_result_line, dirty_diff, dirty_file_count, dirty_files, last_visible_line,
    sensitive_line, worktree_branch, AgentManager,
};
use canvasd::chain::{command_cli, substitute_cli};
use canvasd::control::{generate_token, loop_to_snapshot, token_eq, uuid_like};
use canvasd::protocol;
use canvasd::store;
use protocol::{decode_pty_frame, encode_pty_frame, AgentStatus, ClientMsg, ServerMsg};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::sync::{broadcast, mpsc};
use tracing::{info, warn};

type AgentId = String;

/// Published artifacts: share id → (title, mime, bytes).
type ShareMap = Arc<std::sync::Mutex<std::collections::HashMap<String, (String, String, Vec<u8>)>>>;

#[derive(Clone)]
struct AppState {
    token: String,
    events: broadcast::Sender<Event>,
    agents: Arc<AgentManager>,
    store: Arc<store::Store>,
    repo_root: PathBuf,
    /// origin remote normalized to an https URL (None when the board
    /// repo has no remote — e.g. a scratch dir).
    repo_url: Option<String>,
    /// agent_id → delegation edge_id: which child still owes a CANVAS_RESULT.
    pending_results: Arc<std::sync::Mutex<std::collections::HashMap<String, String>>>,
    pending_fallbacks: Arc<std::sync::Mutex<std::collections::HashMap<String, FallbackState>>>,
    /// agent_id → held PTY input bytes a supervised agent needs approval for.
    pending_inputs: Arc<std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>>,
    /// Published artifacts: share id → (title, mime, bytes). Served at
    /// /share/{id} without auth — the 128-bit id is the capability.
    shares: ShareMap,
    /// Canonicalized roots file operations may touch — the board repo
    /// plus anything listed in the user config `allowed-roots` file.
    /// Mutex because mounting a vault from the UI appends at runtime.
    allowed_roots: std::sync::Arc<std::sync::Mutex<Vec<PathBuf>>>,
}

/// Where extra sandbox roots are persisted — the USER's config dir,
/// never the checkout: a cloned repo must never be able to grant
/// itself access to the operator's disk.
fn allowed_roots_list_path(repo_root: &std::path::Path) -> PathBuf {
    canvasd::paths::canvas_config_dir()
        .map(|d| d.join("allowed-roots"))
        .unwrap_or_else(|| repo_root.join(".canvas").join("allowed-roots.local"))
}

#[cfg(not(windows))]
const SANDBOX_HINT: &str = " — open the vault from the Vault panel to grant access, or add its path to ~/.config/canvas/allowed-roots (one per line)";
#[cfg(windows)]
const SANDBOX_HINT: &str = " — open the vault from the Vault panel to grant access, or add its path to %APPDATA%\\canvas\\allowed-roots (one per line)";

/// Is `canon_root` inside an allowed root?
fn root_allowed(state: &AppState, canon_root: &std::path::Path) -> bool {
    state
        .allowed_roots
        .lock()
        .unwrap()
        .iter()
        .any(|ar| canon_root.starts_with(ar))
}

/// Persist a newly mounted vault root: append to the user config file
/// (newline-guarded, deduped) and to the in-memory list. The mount
/// gesture comes over the authenticated control socket from the user's
/// own UI — file operations themselves never trigger this.
fn persist_allowed_root(state: &AppState, canon_root: &std::path::Path) {
    {
        let mut roots = state.allowed_roots.lock().unwrap();
        if roots.iter().any(|ar| canon_root.starts_with(ar)) {
            return;
        }
        roots.push(canon_root.to_path_buf());
    }
    // Persistence requires the operator's user config dir — the fallback
    // path lives inside the checkout, and a repo-controlled symlink there
    // would redirect the write into an unrelated user file. No resolvable
    // config dir → the grant stays in-memory for this boot only.
    let Some(config) = canvasd::paths::canvas_config_dir() else {
        return;
    };
    // A newline in the path would smuggle extra grant lines into the
    // config on the next boot — pathological, but cheap to refuse.
    let line = canon_root.to_string_lossy().to_string();
    if line.contains('\n') || line.contains('\r') {
        return;
    }
    let list = config.join("allowed-roots");
    if let Some(parent) = list.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let prev = std::fs::read_to_string(&list).unwrap_or_default();
    let already = prev.lines().any(|l| l.trim() == line);
    if !already {
        let mut text = prev;
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&line);
        text.push('\n');
        let _ = std::fs::write(&list, text);
    }
}

/// Deska-style sandbox: every vault path is validated in the daemon,
/// never trusted from the client.
///
/// - `path` must be relative — an absolute path would make `root.join`
///   REPLACE the root, escaping the vault entirely.
/// - no `..` components — no traversal above the root.
/// - the canonicalized root must sit inside an allowed root
///   (`.canvas/allowed-roots`, one per line, plus the board repo itself).
/// - the target, canonicalized through its deepest existing ancestor,
///   must stay inside the canonical root — kills symlink escapes, which
///   the naive `!path.contains("..")` check never saw.
fn vault_sandbox_resolve(state: &AppState, dir: &str, path: &str) -> Result<PathBuf, String> {
    let rel = std::path::Path::new(path);
    if rel.is_absolute() {
        return Err("access denied: absolute paths are not allowed".into());
    }
    // Reject roots/prefixes component-wise too, not just `..`: on Windows
    // `\foo` carries a RootDir without being `is_absolute` (no drive
    // prefix), and `C:` is a drive-relative Prefix — both would bend the
    // probe away from the vault root before the final containment check
    // caught them. Same rule sanitize_relpath already applies to cwd.
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
    let canon_root = canon_through_missing(std::path::Path::new(dir))
        .ok_or_else(|| format!("access denied: vault root not found: {dir}"))?;
    if !root_allowed(state, &canon_root) {
        return Err(format!(
            "access denied: path is outside allowed directories{SANDBOX_HINT}"
        ));
    }
    // Walk the components that exist: any symlink in the chain must
    // resolve inside the vault. `symlink_metadata` (lstat) sees dangling
    // links that `exists()` misses — a dangling symlink is never a
    // legitimate write target, because the write would follow it and
    // create the file wherever it points.
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

/// Canonicalize a path that may not fully exist yet: canonicalize the
/// deepest existing ancestor and re-append the missing tail. New vault
/// folders inside an allowed root therefore initialize fine, while a
/// missing ancestor outside every root still fails the caller's
/// allowed-roots check.
fn canon_through_missing(path: &std::path::Path) -> Option<PathBuf> {
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

fn vault_sandbox_dir(state: &AppState, dir: &str) -> Result<PathBuf, String> {
    let canon_root = canon_through_missing(std::path::Path::new(dir))
        .ok_or_else(|| format!("access denied: vault root not found: {dir}"))?;
    if root_allowed(state, &canon_root) {
        Ok(canon_root)
    } else {
        Err(format!(
            "access denied: path is outside allowed directories{SANDBOX_HINT}"
        ))
    }
}

/// Resolve a repository directory for Code Editor writes. Vault roots are
/// intentionally broader than writable repository roots, so write access is
/// limited to the board repo and repos explicitly registered as workspaces.
fn registered_repo_dir(
    repo_root: &std::path::Path,
    store: &store::Store,
    dir: &str,
) -> Result<PathBuf, String> {
    // Tilde expansion is portable: HOME is typically unset on Windows,
    // where the profile folder is the home — see paths::expand_tilde.
    let requested = canvasd::paths::expand_tilde(dir);
    let mut roots = vec![repo_root.to_path_buf()];
    let workspaces = store.workspaces_snapshot().map_err(|e| e.to_string())?;
    roots.extend(
        workspaces
            .into_iter()
            .map(|(_, _, repo, _)| canvasd::paths::expand_tilde(&repo)),
    );

    for root in roots {
        let Ok(root) = std::fs::canonicalize(root) else {
            continue;
        };
        let candidate = if requested.is_absolute() {
            requested.clone()
        } else {
            root.join(&requested)
        };
        let Ok(candidate) = std::fs::canonicalize(candidate) else {
            continue;
        };
        if candidate.starts_with(&root) && candidate.is_dir() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "access denied: repository is not registered or not found: {dir}"
    ))
}

/// Write PTY input honoring the supervised-input gate: `supervised`
/// agents hold destructive-looking input until the operator approves.
/// Returns true when the payload was written (or held) without error.
fn gated_write(state: &Arc<AppState>, agent_id: &str, bytes: &[u8]) -> bool {
    let supervised = state
        .agents
        .permission(agent_id)
        .map(|p| p == "supervised")
        .unwrap_or(false);
    if supervised {
        if let Some(line) = sensitive_line(bytes) {
            // Automation guardrail: a run whose approval policy is "deny"
            // never waits on a human — the input is dropped and reported.
            if state
                .agents
                .automation(agent_id)
                .map(|m| m.deny_approvals)
                .unwrap_or(false)
            {
                let _ = state.events.send(Event::Control(ServerMsg::NeedsAttention {
                    agent_id: agent_id.to_string(),
                    reason: format!("automation policy denied: {line}"),
                }));
                return true;
            }
            state
                .pending_inputs
                .lock()
                .unwrap()
                .insert(agent_id.to_string(), bytes.to_vec());
            let _ = state.events.send(Event::Control(ServerMsg::NeedsApproval {
                agent_id: agent_id.to_string(),
                line,
            }));
            return true;
        }
    }
    state.agents.write(agent_id, bytes).is_ok()
}

/// Wire event: control (JSON) or raw PTY output (binary).
#[derive(Debug, Clone)]
#[allow(clippy::large_enum_variant)]
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
    Json(Health {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// GET /api/github/{*rest}?query — proxies the GitHub REST API so the web
/// client never hits anonymous rate limits: `gh api` when the CLI is
/// installed (it carries auth), unauthenticated curl otherwise. Returns the
/// upstream body verbatim.
async fn github_proxy(
    axum::extract::Path(rest): axum::extract::Path<String>,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
) -> axum::response::Response {
    let path = match &query {
        Some(q) => format!("{rest}?{q}"),
        None => rest.clone(),
    };
    async fn run(cmd: &str, args: Vec<String>) -> Option<std::process::Output> {
        tokio::process::Command::new(cmd)
            .args(&args)
            .output()
            .await
            .ok()
    }
    let out = run("gh", vec!["api".into(), path.clone()]).await;
    let body = match out {
        Some(o) if o.status.success() => o.stdout,
        _ => run(
            "curl",
            vec![
                "-sf".into(),
                "-H".into(),
                "Accept: application/vnd.github+json".into(),
                format!("https://api.github.com/{path}"),
            ],
        )
        .await
        .filter(|o| o.status.success())
        .map(|o| o.stdout)
        .unwrap_or_else(|| {
            br#"{"message":"github unavailable - install gh or retry later"}"#.to_vec()
        }),
    };
    (
        [(header::CONTENT_TYPE, "application/json")],
        axum::body::Body::from(body),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
struct ShareIn {
    title: String,
    mime: String,
    b64: String,
}

/// POST /api/share — publish an artifact so anyone with the link can open it
/// while the daemon runs (Deska's "publish by link"). Body is base64 bytes,
/// capped at 8 MB.
async fn share_create(
    State(state): State<Arc<AppState>>,
    Json(input): Json<ShareIn>,
) -> axum::response::Response {
    let body = match canvasd::share::decode_body(&input.b64) {
        Ok(b) => b,
        Err(canvasd::share::DecodeError::TooLarge) => {
            return (StatusCode::PAYLOAD_TOO_LARGE, "share too large").into_response()
        }
        Err(canvasd::share::DecodeError::BadBase64) => {
            return (StatusCode::BAD_REQUEST, "bad base64").into_response()
        }
    };
    let id = canvasd::share::new_share_id();
    let title = canvasd::share::normalize_title(&input.title);
    let mime = canvasd::share::normalize_mime(&input.mime);
    state
        .shares
        .lock()
        .unwrap()
        .insert(id.clone(), (title, mime, body));
    Json(serde_json::json!({ "id": id, "url": format!("/share/{id}") })).into_response()
}

/// GET /api/export — full daemon state dump (boards, layout, delegations,
/// agents, workspaces) as JSON. The portable answer to "do my canvases
/// persist" — restore happens by moving .canvas/board.db between machines.
async fn export_state(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(canvasd::export::state_json(&state.store))
}

/// GET /share/{id} — public endpoint (no token): the unguessable id is the
/// capability. Streams the stored bytes with their mime type.
async fn share_get(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> axum::response::Response {
    let doc = state.shares.lock().unwrap().get(&id).cloned();
    match doc {
        Some((title, mime, body)) => (
            [
                (header::CONTENT_TYPE, mime),
                (
                    header::CONTENT_DISPOSITION,
                    canvasd::share::content_disposition(&title),
                ),
            ],
            axum::body::Body::from(body),
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            "share not found — it lives only while the app runs",
        )
            .into_response(),
    }
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

/// Recursively list `.md` files under a vault root. Skips dotfiles,
/// node_modules/target/dist/build, never follows symlinks, caps the
/// traversal at 5000 pending+found paths.
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
                // Never follow symlinks — a vault must not escape
                // itself through a linked dir.
                if e.file_type().map(|t| t.is_symlink()).unwrap_or(true) {
                    continue;
                }
                if p.is_dir() && stack.len() + entries.len() < 5000 {
                    stack.push(p);
                } else if name.ends_with(".md") || is_vault_image(&name) {
                    if let Ok(rel) = p.strip_prefix(root) {
                        // Wire format is forward-slash on every platform —
                        // the client splits/matches on `/` (Obsidian style).
                        entries.push(canvasd::paths::wire_rel_path(rel));
                    }
                }
            }
        }
    }
    entries.sort();
    entries
}

/// Recursively list ALL files under a repo root for the explorer panel.
/// Same discipline as the vault walker: no dotfiles, no heavy build
/// dirs, never follow symlinks, capped.
fn repo_tree_entries(root: &PathBuf) -> Vec<String> {
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
                if p.is_dir() && stack.len() + entries.len() < 6000 {
                    stack.push(p);
                } else if p.is_file() {
                    if let Ok(rel) = p.strip_prefix(root) {
                        entries.push(canvasd::paths::wire_rel_path(rel));
                    }
                }
            }
        }
    }
    entries.sort();
    entries
}

fn atomic_replace_repo_file(path: &std::path::Path, text: &str) -> Result<(), String> {
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
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("write failed: {error}")),
        }
    }
    Err("write failed: could not allocate temporary file".into())
}

/// Extract link targets from markdown text: `[[name|alias]]` → `name`,
/// `](path.md)` → `path`. No regex dep — manual scanning.
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

/// Fallback chain for a spawn: the workspace's configured chain when it has
/// one, else the daemon-wide auto-detected one. The CLI itself leads the
/// chain even when the configuration omits it — the resolution logic lives
/// in `canvasd::chain` so the Tauri shell falls back identically.
fn chain_for(state: &Arc<AppState>, workspace_id: Option<&str>, cli: &str) -> Vec<String> {
    let configured = workspace_id.and_then(|w| state.store.workspace_chain(w).ok().flatten());
    canvasd::chain::chain_for_spawn(configured, cli)
}

/// Per-spawn retry state: when a fresh PTY dies within seconds, the next
/// chain candidate gets a chance with the same parameters.
struct FallbackState {
    spawned_at: std::time::Instant,
    name: String,
    command: String,
    cwd: String,
    workspace_id: Option<String>,
    permission: String,
    board_id: Option<String>,
    account_id: Option<String>,
    /// Automation guardrails (idle alert secs, deny-approvals policy) —
    /// re-applied to every replacement so a fallback keeps the original's
    /// automation constraints.
    automation: Option<(u64, bool)>,
    /// CLIs not yet tried, in order.
    remaining: Vec<String>,
    /// Task text queued for the original PTY — re-injected into the
    /// replacement so a fallback never silently drops the user's task.
    /// Never cleared on a successful write: fallback only fires when the
    /// original DIED within seconds of launch, so its copy of the task
    /// never completed and re-running it is the correct retry semantics.
    initial_input: Option<String>,
}

/// Registration-completion gate handed back from [`spawn_agent`]. The
/// agent's exit watcher waits on it before processing any exit, so a PTY
/// dying during spawn can never outrun the registration of its fallback
/// state, automation metadata, or delegation ticket. Callers fire it once
/// their own post-spawn registration completes; dropping it (error paths)
/// releases the watcher too — a permanently-blocked watcher would never
/// mark the agent exited at all.
type RegistrationGate = tokio::sync::oneshot::Sender<()>;

/// `spawn_agent` (standalone node) and `delegate` (edge-owned child).
/// Memory file for a node: the board repo's `.canvas/memory.md`, or the
/// workspace's repo memory when node_id is a workspace. Every agent
/// spawned in that scope gets CANVAS_MEMORY pointing at it.
fn memory_path(state: &Arc<AppState>, node_id: &str) -> PathBuf {
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

/// A workspace-scoped agent runs inside that workspace's repo, not the
/// daemon's default board repo.
#[allow(clippy::too_many_arguments)]
fn spawn_agent(
    state: &Arc<AppState>,
    name: &str,
    command: &str,
    cwd: &str,
    workspace_id: Option<&str>,
    permission: &str,
    board_id: Option<&str>,
    account_id: Option<&str>,
    initial_input: Option<&str>,
    chain_override: Option<Vec<String>>,
    automation: Option<(u64, bool)>,
) -> Result<(String, Option<String>, RegistrationGate)> {
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<(String, Vec<u8>)>();
    let (exit_tx, mut exit_rx) = mpsc::unbounded_channel::<String>();
    // The exit watcher waits on this gate before processing any exit —
    // the PTY reader can report a death before spawn even returns, and
    // without the gate that exit would be handled with fallback state,
    // automation metadata, or delegation tickets not yet registered.
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
    let ev = state.events.clone();
    tokio::spawn(async move {
        while let Some((id, bytes)) = out_rx.recv().await {
            let _ = ev.send(Event::PtyOutput(id, bytes));
        }
    });
    let state_fb = state.clone();
    let ev2 = state.events.clone();
    let store2 = state.store.clone();
    let repo_root2 = state.repo_root.clone();
    let pending = state.pending_results.clone();
    let inputs2 = state.pending_inputs.clone();
    let agents3 = state.agents.clone();
    tokio::spawn(async move {
        // Hold exit processing until the spawning call signals that all
        // registration for this agent is complete. Dropping the sender
        // (spawn error paths) releases the watcher too.
        let _ = ready_rx.await;
        while let Some(id) = exit_rx.recv().await {
            // Chain fallback: a PTY dying within seconds of launch never gave
            // the user a working agent — retry the next CLI with the same
            // parameters and announce the replacement.
            let fb = state_fb.pending_fallbacks.lock().unwrap().remove(&id);
            if let Some(fb) = fb {
                if fb.spawned_at.elapsed() < std::time::Duration::from_secs(5)
                    && !fb.remaining.is_empty()
                {
                    let next = fb.remaining[0].clone();
                    let cmd = substitute_cli(&fb.command, &next);
                    let nm = fb.name.clone();
                    let st3 = state_fb.clone();
                    let fb_cmd = cmd.clone();
                    let fb_nm = nm.clone();
                    if let Ok((new_id, new_board, new_ready)) = spawn_agent(
                        &st3,
                        &nm,
                        &cmd,
                        &fb.cwd,
                        fb.workspace_id.as_deref(),
                        &fb.permission,
                        fb.board_id.as_deref(),
                        fb.account_id.as_deref(),
                        fb.initial_input.as_deref(),
                        // The replacement's chain is what remained — never
                        // recomputed, so a fully-dead chain ends instead of
                        // looping through the same failing CLIs forever.
                        Some(fb.remaining.clone()),
                        // Automation guardrails ride the fallback state —
                        // the replacement keeps the original's idle alert
                        // and approval policy instead of losing them with
                        // the dead agent's id.
                        fb.automation,
                    ) {
                        if let Some(text) = fb.initial_input.clone() {
                            let st4 = state_fb.clone();
                            let target = new_id.clone();
                            tokio::spawn(async move {
                                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                                // gated_write, not raw input: a supervised
                                // automation that falls back keeps its
                                // approval gate on the replacement too.
                                let mut data = text.into_bytes();
                                data.push(b'\r');
                                gated_write(&st4, &target, &data);
                            });
                        }
                        // A delegation awaiting this child's result moves to
                        // the replacement — otherwise the original exit marks
                        // the ticket failed and the parent's result is lost.
                        // The lock guard must drop before re-locking — an
                        // if-let keeps the first guard alive through its
                        // body and std::sync::Mutex is not reentrant.
                        let edge = state_fb.pending_results.lock().unwrap().remove(&id);
                        if let Some(edge) = edge {
                            // The replacement may have exited in the microseconds
                            // since spawn — its exit runs on a different watcher,
                            // so a ticket keyed to it would strand in flight.
                            // Already dead: fail the ticket now instead.
                            let replacement_live = state_fb
                                .agents
                                .statuses()
                                .iter()
                                .any(|(aid, st)| aid == &new_id && *st != "exited");
                            if replacement_live {
                                state_fb
                                    .pending_results
                                    .lock()
                                    .unwrap()
                                    .insert(new_id.clone(), edge);
                            } else {
                                let _ = store2.delegation_failed(&edge, 0);
                                let _ = ev2.send(Event::Control(ServerMsg::DelegationFailed {
                                    edge_id: edge,
                                }));
                            }
                        }
                        // Registration for the replacement is complete
                        // (fallback state inside spawn_agent, ticket transfer
                        // above) — release its exit watcher.
                        let _ = new_ready.send(());
                        let wt = state_fb
                            .agents
                            .worktree(&new_id)
                            .map(|p| p.to_string_lossy().to_string());
                        let _ = state_fb.events.send(Event::Control(ServerMsg::Spawned {
                            agent_id: new_id,
                            name: fb_nm,
                            command: fb_cmd,
                            permission: fb.permission.clone(),
                            workspace_id: fb.workspace_id.clone(),
                            board_id: new_board.or(fb.board_id.clone()),
                            fallback_from: Some(command_cli(&fb.command).to_string()),
                            worktree: wt,
                        }));
                    }
                }
            }
            let _ = store2.agent_status(&id, "exited");
            // Held input keyed to a dead agent can never be approved —
            // drop it. On fallback the re-injection re-holds against the
            // replacement through the gate.
            inputs2.lock().unwrap().remove(&id);
            // A dead agent is never "hung": drop its automation guardrails
            // so the hang ticker doesn't fire a spurious idle alert for it.
            // On fallback the guardrails already ride the replacement.
            agents3.clear_automation(&id);
            // Final result scan: a fast child may print CANVAS_RESULT and
            // exit inside the same second — before the ticker runs. The
            // transcript on disk still has the line.
            if let Some(edge_id) = pending.lock().unwrap().remove(&id) {
                let summary = agents3
                    .scrollback(&id)
                    .map(|b| String::from_utf8_lossy(&b).to_string())
                    .and_then(|t| canvas_result_line(&t))
                    .map(|s| s.trim().to_string());
                // Files the child left dirty in its worktree — kept on
                // the ticket for the failed path too.
                let files = store2
                    .agent_worktree_abs(&id, &repo_root2)
                    .ok()
                    .flatten()
                    .map(|w| dirty_file_count(&w))
                    .unwrap_or(0);
                if let Some(summary) = summary {
                    let _ = store2.delegation_resolved(&edge_id, &summary, files);
                    let _ = ev2.send(Event::Control(ServerMsg::Result {
                        edge_id,
                        summary,
                        files,
                    }));
                } else {
                    // Exited without a result: close the ticket so the
                    // board stops showing it as in flight.
                    let _ = store2.delegation_failed(&edge_id, files);
                    let _ = ev2.send(Event::Control(ServerMsg::DelegationFailed { edge_id }));
                }
            }
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
    // Named account: give the CLI its own config dir so several sign-ins
    // of the same agent coexist (e.g. two Codex accounts side by side).
    let pty_env: Vec<(String, String)> = account_id
        .and_then(|a| state.store.account_record(a).ok().flatten())
        .and_then(|(cli, _label, dir, env)| {
            let abs = state.repo_root.join(&dir);
            let _ = std::fs::create_dir_all(&abs);
            // An account may name its own env var (e.g. MYCLI_HOME) —
            // otherwise fall back to the CLI's known config-dir key.
            let key = env.or_else(|| canvasd::agent::account_env_key(&cli).map(str::to_string));
            key.map(|k| vec![(k, abs.to_string_lossy().to_string())])
        })
        .unwrap_or_default();
    // Workspace (or board) memory — the agent reads/appends shared notes.
    let mem_scope = workspace_id.unwrap_or("main");
    let mem_path = memory_path(state, mem_scope);
    let _ = std::fs::create_dir_all(mem_path.parent().unwrap());
    if !mem_path.exists() {
        let _ = std::fs::write(&mem_path, "");
    }
    let mut pty_env = pty_env;
    pty_env.push((
        "CANVAS_MEMORY".to_string(),
        mem_path.to_string_lossy().to_string(),
    ));
    // Fallback chain: sync spawn failures (missing binary, bad exec) retry
    // with the next CLI; early PTY deaths retry from the exit watcher.
    let chain =
        chain_override.unwrap_or_else(|| chain_for(state, workspace_id, command_cli(command)));
    let mut remaining: Vec<String> = chain.iter().skip(1).cloned().collect();
    let mut cmd_attempt = command.to_string();
    let id = loop {
        match state.agents.spawn(
            name,
            &cmd_attempt,
            cwd,
            &repo_root,
            permission,
            out_tx.clone(),
            exit_tx.clone(),
            &pty_env,
        ) {
            Ok(id) => break id,
            Err(e) => {
                if let Some(next) = remaining.first().cloned() {
                    warn!(error = %e, cli = %command_cli(&cmd_attempt), fallback = %next, "spawn failed — trying fallback CLI");
                    cmd_attempt = substitute_cli(&cmd_attempt, &next);
                    remaining.remove(0);
                    continue;
                }
                return Err(e);
            }
        }
    };
    // Automation guardrails attach here — inside the spawn, before the
    // registration gate fires — so even a PTY dying in the meantime is
    // handled with the policy in place, and the fallback state carries it
    // to any replacement.
    if let Some((idle_secs, deny)) = automation {
        state.agents.set_automation(&id, idle_secs, deny);
    }
    if !remaining.is_empty() {
        state.pending_fallbacks.lock().unwrap().insert(
            id.clone(),
            FallbackState {
                spawned_at: std::time::Instant::now(),
                name: name.to_string(),
                command: cmd_attempt.clone(),
                cwd: cwd.to_string(),
                workspace_id: workspace_id.map(str::to_string),
                permission: permission.to_string(),
                board_id: board_id.map(str::to_string),
                account_id: account_id.map(str::to_string),
                automation,
                remaining,
                initial_input: initial_input.map(str::to_string),
            },
        );
    }
    // The Spawned announcement carries the command that actually launched,
    // which may be a fallback substitute of the requested one.
    let command = cmd_attempt.as_str();
    // Board: explicit, else the workspace's board, else 'main'.
    let board = board_id
        .map(|b| b.to_string())
        .or_else(|| workspace_id.and_then(|w| state.store.workspace_board(w).ok().flatten()));
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
    Ok((id, board, ready_tx))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    if !token_eq(&q.token, &state.token) {
        return (StatusCode::UNAUTHORIZED, "invalid session token").into_response();
    }
    ws.max_message_size(8 * 1024 * 1024)
        // Keep frame == message cap: some browsers (Firefox) send ws payloads
        // as a single frame, so a smaller frame cap rejects valid uploads.
        .max_frame_size(8 * 1024 * 1024)
        .on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    let mut rx = state.events.subscribe();
    info!("websocket client connected");

    // Replay board state first: one shared snapshot builder serves canvasd,
    // the native shell, and the native control socket without wire drift.
    match canvasd::control::snapshot_message(
        &state.store,
        &state.agents,
        &state.repo_root,
        state.repo_url.clone(),
        canvasd::control::approval_lines(&state.pending_inputs),
    ) {
        Ok(snapshot) => {
            if let Ok(text) = serde_json::to_string(&snapshot) {
                let _ = socket.send(Message::Text(text.into())).await;
            }
        }
        Err(e) => {
            warn!(error = %e, "failed to build board snapshot");
        }
    }
    // Transcript replay: buffered PTY scrollback so a reconnected
    // terminal shows its history instead of a blank screen.
    for id in state.agents.list() {
        if let Some(buf) = state.agents.scrollback(&id) {
            if !buf.is_empty() {
                let _ = socket
                    .send(Message::Binary(encode_pty_frame(&id, &buf).into()))
                    .await;
            }
        }
    }

    // Fan-out task: broadcast events → socket (JSON for control, binary for PTY).
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(256);
    let writer_state = state.clone();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(Event::Control(msg)) => {
                    let Ok(text) = serde_json::to_string(&msg) else {
                        continue;
                    };
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
                        let _ = gated_write(&state, id, payload);
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

fn handle_client_msg(text: &str, state: &Arc<AppState>, send_control: &impl Fn(ServerMsg)) {
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
        ClientMsg::CreateBoard { name } => {
            let id = uuid_like();
            match state.store.board_created(&id, &name) {
                Ok(()) => send_control(ServerMsg::BoardCreated { board_id: id, name }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::MoveToBoard { node_id, board_id } => {
            match state.store.node_moved_to_board(&node_id, &board_id) {
                Ok(true) => send_control(ServerMsg::BoardMoved { node_id, board_id }),
                Ok(false) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: "no such node".to_string(),
                }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::RenameNode { node_id, name } => {
            match state.store.node_renamed(&node_id, &name) {
                Ok(true) => send_control(ServerMsg::NodeRenamed { node_id, name }),
                _ => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: "no such node".to_string(),
                }),
            }
        }
        ClientMsg::SetPermission {
            agent_id,
            permission,
        } => {
            let level = protocol::normalize_permission(Some(&permission));
            state.agents.set_permission(&agent_id, level);
            if let Err(e) = state.store.set_agent_permission(&agent_id, level) {
                warn!(%e, "persist permission");
            }
            send_control(ServerMsg::PermissionChanged {
                agent_id,
                permission: level.to_string(),
            });
        }
        ClientMsg::RenameBoard { board_id, name } => {
            match state.store.board_renamed(&board_id, &name) {
                Ok(true) => send_control(ServerMsg::BoardRenamed { board_id, name }),
                _ => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: "no such board".to_string(),
                }),
            }
        }
        ClientMsg::DeleteBoard { board_id } => match state.store.board_deleted(&board_id) {
            Ok(true) => send_control(ServerMsg::BoardDeleted { board_id }),
            _ => send_control(ServerMsg::Error {
                agent_id: None,
                message: "board not empty or is main".to_string(),
            }),
        },
        ClientMsg::DeleteDelegation { edge_id } => match state.store.delegation_delete(&edge_id) {
            Ok(true) => send_control(ServerMsg::DelegationRemoved { edge_id }),
            _ => send_control(ServerMsg::Error {
                agent_id: None,
                message: "no such delegation".to_string(),
            }),
        },
        ClientMsg::CreateWorkspace {
            name,
            repo,
            board_id,
        } => {
            // Registering a workspace is an explicit operator gesture —
            // its repo joins the sandbox so the explorer and vault ops
            // can browse it.
            if let Some(canon) = canon_through_missing(std::path::Path::new(&repo)) {
                if !root_allowed(state, &canon) {
                    persist_allowed_root(state, &canon);
                }
            }
            // Path validated on spawn side; a workspace is just a named
            // container + its repo.
            let id = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
            match state
                .store
                .workspace_created(&id, &name, &repo, board_id.as_deref())
            {
                Ok(()) => send_control(ServerMsg::WorkspaceCreated {
                    workspace_id: id,
                    name,
                    repo,
                    board_id,
                }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::SetAgentChain {
            workspace_id,
            chain,
        } => {
            if let Err(e) = state.store.set_workspace_chain(&workspace_id, &chain) {
                send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                });
            }
        }
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
            let level = protocol::normalize_permission(permission.as_deref());
            match spawn_agent(
                state,
                &name,
                &command,
                &cwd,
                workspace_id.as_deref(),
                level,
                board_id.as_deref(),
                account_id.as_deref(),
                initial_input.as_deref(),
                None,
                None,
            ) {
                Ok((id, board, ready)) => {
                    // Quick request: type the task into the fresh PTY once the
                    // CLI has had a moment to boot (CLIs redraw their TUI on
                    // stdin, so arriving text just queues as the first line).
                    // The copy in the fallback state is NOT cleared on write —
                    // fallback only fires when the original died within seconds
                    // of launch, so its copy of the task never completed and
                    // re-running it on the replacement is the correct retry
                    // semantics.
                    if let Some(text) = initial_input {
                        let agents = state.agents.clone();
                        let target = id.clone();
                        tokio::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                            let mut data = text.into_bytes();
                            data.push(b'\r');
                            let _ = agents.write(&target, &data);
                        });
                    }
                    // spawn_agent registers nothing beyond what the spawn
                    // helper already did — release the exit watcher.
                    let _ = ready.send(());
                    let wt = state
                        .agents
                        .worktree(&id)
                        .map(|p| p.to_string_lossy().to_string());
                    send_control(ServerMsg::Spawned {
                        agent_id: id,
                        name,
                        command,
                        permission: level.to_string(),
                        workspace_id,
                        board_id: board,
                        fallback_from: None,
                        worktree: wt,
                    });
                }
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
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
            // A delegation IS a spawn + a persisted edge. The edge returns
            // when the child's PTY prints `CANVAS_RESULT: <summary>`.
            let parent_level = state.store.agent_permission(&from).ok().flatten();
            let requested = protocol::normalize_permission(permission.as_deref());
            let level = protocol::clamp_to_parent(requested, parent_level.as_deref());
            // The child lands on the requested board, else its parent's
            // (orchestrator nodes aren't agents — they carry theirs over).
            let parent_board = board_id.or(state.store.agent_board(&from).ok().flatten());
            match spawn_agent(
                state,
                &name,
                &command,
                &cwd,
                workspace_id.as_deref(),
                level,
                parent_board.as_deref(),
                account_id.as_deref(),
                initial_input.as_deref(),
                None,
                None,
            ) {
                Ok((id, board, ready)) => {
                    let edge_id = format!("edge-{}", &id[..8.min(id.len())]);
                    if let Err(e) = state.store.delegation_created(&edge_id, &from, &id, &task) {
                        warn!(error = %e, "failed to persist delegation");
                    }
                    state
                        .pending_results
                        .lock()
                        .unwrap()
                        .insert(id.clone(), edge_id.clone());
                    // The delegation ticket is the registration the exit
                    // watcher needs — release it only now that the ticket
                    // is in place.
                    let _ = ready.send(());
                    if let Some(text) = initial_input {
                        // Type the brief once the CLI has booted (same delay
                        // as spawn_agent). The fallback-state copy is NOT
                        // cleared on write — the original dying within
                        // seconds of launch means its copy of the brief never
                        // completed, so re-running it on the replacement is
                        // correct.
                        let agents = state.agents.clone();
                        let target = id.clone();
                        tokio::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                            let mut data = text.into_bytes();
                            data.push(b'\r');
                            let _ = agents.write(&target, &data);
                        });
                    }
                    let wt = state
                        .agents
                        .worktree(&id)
                        .map(|p| p.to_string_lossy().to_string());
                    send_control(ServerMsg::Spawned {
                        agent_id: id.clone(),
                        name,
                        command,
                        permission: level.to_string(),
                        workspace_id: workspace_id.clone(),
                        board_id: board,
                        fallback_from: None,
                        worktree: wt,
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
                    if !gated_write(state, &agent_id, &bytes) {
                        send_control(ServerMsg::Error {
                            agent_id: Some(agent_id),
                            message: "pty write failed".to_string(),
                        });
                    }
                }
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: Some(agent_id),
                    message: format!("bad base64: {e}"),
                }),
            }
        }
        ClientMsg::ApproveInput { agent_id } => {
            let payload = state.pending_inputs.lock().unwrap().remove(&agent_id);
            match payload {
                Some(bytes) => {
                    if let Err(e) = state.agents.write(&agent_id, &bytes) {
                        send_control(ServerMsg::Error {
                            agent_id: Some(agent_id),
                            message: e.to_string(),
                        });
                    }
                }
                None => send_control(ServerMsg::Error {
                    agent_id: Some(agent_id),
                    message: "no pending input to approve".to_string(),
                }),
            }
        }
        ClientMsg::DenyInput { agent_id } => {
            state.pending_inputs.lock().unwrap().remove(&agent_id);
            send_control(ServerMsg::Error {
                agent_id: Some(agent_id),
                message: "input denied by operator".to_string(),
            });
        }
        ClientMsg::PtyResize {
            agent_id,
            cols,
            rows,
        } => {
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
                "kill" => {
                    // A deliberate kill is operator intent — never retry.
                    // Disarm BEFORE signaling the PTY: the exit watcher fires
                    // as soon as the process closes and would claim the retry
                    // while the kill was still returning.
                    state.pending_fallbacks.lock().unwrap().remove(&agent_id);
                    match state.agents.kill(&agent_id) {
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
                    }
                }
                "forget" => {
                    // Remove an (exited) agent from the db so the next
                    // snapshot stops resurrecting it — "clear done".
                    // Forget is operator intent too — a live agent cleared
                    // within seconds of launch must not respawn as a fallback.
                    // Disarm BEFORE the kill so the exit watcher can't claim
                    // the retry in between.
                    state.pending_fallbacks.lock().unwrap().remove(&agent_id);
                    // no-op if the agent is already gone
                    let _ = state.agents.kill(&agent_id);
                    match state.store.remove_agent(&agent_id) {
                        Ok(()) => send_control(ServerMsg::Status {
                            agent_id,
                            status: AgentStatus::Exited,
                        }),
                        Err(e) => send_control(ServerMsg::Error {
                            agent_id: Some(agent_id),
                            message: e.to_string(),
                        }),
                    }
                }
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
        ClientMsg::CreateAccount { cli, label, env } => {
            let account_id = format!("acct-{}", &uuid_like()[..8]);
            let dir = format!(".canvas/accounts/{account_id}");
            if let Err(e) = std::fs::create_dir_all(state.repo_root.join(&dir)) {
                warn!(error = %e, "failed to create account dir");
            }
            match state
                .store
                .account_created(&account_id, &cli, &label, &dir, env.as_deref())
            {
                Ok(()) => send_control(ServerMsg::AccountCreated {
                    account_id,
                    cli,
                    label,
                    env,
                }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::DeleteAccount { account_id } => match state.store.account_deleted(&account_id) {
            Ok(()) => send_control(ServerMsg::AccountDeleted { account_id }),
            Err(e) => send_control(ServerMsg::Error {
                agent_id: None,
                message: e.to_string(),
            }),
        },
        ClientMsg::CreateAutomation {
            name,
            prompt,
            command,
            workspace_id,
            permission,
            idle_secs,
            on_approval,
            interval_secs,
        } => {
            let level = protocol::normalize_permission(permission.as_deref());
            let policy = match on_approval.as_deref() {
                Some("deny") => "deny",
                _ => "hold",
            };
            let idle = idle_secs.unwrap_or(300).clamp(10, 86_400);
            // 60s floor on schedules — anything faster is a spawn loop.
            let interval = interval_secs.map(|v| v.clamp(60, 86_400));
            let id = uuid_like();
            match state.store.automation_created(
                &id,
                &name,
                &prompt,
                &command,
                workspace_id.as_deref(),
                level,
                idle,
                policy,
                interval,
            ) {
                Ok(()) => send_control(ServerMsg::AutomationSaved {
                    automation: protocol::SnapshotAutomation {
                        id,
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
                }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::RunAutomation { automation_id } => {
            match state.store.automation_row(&automation_id) {
                Ok(Some(row)) => run_automation_row(state, row),
                Ok(None) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: "no such automation".into(),
                }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::DeleteAutomation { automation_id } => {
            match state.store.automation_deleted(&automation_id) {
                Ok(()) => send_control(ServerMsg::AutomationDeleted { automation_id }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::CreateLoop {
            board_id,
            target,
            instruction,
            trigger,
            interval_secs,
            pattern,
        } => {
            let trigger = match trigger.as_str() {
                "idle" | "match" => trigger.as_str(),
                _ => "interval",
            };
            let interval = interval_secs.map(|v| v.clamp(30, 86_400));
            let loop_id = format!("loop-{}", uuid_like());
            match state.store.loop_insert(
                &loop_id,
                &board_id,
                &target,
                &instruction,
                trigger,
                interval,
                pattern.as_deref(),
            ) {
                Ok(()) => send_control(ServerMsg::LoopSaved {
                    l: protocol::SnapshotLoop {
                        loop_id,
                        board_id,
                        target,
                        instruction,
                        trigger: trigger.to_string(),
                        interval_secs: interval,
                        pattern,
                        enabled: true,
                        last_fired_at: None,
                    },
                }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::RunLoop { loop_id } => {
            let row = state
                .store
                .loops_snapshot()
                .unwrap_or_default()
                .into_iter()
                .find(|r| r.0 == loop_id);
            match row {
                Some(row) => {
                    fire_loop(state, &row);
                    if let Some(l) = state
                        .store
                        .loops_snapshot()
                        .unwrap_or_default()
                        .into_iter()
                        .find(|r| r.0 == loop_id)
                        .map(loop_to_snapshot)
                    {
                        send_control(ServerMsg::LoopSaved { l });
                    }
                }
                None => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: format!("loop not found: {loop_id}"),
                }),
            }
        }
        ClientMsg::DeleteLoop { loop_id } => match state.store.loop_deleted(&loop_id) {
            Ok(()) => send_control(ServerMsg::LoopDeleted { loop_id }),
            Err(e) => send_control(ServerMsg::Error {
                agent_id: None,
                message: e.to_string(),
            }),
        },
        ClientMsg::SetLoopEnabled { loop_id, enabled } => {
            match state.store.loop_set_enabled(&loop_id, enabled) {
                Ok(()) => {
                    let row = state
                        .store
                        .loops_snapshot()
                        .unwrap_or_default()
                        .into_iter()
                        .find(|r| r.0 == loop_id);
                    if let Some(l) = row.map(loop_to_snapshot) {
                        send_control(ServerMsg::LoopSaved { l });
                    }
                }
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::PauseAll { board_id } => {
            let board = board_id.unwrap_or_else(|| "main".to_string());
            let n = state.agents.suspend_many(&loop_targets(state, &board, "*"));
            send_control(ServerMsg::Error {
                agent_id: None,
                message: format!("paused {n} agents"),
            });
        }
        ClientMsg::ResumeAll { board_id } => {
            let board = board_id.unwrap_or_else(|| "main".to_string());
            let n = state.agents.resume_many(&loop_targets(state, &board, "*"));
            send_control(ServerMsg::Error {
                agent_id: None,
                message: format!("resumed {n} agents"),
            });
        }
        ClientMsg::Transcript { agent_id } => {
            // Dead agents keep no live PTY — replay their on-disk
            // transcript through the normal output channel.
            match state.agents.scrollback(&agent_id) {
                Some(buf) if !buf.is_empty() => {
                    let _ = state.events.send(Event::PtyOutput(agent_id, buf));
                }
                _ => send_control(ServerMsg::Error {
                    agent_id: Some(agent_id),
                    message: "no transcript for agent".into(),
                }),
            }
        }
        ClientMsg::NoteUpsert {
            note_id,
            board_id,
            col,
            text,
            pos,
            due,
        } => {
            let id = note_id.unwrap_or_else(|| format!("note-{}", uuid_like()));
            let board = board_id.unwrap_or_else(|| "main".to_string());
            let p = match pos {
                Some(p) => p,
                None => state.store.note_next_pos(&board, &col).unwrap_or(0),
            };
            match state
                .store
                .note_upsert(&id, &board, &col, &text, p, due.as_deref())
            {
                Ok(()) => send_control(ServerMsg::NoteUpserted {
                    note: protocol::SnapshotNote {
                        note_id: id,
                        board_id: board,
                        col,
                        text,
                        pos: p,
                        due,
                    },
                }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::VaultList { dir } => {
            // Listing IS the mount gesture — the user pointed the Vault
            // panel at this directory, so its canonical root is
            // auto-whitelisted (persisted) before the sandbox check.
            if let Some(canon) = canon_through_missing(std::path::Path::new(&dir)) {
                if !root_allowed(state, &canon) {
                    persist_allowed_root(state, &canon);
                }
            }
            match vault_sandbox_dir(state, &dir) {
                Ok(root) => {
                    let mut entries = vault_list_entries(&root);
                    entries.truncate(2000);
                    send_control(ServerMsg::VaultListing { dir, entries });
                }
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e,
                }),
            }
        }
        ClientMsg::VaultDelete { dir, path } => {
            let file = vault_sandbox_resolve(state, &dir, &path);
            let root = vault_sandbox_dir(state, &dir);
            match (file, root) {
                (Ok(file), Ok(root)) if path.ends_with(".md") && file.is_file() => {
                    // Obsidian-style trash: move to <vault>/.trash/ instead of
                    // unlinking, so a delete is always recoverable.
                    let trash = root.join(".trash");
                    // A `.trash` symlink would move notes outside the
                    // vault — refuse the delete rather than follow it.
                    if std::fs::symlink_metadata(&trash)
                        .map(|m| m.file_type().is_symlink())
                        .unwrap_or(false)
                    {
                        send_control(ServerMsg::Error {
                            agent_id: None,
                            message: "vault delete refused: .trash is a symlink".into(),
                        });
                        return;
                    }
                    let base = file.file_name().unwrap_or_default();
                    let mut dest = trash.join(base);
                    if dest.exists() {
                        let stamp = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        let stem = file.file_stem().unwrap_or_default().to_string_lossy();
                        dest = trash.join(format!("{stem}.{stamp}.md"));
                    }
                    match std::fs::create_dir_all(&trash)
                        .and_then(|_| std::fs::rename(&file, &dest))
                    {
                        Ok(()) => {
                            let mut entries = vault_list_entries(&root);
                            entries.truncate(2000);
                            send_control(ServerMsg::VaultListing { dir, entries });
                        }
                        Err(e) => send_control(ServerMsg::Error {
                            agent_id: None,
                            message: format!("vault delete failed: {e}"),
                        }),
                    }
                }
                (Err(e), _) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e,
                }),
                (Ok(_), Err(e)) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e,
                }),
                _ => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: format!("vault delete refused: {path}"),
                }),
            }
        }
        ClientMsg::VaultGraph { dir } => {
            let root = match vault_sandbox_dir(state, &dir) {
                Ok(r) => r,
                Err(e) => {
                    send_control(ServerMsg::Error {
                        agent_id: None,
                        message: e,
                    });
                    return;
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
            send_control(ServerMsg::VaultGraph { dir, nodes, edges });
        }
        ClientMsg::VaultRename {
            dir,
            path,
            new_path,
        } => {
            let from = vault_sandbox_resolve(state, &dir, &path);
            let to = vault_sandbox_resolve(state, &dir, &new_path);
            match (from, to) {
                (Ok(from), Ok(to))
                    if path.ends_with(".md") && new_path.ends_with(".md") && from.is_file() =>
                {
                    // Never clobber: the resolved destination is canonical,
                    // so renaming onto an in-vault symlink would overwrite
                    // the LINKED file's contents, not the link.
                    if to.exists() {
                        send_control(ServerMsg::Error {
                            agent_id: None,
                            message: format!("vault rename refused: {new_path} already exists"),
                        });
                        return;
                    }
                    let result = (|| {
                        if let Some(parent) = to.parent() {
                            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                        }
                        std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
                        std::fs::read_to_string(&to).map_err(|e| e.to_string())
                    })();
                    match result {
                        Ok(text) => {
                            send_control(ServerMsg::VaultFile {
                                path: new_path,
                                text,
                            });
                            if let Ok(root) = vault_sandbox_dir(state, &dir) {
                                let mut entries = vault_list_entries(&root);
                                entries.truncate(2000);
                                send_control(ServerMsg::VaultListing { dir, entries });
                            }
                        }
                        Err(e) => send_control(ServerMsg::Error {
                            agent_id: None,
                            message: format!("vault rename failed: {e}"),
                        }),
                    }
                }
                (Err(e), _) | (_, Err(e)) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e,
                }),
                _ => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: format!("vault rename refused: {path}"),
                }),
            }
        }
        ClientMsg::RepoTree { dir } => match vault_sandbox_dir(state, &dir) {
            Ok(root) => {
                let mut entries = repo_tree_entries(&root);
                entries.truncate(4000);
                send_control(ServerMsg::RepoListing { dir, entries });
            }
            Err(e) => send_control(ServerMsg::Error {
                agent_id: None,
                message: e,
            }),
        },
        ClientMsg::RepoRead { dir, path } => {
            match vault_sandbox_resolve(state, &dir, &path) {
                Ok(file) if file.is_file() => {
                    // 256 KiB cap — the viewer is for code, not binaries
                    // or minified bundles. Size-check BEFORE reading: an
                    // oversized file must never enter daemon memory.
                    let too_big = std::fs::metadata(&file)
                        .map(|md| md.len() > 256 * 1024)
                        .unwrap_or(false);
                    if too_big {
                        send_control(ServerMsg::Error {
                            agent_id: None,
                            message: format!("file too large to view (256 KiB cap): {path}"),
                        });
                        return;
                    }
                    // A NUL in the first chunk means binary: refuse.
                    match std::fs::read(&file) {
                        Ok(bytes) => {
                            if bytes.len() > 256 * 1024 {
                                send_control(ServerMsg::Error {
                                    agent_id: None,
                                    message: format!(
                                        "file too large to view ({} KiB cap): {path}",
                                        256
                                    ),
                                });
                            } else if bytes[..bytes.len().min(8192)].contains(&0) {
                                send_control(ServerMsg::Error {
                                    agent_id: None,
                                    message: format!("binary file — not viewable: {path}"),
                                });
                            } else {
                                match String::from_utf8(bytes) {
                                    Ok(text) => {
                                        send_control(ServerMsg::RepoFile { dir, path, text })
                                    }
                                    Err(_) => send_control(ServerMsg::Error {
                                        agent_id: None,
                                        message: format!("file is not UTF-8 text: {path}"),
                                    }),
                                }
                            }
                        }
                        _ => send_control(ServerMsg::Error {
                            agent_id: None,
                            message: format!("read failed: {path}"),
                        }),
                    }
                }
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e,
                }),
                _ => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: format!("read failed: {path}"),
                }),
            }
        }
        ClientMsg::RepoWrite {
            dir,
            path,
            text,
            base_text,
        } => {
            let result = (|| -> Result<(), String> {
                if text.len() > 256 * 1024 || text.as_bytes().contains(&0) {
                    return Err("file exceeds the 256 KiB text editor limit".into());
                }
                let repo_dir = registered_repo_dir(&state.repo_root, &state.store, &dir)?;
                let file = vault_sandbox_resolve(state, &repo_dir.to_string_lossy(), &path)?;
                if !file.is_file() {
                    return Err(format!("write refused: file does not exist: {path}"));
                }
                let current = std::fs::read_to_string(&file)
                    .map_err(|_| format!("file is not UTF-8 text: {path}"))?;
                if current != base_text {
                    return Err(format!(
                        "file changed on disk; reload before saving: {path}"
                    ));
                }
                atomic_replace_repo_file(&file, &text)
            })();
            match result {
                Ok(()) => send_control(ServerMsg::RepoFile { dir, path, text }),
                Err(message) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message,
                }),
            }
        }
        ClientMsg::VaultRead { dir, path } => match vault_sandbox_resolve(state, &dir, &path) {
            Ok(file) if path.ends_with(".md") && file.is_file() => {
                match std::fs::read_to_string(&file) {
                    Ok(text) => send_control(ServerMsg::VaultFile { path, text }),
                    _ => send_control(ServerMsg::Error {
                        agent_id: None,
                        message: format!("vault read failed: {path}"),
                    }),
                }
            }
            Err(e) => send_control(ServerMsg::Error {
                agent_id: None,
                message: e,
            }),
            _ => send_control(ServerMsg::Error {
                agent_id: None,
                message: format!("vault read failed: {path}"),
            }),
        },
        ClientMsg::VaultPeek { dir, path } => match vault_sandbox_resolve(state, &dir, &path) {
            Ok(file) if path.ends_with(".md") && file.is_file() => {
                match std::fs::read_to_string(&file) {
                    Ok(text) => send_control(ServerMsg::VaultPeeked { path, text }),
                    _ => send_control(ServerMsg::Error {
                        agent_id: None,
                        message: format!("vault peek failed: {path}"),
                    }),
                }
            }
            Err(e) => send_control(ServerMsg::Error {
                agent_id: None,
                message: e,
            }),
            _ => send_control(ServerMsg::Error {
                agent_id: None,
                message: format!("vault peek failed: {path}"),
            }),
        },
        ClientMsg::VaultAsset { dir, path } => {
            let file = vault_sandbox_resolve(state, &dir, &path);
            let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            let mime = match ext.as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "svg" => "image/svg+xml",
                "ico" => "image/x-icon",
                _ => "",
            };
            match file {
                Ok(file) if !mime.is_empty() && file.is_file() => match std::fs::read(&file) {
                    Ok(bytes) if bytes.len() <= 8 * 1024 * 1024 => {
                        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
                        send_control(ServerMsg::VaultAssetData {
                            path,
                            mime: mime.to_string(),
                            data,
                        });
                    }
                    _ => send_control(ServerMsg::Error {
                        agent_id: None,
                        message: format!("vault asset failed: {path}"),
                    }),
                },
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e,
                }),
                _ => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: format!("vault asset failed: {path}"),
                }),
            }
        }
        ClientMsg::VaultAppend { dir, path, text } => {
            let file = vault_sandbox_resolve(state, &dir, &path);
            if !path.ends_with(".md") {
                send_control(ServerMsg::Error {
                    agent_id: None,
                    message: format!("vault append refused: {path}"),
                });
            } else if let Err(e) = file {
                send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e,
                });
            } else {
                let file = file.unwrap();
                let result = (|| {
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
                    std::fs::read_to_string(&file).map_err(|e| e.to_string())
                })();
                match result {
                    Ok(text) => send_control(ServerMsg::VaultFile { path, text }),
                    Err(e) => send_control(ServerMsg::Error {
                        agent_id: None,
                        message: format!("vault append failed: {e}"),
                    }),
                }
            }
        }
        ClientMsg::VaultWrite { dir, path, text } => {
            let file = vault_sandbox_resolve(state, &dir, &path);
            if !path.ends_with(".md") {
                send_control(ServerMsg::Error {
                    agent_id: None,
                    message: format!("vault write refused: {path}"),
                });
            } else if let Err(e) = file {
                send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e,
                });
            } else {
                let file = file.unwrap();
                let result = (|| {
                    if let Some(parent) = file.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    std::fs::write(&file, &text).map_err(|e| e.to_string())
                })();
                match result {
                    Ok(()) => send_control(ServerMsg::VaultFile { path, text }),
                    Err(e) => send_control(ServerMsg::Error {
                        agent_id: None,
                        message: format!("vault write failed: {e}"),
                    }),
                }
            }
        }
        ClientMsg::VaultWriteAsset { dir, path, data } => {
            if dir.is_empty() {
                send_control(ServerMsg::Error {
                    agent_id: None,
                    message: "vault write-asset refused: no vault dir".to_string(),
                });
            } else if path.is_empty() || path.ends_with('/') {
                send_control(ServerMsg::Error {
                    agent_id: None,
                    message: format!("vault write-asset refused: {path}"),
                });
            } else {
                // Assets obey the exact same sandbox as every other vault
                // operation: the destination is resolved through the canonical,
                // allowed vault root before any directory is created or byte is
                // written. In particular `root.join(path)` must never see the
                // client-supplied path directly — an absolute path would replace
                // the root, and an intermediate symlink could point outside it.
                let file = vault_sandbox_resolve(state, &dir, &path);
                let root = vault_sandbox_dir(state, &dir);
                match (file, root) {
                    (Err(e), _) => send_control(ServerMsg::Error {
                        agent_id: None,
                        message: e,
                    }),
                    (_, Err(e)) => send_control(ServerMsg::Error {
                        agent_id: None,
                        message: e,
                    }),
                    (Ok(file), Ok(root)) if file == root => {
                        // Unlike markdown writes, assets have no extension gate.
                        // `.` (or a link back to the vault root) resolves to the
                        // root directory itself; treating that as a file would make
                        // the dedupe parent the vault's PARENT and invent names like
                        // `vault-2` outside the sandbox.
                        send_control(ServerMsg::Error {
                            agent_id: None,
                            message: format!("vault write-asset refused: {path}"),
                        });
                    }
                    (Ok(file), Ok(root)) => {
                        match base64::engine::general_purpose::STANDARD.decode(&data) {
                            Ok(bytes) if bytes.len() <= 8 * 1024 * 1024 => {
                                // Never clobber: foo.png → foo-2.png. symlink_metadata
                                // (not exists()) so a dangling symlink also counts as
                                // taken — writing through it would escape the vault.
                                let result = (|| -> Result<(), String> {
                                    // Never clobber: foo.png → foo-2.png. Open with
                                    // create_new (O_EXCL) per candidate — atomic, so
                                    // concurrent drops can't race a check-then-write
                                    // into an overwrite, and a dangling symlink fails
                                    // EEXIST instead of being written through.
                                    if let Some(parent) = file.parent() {
                                        std::fs::create_dir_all(parent)
                                            .map_err(|e| e.to_string())?;
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
                                    let parent =
                                        file.parent().map(|p| p.to_path_buf()).unwrap_or_default();
                                    let mut wrote = false;
                                    for cand in std::iter::once(file.clone()).chain(
                                        (2..100).map(|i| parent.join(format!("{stem}-{i}{ext}"))),
                                    ) {
                                        match std::fs::OpenOptions::new()
                                            .write(true)
                                            .create_new(true)
                                            .open(&cand)
                                        {
                                            Ok(f) => {
                                                // Reserve the name atomically, write the
                                                // bytes to a sibling tmp file, then rename
                                                // over the reservation — a failed write
                                                // never leaves a truncated final file.
                                                drop(f);
                                                let tmp =
                                                    cand.parent().unwrap_or(&root).join(format!(
                                                        ".{}.tmp-{}",
                                                        cand.file_name()
                                                            .unwrap_or_default()
                                                            .to_string_lossy(),
                                                        std::process::id(),
                                                    ));
                                                // create_new on the tmp too — a vault file that
                                                // happens to share the tmp name must never be
                                                // truncated; cleanup only removes files we made.
                                                let outcome = match std::fs::OpenOptions::new()
                                                    .write(true)
                                                    .create_new(true)
                                                    .open(&tmp)
                                                {
                                                    Ok(mut f) => {
                                                        let r = std::io::Write::write_all(
                                                            &mut f, &bytes,
                                                        );
                                                        drop(f);
                                                        r.and_then(|()| {
                                                            std::fs::rename(&tmp, &cand)
                                                        })
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
                                            Err(e)
                                                if e.kind()
                                                    == std::io::ErrorKind::AlreadyExists =>
                                            {
                                                continue
                                            }
                                            Err(e) => return Err(e.to_string()),
                                        }
                                    }
                                    if !wrote {
                                        return Err(format!("no free name for {path}"));
                                    }
                                    Ok(())
                                })();
                                match result {
                                    Ok(()) => {
                                        let mut entries = vault_list_entries(&root);
                                        entries.truncate(2000);
                                        send_control(ServerMsg::VaultListing { dir, entries });
                                    }
                                    Err(e) => send_control(ServerMsg::Error {
                                        agent_id: None,
                                        message: format!("vault write-asset failed: {e}"),
                                    }),
                                }
                            }
                            _ => send_control(ServerMsg::Error {
                                agent_id: None,
                                message: format!("vault write-asset refused: {path}"),
                            }),
                        }
                    }
                }
            }
        }
        ClientMsg::VaultSearch { dir, query } => {
            let root = match vault_sandbox_dir(state, &dir) {
                Ok(r) => r,
                Err(e) => {
                    send_control(ServerMsg::Error {
                        agent_id: None,
                        message: e,
                    });
                    return;
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
                                || matches!(
                                    name.as_str(),
                                    "node_modules" | "target" | "dist" | "build"
                                )
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
                            let rel = canvasd::paths::wire_rel_path(rel);
                            for (i, line) in text.lines().enumerate() {
                                if line.to_lowercase().contains(&needle) {
                                    hits.push(protocol::VaultHit {
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
            send_control(ServerMsg::VaultHits { dir, query, hits });
        }
        ClientMsg::VaultDiscover => {
            send_control(ServerMsg::VaultDiscovered {
                vaults: canvasd::vault::discover(),
            });
        }
        ClientMsg::VaultRegister { dir } => match canvasd::vault::register(&dir) {
            Ok(vaults) => send_control(ServerMsg::VaultDiscovered { vaults }),
            Err(e) => send_control(ServerMsg::Error {
                agent_id: None,
                message: format!("vault register failed: {e}"),
            }),
        },
        ClientMsg::GitPush { agent_id } => {
            // Resolve under the agent's own workspace repo — an agent in an
            // external workspace pushes its branch there, not under CANVAS_REPO.
            let repo = state
                .store
                .agent_repo(&agent_id)
                .ok()
                .flatten()
                .map(PathBuf::from)
                .unwrap_or_else(|| state.repo_root.clone());
            let wt = state
                .store
                .agent_worktree(&agent_id)
                .ok()
                .flatten()
                .map(|w| repo.join(&w))
                .filter(|p| p.is_dir());
            match wt {
                Some(dir) => {
                    let out = std::process::Command::new("git")
                        .args(["-C"])
                        .arg(&dir)
                        .args(["push", "-u", "origin", "HEAD"])
                        .output();
                    match out {
                        Ok(o) if o.status.success() => send_control(ServerMsg::GitPushed {
                            agent_id,
                            output: String::from_utf8_lossy(&o.stderr).trim().to_string(),
                        }),
                        Ok(o) => send_control(ServerMsg::Error {
                            agent_id: Some(agent_id),
                            message: format!(
                                "git push: {}",
                                String::from_utf8_lossy(&o.stderr).trim()
                            ),
                        }),
                        Err(e) => send_control(ServerMsg::Error {
                            agent_id: Some(agent_id),
                            message: e.to_string(),
                        }),
                    }
                }
                None => send_control(ServerMsg::Error {
                    agent_id: Some(agent_id),
                    message: "no worktree for agent".into(),
                }),
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
            let id = format!("art-{}", uuid_like());
            let board = board_id
                .or_else(|| {
                    agent_id
                        .as_deref()
                        .and_then(|a| state.store.agent_board(a).ok().flatten())
                })
                .unwrap_or_else(|| "main".to_string());
            let agent_name = agent_id
                .as_deref()
                .and_then(|a| state.store.agent_name(a).ok().flatten());
            match state.store.artifact_created(
                &id,
                &board,
                agent_id.as_deref(),
                &kind,
                &title,
                path.as_deref(),
                text.as_deref(),
            ) {
                Ok(()) => send_control(ServerMsg::ArtifactCreated {
                    artifact: protocol::SnapshotArtifact {
                        artifact_id: id,
                        board_id: board,
                        agent_id,
                        agent_name,
                        kind,
                        title,
                        path,
                        text,
                        created_at: String::new(),
                    },
                }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::ArtifactDelete { artifact_id } => {
            match state.store.artifact_deleted(&artifact_id) {
                Ok(()) => send_control(ServerMsg::ArtifactDeleted { artifact_id }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::NoteDelete { note_id } => match state.store.note_deleted(&note_id) {
            Ok(()) => send_control(ServerMsg::NoteDeleted { note_id }),
            Err(e) => send_control(ServerMsg::Error {
                agent_id: None,
                message: e.to_string(),
            }),
        },
        ClientMsg::Digest => {
            let rows = state.store.agents_snapshot().unwrap_or_default();
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
            send_control(ServerMsg::SessionDigest { text: md });
        }
        ClientMsg::StudioDoc { board_id } => {
            let board = board_id.unwrap_or_else(|| "main".to_string());
            let mut md = String::from(
                "# Studio — repo dossier

",
            );
            // Repo structure (depth 2, skipping dependency dirs).
            let repo = &state.repo_root;
            md.push_str(&format!(
                "## Tree — {}

```
",
                repo.display()
            ));
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
                        "{prefix}{name}{}
",
                        if e.path().is_dir() { "/" } else { "" }
                    ));
                    if e.path().is_dir() {
                        walk(&e.path(), depth + 1, &format!("{prefix}  "), out);
                    }
                }
            }
            walk(repo, 0, "", &mut md);
            md.push_str(
                "```

",
            );
            // README first section.
            if let Ok(readme) = std::fs::read_to_string(repo.join("README.md")) {
                let head: String = readme.lines().take(40).collect::<Vec<_>>().join(
                    "
",
                );
                md.push_str(&format!(
                    "## README (head)

{head}

"
                ));
            }
            // Agents on this board.
            let agents = state.store.agents_snapshot().unwrap_or_default();
            md.push_str(
                "## Agents

",
            );
            for (_id, name, command, _wt, status, _ws, _perm, bd, acct) in &agents {
                if bd.as_deref().unwrap_or("main") != board {
                    continue;
                }
                md.push_str(&format!(
                    "- **{name}** (`{command}`) — {status}{}
",
                    acct.as_ref()
                        .map(|l| format!(" · @{l}"))
                        .unwrap_or_default()
                ));
            }
            // Notes + artifacts index.
            let notes = state.store.all_notes().unwrap_or_default();
            let board_notes: Vec<_> = notes.iter().filter(|n| n.1 == board).collect();
            if !board_notes.is_empty() {
                md.push_str(
                    "
## Notes

",
                );
                for (_id, _b, col, text, _pos, due) in &board_notes {
                    md.push_str(&format!(
                        "- [{col}] {text}{}
",
                        due.as_ref()
                            .map(|d| format!(" (due {d})"))
                            .unwrap_or_default()
                    ));
                }
            }
            let arts = state.store.artifacts_snapshot().unwrap_or_default();
            if !arts.is_empty() {
                md.push_str(
                    "
## Artifacts

",
                );
                for (id, bd, agent, kind, title, _p, _t, at) in &arts {
                    if bd != &board {
                        continue;
                    }
                    md.push_str(&format!(
                        "- `{kind}` **{title}** — {} ({at}, `{id}`)
",
                        agent.as_deref().unwrap_or("-")
                    ));
                }
            }
            send_control(ServerMsg::StudioDocMd { text: md });
        }
        ClientMsg::MemoryRead { node_id } => {
            let path = memory_path(state, &node_id);
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            send_control(ServerMsg::Memory { node_id, text });
        }
        ClientMsg::MemoryWrite { node_id, text } => {
            let path = memory_path(state, &node_id);
            if let Some(p) = path.parent() {
                let _ = std::fs::create_dir_all(p);
            }
            match std::fs::write(&path, &text) {
                Ok(()) => send_control(ServerMsg::Memory { node_id, text }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::DeleteWorkspace { workspace_id } => {
            match state.store.workspace_deleted(&workspace_id) {
                Ok(true) => send_control(ServerMsg::WorkspaceDeleted { workspace_id }),
                Ok(false) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: "workspace has live agents".into(),
                }),
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::DiffDetail { agent_id } => {
            // Live agents come from the manager; exited agents fall back
            // to their persisted worktree path so a done node's diff is
            // still readable.
            let wt = state.agents.worktree(&agent_id).or_else(|| {
                state
                    .store
                    .agent_worktree_abs(&agent_id, &state.repo_root)
                    .ok()
                    .flatten()
            });
            match wt {
                Some(wt) => send_control(ServerMsg::DiffDetail {
                    agent_id,
                    diff: dirty_diff(&wt),
                }),
                None => send_control(ServerMsg::Error {
                    agent_id: Some(agent_id),
                    message: "no such agent".into(),
                }),
            }
        }
    }
}

/// Resolve a loop's target to live agent ids: "*" means every live agent
/// on the loop's board; otherwise the single id if it is still running.
fn loop_targets(state: &Arc<AppState>, board_id: &str, target: &str) -> Vec<String> {
    let live: std::collections::HashSet<String> = state.agents.ids().into_iter().collect();
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

/// Fire a loop: write its instruction (gated, so a supervised console
/// still gets its approval gate) to every resolved target.
fn fire_loop(state: &Arc<AppState>, row: &store::LoopRow) {
    let (loop_id, board_id, target, instruction, _, _, _, _, _) = row;
    let ids = loop_targets(state, board_id, target);
    for id in &ids {
        gated_write(state, id, instruction.as_bytes());
        gated_write(state, id, b"\n");
    }
    if !ids.is_empty() {
        let _ = state.store.loop_fired(loop_id);
    }
}

/// Shared by the manual RunAutomation arm and the schedule ticker:
/// spawn the automation's agent, mark its guardrails, stamp the run.
fn run_automation_row(state: &Arc<AppState>, row: store::AutomationRow) {
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
    match spawn_agent(
        state,
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
    ) {
        Ok((agent_id, run_board, ready)) => {
            let _ = state.store.automation_ran(&automation_id);
            let run_stamp = state.store.automation_row(&automation_id).ok().flatten();
            if let Some((_, _, _, _, _, _, _, _, last_run_at, _, next_run_at)) = run_stamp {
                let _ = state.events.send(Event::Control(ServerMsg::AutomationRan {
                    automation_id: automation_id.clone(),
                    last_run_at,
                    next_run_at,
                }));
            }
            let wt = state
                .agents
                .worktree(&agent_id)
                .map(|p| p.to_string_lossy().to_string());
            let _ = state.events.send(Event::Control(ServerMsg::Spawned {
                agent_id: agent_id.clone(),
                name,
                command,
                permission,
                workspace_id,
                board_id: run_board,
                fallback_from: None,
                worktree: wt,
            }));
            // Inject the saved prompt — the kernel PTY buffer holds it
            // until the CLI reads stdin, gated like operator input.
            let bytes = format!("{prompt}\n");
            let mut write_prompt = true;
            if state
                .agents
                .permission(&agent_id)
                .map(|p| p == "supervised")
                .unwrap_or(false)
            {
                if let Some(line) = sensitive_line(bytes.as_bytes()) {
                    write_prompt = false;
                    if !state
                        .agents
                        .automation(&agent_id)
                        .map(|m| m.deny_approvals)
                        .unwrap_or(false)
                    {
                        state
                            .pending_inputs
                            .lock()
                            .unwrap()
                            .insert(agent_id.clone(), bytes.clone().into_bytes());
                        let _ = state.events.send(Event::Control(ServerMsg::NeedsApproval {
                            agent_id: agent_id.clone(),
                            line,
                        }));
                    } else {
                        let _ = state.events.send(Event::Control(ServerMsg::NeedsAttention {
                            agent_id: agent_id.clone(),
                            reason: format!("automation policy denied: {line}"),
                        }));
                    }
                }
            }
            if write_prompt {
                // The disposition is decided synchronously (the gate needs
                // it), but the bytes themselves wait for the launcher's
                // `stty -icanon` to reconfigure the PTY: input written
                // while the terminal is still in canonical mode is subject
                // to the kernel's ~4KB canonical line buffer — a long
                // prompt would silently truncate even though write()
                // reports success. The delay is ordering-only: if the CLI
                // dies in the meantime the write simply fails and the
                // fallback copy owns the retry.
                let st = state.clone();
                let target = agent_id.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                    gated_write(&st, &target, &bytes.into_bytes());
                });
            }
            // Prompt disposition vs. fallback retry:
            // - written or held: the fallback-state copy STAYS — fallback
            //   only fires when the original died within seconds of launch,
            //   so its copy of the prompt never completed (a write into the
            //   kernel PTY buffer of a dying CLI delivers nothing); the
            //   replacement re-runs it.
            // - dropped by deny-policy: a deliberate drop must NOT retry on
            //   the replacement — clear the copy so fallback skips
            //   re-injection.
            if !write_prompt {
                let denied = state
                    .agents
                    .automation(&agent_id)
                    .map(|m| m.deny_approvals)
                    .unwrap_or(false);
                if denied {
                    if let Some(fb) = state.pending_fallbacks.lock().unwrap().get_mut(&agent_id) {
                        fb.initial_input = None;
                    }
                }
            }
            // Registration for this run is complete (guardrails inside
            // spawn_agent, prompt disposition above) — release the exit
            // watcher.
            let _ = ready.send(());
        }
        Err(e) => {
            let _ = state.events.send(Event::Control(ServerMsg::Error {
                agent_id: None,
                message: e.to_string(),
            }));
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
        .map(|v| token_eq(v, &format!("Bearer {}", state.token)))
        .unwrap_or(false);
    if ok {
        next.run(req).await
    } else {
        (StatusCode::UNAUTHORIZED, "invalid session token").into_response()
    }
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
    // Sweep: children that printed CANVAS_RESULT while the daemon was
    // down still resolve — their transcript files survived the restart.
    {
        let tdir = repo_root.join(".canvas").join("transcripts");
        for (edge_id, to_node) in store.unresolved_delegations().unwrap_or_default() {
            let path = tdir.join(format!("{to_node}.bin"));
            let summary = std::fs::read(&path)
                .ok()
                .map(|b| {
                    let tail = &b[b.len().saturating_sub(8192)..];
                    String::from_utf8_lossy(tail).to_string()
                })
                .and_then(|t| canvas_result_line(&t))
                .map(|s| s.trim().to_string());
            if let Some(summary) = summary {
                let _ = store.delegation_resolved(&edge_id, &summary, 0);
            }
        }
    }
    // The repo's origin remote as an https URL — git@/ssh/… normalized,
    // trailing ".git" stripped. One shot at startup; remotes rarely move.
    let repo_url = std::process::Command::new("git")
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
            // Remotes may be proxies embedding the real host in the path
            // (e.g. git-manager.devin.ai/proxy/github.com/o/r) — prefer the
            // innermost github.com/… segment when one is present.
            let inner = u
                .rfind("github.com/")
                .map(|i| format!("https://{}", &u[i..]));
            let u = inner.unwrap_or_else(|| {
                u.replace("git@github.com:", "https://github.com/")
                    .replace("ssh://git@", "https://")
            });
            u.strip_suffix(".git").unwrap_or(&u).to_string()
        });
    let agents = Arc::new(AgentManager::new());
    agents.set_transcript_dir(repo_root.join(".canvas").join("transcripts"));
    let mut allowed_roots: Vec<PathBuf> = {
        // The board repo is always inside the sandbox; extra roots
        // (external vaults like ~/vault-demo) opt in one per line in
        // `.canvas/allowed-roots` — Deska's allowedRoots model.
        let mut roots: Vec<PathBuf> = Vec::new();
        if let Ok(c) = std::fs::canonicalize(&repo_root) {
            roots.push(c);
        }
        // Lives in the USER's config dir, not the checkout — a cloned
        // repo must never be able to grant itself access to the
        // operator's disk (repo authors control `.canvas/`).
        let list = allowed_roots_list_path(&repo_root);
        if let Ok(text) = std::fs::read_to_string(&list) {
            for line in text.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                // `~/` lines expand against the operator's home —
                // portably (the file is operator-written, so tilde
                // paths are expected input). Non-tilde lines pass
                // through unchanged.
                let expanded = canvasd::paths::expand_tilde(line);
                if let Ok(c) = std::fs::canonicalize(&expanded) {
                    if !roots.contains(&c) {
                        roots.push(c);
                    }
                }
            }
        }
        roots
    };

    // Workspaces registered before the auto-whitelist upgrade never got
    // their grant — they were explicit operator gestures at creation, so
    // backfill them into the sandbox at boot.
    if let Ok(rows) = store.workspaces_snapshot() {
        for (_, _, repo, _) in &rows {
            if let Some(canon) = canon_through_missing(std::path::Path::new(repo)) {
                let already = allowed_roots.iter().any(|ar| canon.starts_with(ar));
                if !already {
                    allowed_roots.push(canon);
                }
            }
        }
    }

    let state = Arc::new(AppState {
        token: token.clone(),
        events,
        agents,
        store,
        repo_root,
        repo_url,
        pending_results: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        pending_fallbacks: std::sync::Arc::new(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )),
        pending_inputs: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        shares: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        allowed_roots: std::sync::Arc::new(std::sync::Mutex::new(allowed_roots)),
    });

    let api = Router::new()
        .route("/health", get(health))
        .route("/export", get(export_state))
        .route("/github/{*rest}", get(github_proxy))
        .route(
            "/share",
            // axum's default body limit (2 MB) would silently shadow the
            // documented 8 MB share cap: base64 inflates the payload 4/3,
            // so the wire cap needs headroom past 8 MiB or shares between
            // ~1.5 MB and 8 MB die in the extractor before decode_body's
            // own cap can answer properly.
            axum::routing::post(share_create)
                .layer(axum::extract::DefaultBodyLimit::max(12 * 1024 * 1024)),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    let mut app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/share/{id}", get(share_get))
        .nest("/api", api)
        // Permissive so any local dev origin (vite, preview builds, LAN
        // hostnames) can call the daemon cross-origin — outermost layer so
        // CORS answers preflights before auth runs.
        .layer(tower_http::cors::CorsLayer::permissive());
    // One binary serves UI+ws: CANVASD_WEB_DIR points at a built `web/dist`
    // so a phone on the LAN just opens http://<host>:<port>/?token=….
    if let Ok(dir) = std::env::var("CANVASD_WEB_DIR") {
        // Joined as a path, not formatted — a literal "/" separator is a
        // Unix assumption (and a trailing separator would double it).
        let index = std::path::Path::new(&dir).join("index.html");
        app = app.fallback_service(
            tower_http::services::ServeDir::new(&dir)
                .append_index_html_on_directories(true)
                .fallback(tower_http::services::ServeFile::new(index)),
        );
    }
    let app = app.with_state(state.clone());

    let port: u16 = std::env::var("CANVASD_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(4242);
    // Agents orchestrate the board themselves via canvasctl — the daemon
    // hands each PTY the address and token it needs to call home.
    state.agents.set_env("CANVAS_PORT", &port.to_string());
    state.agents.set_env("CANVAS_TOKEN", &token);
    // Status ticker: re-derive every agent's status each second and emit a
    // Status event only when it changed (CLI-agnostic until real hooks land).
    {
        let agents = state.agents.clone();
        let ev = state.events.clone();
        let store = state.store.clone();
        let pending = state.pending_results.clone();
        let sched_state = state.clone();
        tokio::spawn(async move {
            let mut last: std::collections::HashMap<String, &'static str> =
                std::collections::HashMap::new();
            // Edge detection for 'match' loops: loop_id:agent_id → the
            // pattern was present in the tail on the previous pass, so a
            // sticky pattern fires once, not every tick.
            let mut match_seen: std::collections::HashMap<String, bool> =
                std::collections::HashMap::new();
            let mut last_line: std::collections::HashMap<String, String> =
                std::collections::HashMap::new();
            let mut last_diff: std::collections::HashMap<String, (Vec<String>, String)> =
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
                                .or_else(|| {
                                    agents
                                        .scrollback(agent_id)
                                        .map(|b| String::from_utf8_lossy(&b).to_string())
                                })
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
                        // What the delegation produced: uncommitted files
                        // in the child's worktree at resolve time.
                        let files = agents
                            .worktree(&agent_id)
                            .map(|wt| dirty_file_count(&wt))
                            .unwrap_or(0);
                        let _ = store.delegation_resolved(&edge_id, &summary, files);
                        let _ = ev.send(Event::Control(ServerMsg::Result {
                            edge_id,
                            summary,
                            files,
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
                            let _ =
                                ev.send(Event::Control(ServerMsg::Activity { agent_id: id, line }));
                        }
                    }
                }
                // Diff pass (every 3rd tick): uncommitted file count per
                // worktree — the node badge shows what the agent produced.
                if tick_n.is_multiple_of(3) {
                    for id in agents.ids() {
                        if let Some(wt) = agents.worktree(&id) {
                            let paths = dirty_files(&wt);
                            let files = paths.len() as u32;
                            let branch = worktree_branch(&wt);
                            if last_diff.get(&id) != Some(&(paths.clone(), branch.clone())) {
                                last_diff.insert(id.clone(), (paths.clone(), branch.clone()));
                                let _ = ev.send(Event::Control(ServerMsg::Diff {
                                    agent_id: id,
                                    files,
                                    paths,
                                    branch,
                                }));
                            }
                        }
                    }
                }
                // Automation guardrail pass: an automation-run agent silent
                // past its idle limit fires one attention alert (cleared
                // automatically when output resumes).
                for id in agents.automation_ids() {
                    if let (Some(meta), Some(silent)) =
                        (agents.automation(&id), agents.silent_for(&id))
                    {
                        if silent >= meta.idle_secs && !meta.hang_notified {
                            agents.set_hang_notified(&id, true);
                            let _ = ev.send(Event::Control(ServerMsg::NeedsAttention {
                                agent_id: id,
                                reason: format!("silent {}s (limit {}s)", silent, meta.idle_secs),
                            }));
                        } else if silent < 5 && meta.hang_notified {
                            agents.set_hang_notified(&id, false);
                        }
                    }
                }
                // Schedule pass (every 15th tick): run automations whose
                // next_run_at is due — same path as a manual run.
                if tick_n.is_multiple_of(15) {
                    match store.automations_due() {
                        Ok(rows) => {
                            for row in rows {
                                run_automation_row(&sched_state, row);
                            }
                        }
                        Err(e) => warn!(error = %e, "automation schedule check failed"),
                    }
                    // Loops pass: interval loops whose period elapsed,
                    // plus 'match' loops edge-detected on the PTY tail
                    // (fire once per appearance of the pattern).
                    match store.loops_interval_due() {
                        Ok(rows) => {
                            for row in &rows {
                                fire_loop(&sched_state, row);
                            }
                        }
                        Err(e) => warn!(error = %e, "loop schedule check failed"),
                    }
                    match store.loops_enabled() {
                        Ok(rows) => {
                            for row in &rows {
                                if row.4.as_str() == "match" {
                                    let Some(pat) = row.6.as_deref() else {
                                        continue;
                                    };
                                    if pat.is_empty() {
                                        continue;
                                    }
                                    for id in loop_targets(&sched_state, &row.1, &row.2) {
                                        let key = format!("{}:{}", row.0, id);
                                        let hit = sched_state
                                            .agents
                                            .tail_text(&id)
                                            .map(|t| t.contains(pat))
                                            .unwrap_or(false);
                                        if hit && !match_seen.get(&key).copied().unwrap_or(false) {
                                            fire_loop(&sched_state, row);
                                        }
                                        match_seen.insert(key, hit);
                                    }
                                }
                            }
                        }
                        Err(e) => warn!(error = %e, "loop schedule check failed"),
                    }
                }
                for (id, status) in agents.statuses() {
                    if last.get(&id) != Some(&status) {
                        let prev = last.get(&id).copied();
                        last.insert(id.clone(), status);
                        // 'idle' loops: an agent that was working and just
                        // went quiet gets its next instruction — Symvibe's
                        // "keep them moving" autopilot.
                        if prev == Some("working") && status == "idle" {
                            if let Ok(rows) = store.loops_enabled() {
                                for row in rows
                                    .iter()
                                    .filter(|r| r.4 == "idle" && (r.2 == id || r.2 == "*"))
                                {
                                    // A board-wide loop only fires for
                                    // agents that live on its board.
                                    if row.2 == "*"
                                        && !loop_targets(&sched_state, &row.1, "*").contains(&id)
                                    {
                                        continue;
                                    }
                                    fire_loop(&sched_state, row);
                                }
                            }
                        }
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

    let host: std::net::IpAddr = std::env::var("CANVASD_HOST")
        .ok()
        .and_then(|h| h.parse().ok())
        .unwrap_or(std::net::IpAddr::from([127, 0, 0, 1]));
    let addr = SocketAddr::from((host, port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!(%addr, "canvasd listening");
    println!("CANVASD_TOKEN={token}");

    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod repo_write_authorization_tests {
    use super::registered_repo_dir;
    use crate::store::Store;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "canvas-repo-write-auth-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed),
        ));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn only_board_and_registered_workspace_repositories_are_writable() {
        let repo = temp_root();
        let vault = temp_root();
        let store = Store::open(&repo).unwrap();

        // A directory may be readable/writable through the wider Vault
        // sandbox without being authorized for Code Editor writes.
        assert!(registered_repo_dir(&repo, &store, vault.to_str().unwrap()).is_err());
        assert_eq!(
            registered_repo_dir(&repo, &store, repo.to_str().unwrap()).unwrap(),
            std::fs::canonicalize(&repo).unwrap(),
        );

        store
            .workspace_created("ws-1", "registered", vault.to_str().unwrap(), None)
            .unwrap();
        assert_eq!(
            registered_repo_dir(&repo, &store, vault.to_str().unwrap()).unwrap(),
            std::fs::canonicalize(&vault).unwrap(),
        );

        std::fs::remove_dir_all(repo).unwrap();
        std::fs::remove_dir_all(vault).unwrap();
    }
}

#[cfg(test)]
mod wire_path_tests {
    use super::{repo_tree_entries, vault_list_entries};

    fn temp_vault(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "canvas-wire-path-test-{}-{}",
            tag,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(root.join("sub").join("deep")).unwrap();
        std::fs::write(root.join("top.md"), "top").unwrap();
        std::fs::write(root.join("sub").join("mid.md"), "mid").unwrap();
        std::fs::write(root.join("sub").join("deep").join("note.md"), "note").unwrap();
        root
    }

    #[test]
    fn vault_entries_are_forward_slash_joined_on_the_wire() {
        // Protocol contract: the client splits/matches entries on `/`.
        // On Unix this falls out of to_string_lossy naturally, but the
        // wire_rel_path normalization is what keeps it true when the
        // daemon runs on Windows — pin the contract either way.
        let root = temp_vault("vault");
        let entries = vault_list_entries(&root);
        assert!(entries.contains(&"top.md".to_string()), "{entries:?}");
        assert!(entries.contains(&"sub/mid.md".to_string()), "{entries:?}");
        assert!(
            entries.contains(&"sub/deep/note.md".to_string()),
            "{entries:?}"
        );
        assert!(
            entries.iter().all(|e| !e.contains('\\')),
            "a backslash must never reach the wire: {entries:?}"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn repo_tree_entries_follow_the_same_wire_contract() {
        let root = temp_vault("repo");
        let entries = repo_tree_entries(&root);
        assert!(
            entries.contains(&"sub/deep/note.md".to_string()),
            "{entries:?}"
        );
        assert!(
            entries.iter().all(|e| !e.contains('\\')),
            "a backslash must never reach the wire: {entries:?}"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod vault_write_asset_sandbox_tests {
    use super::*;
    use std::path::{Path, PathBuf};

    struct Fixture {
        // Drop order is field order: close the SQLite store before TempDir
        // tries to delete it (Windows refuses to unlink open files).
        state: Arc<AppState>,
        vault: PathBuf,
        tmp: tempfile::TempDir,
    }

    fn state_for_repo(repo: &Path) -> Arc<AppState> {
        let (events, _) = broadcast::channel(16);
        Arc::new(AppState {
            token: "test".into(),
            events,
            agents: Arc::new(AgentManager::new()),
            store: Arc::new(store::Store::open(repo).unwrap()),
            repo_root: repo.to_path_buf(),
            repo_url: None,
            pending_results: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            pending_fallbacks: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            pending_inputs: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            shares: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            allowed_roots: Arc::new(std::sync::Mutex::new(vec![
                std::fs::canonicalize(repo).unwrap()
            ])),
        })
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
        let state = state_for_repo(&repo);
        if allow_vault {
            state
                .allowed_roots
                .lock()
                .unwrap()
                .push(std::fs::canonicalize(&vault).unwrap());
        }
        Fixture { state, vault, tmp }
    }

    /// Drive the real control-message handler. `cG5n` is the base64 for
    /// the bytes `png`; using one payload keeps the filesystem assertions
    /// focused on path handling rather than encoding.
    fn write_asset(state: &Arc<AppState>, dir: &Path, path: &str) -> Vec<ServerMsg> {
        let messages = std::sync::Mutex::new(Vec::new());
        {
            let send_control = |msg: ServerMsg| messages.lock().unwrap().push(msg);
            let cmd = serde_json::json!({
                "cmd": "vault_write_asset",
                "dir": dir.to_string_lossy().to_string(),
                "path": path,
                "data": "cG5n",
            });
            handle_client_msg(&cmd.to_string(), state, &send_control);
        }
        messages.into_inner().unwrap()
    }

    fn error_messages(messages: &[ServerMsg]) -> Vec<&str> {
        messages
            .iter()
            .filter_map(|m| match m {
                ServerMsg::Error { message, .. } => Some(message.as_str()),
                _ => None,
            })
            .collect()
    }

    fn assert_access_denied(messages: &[ServerMsg], needle: &str) {
        let errors = error_messages(messages);
        assert!(
            errors.iter().any(|e| e.contains(needle)),
            "expected an access-denied error containing {needle:?}; got {messages:?}"
        );
        assert!(
            !messages
                .iter()
                .any(|m| matches!(m, ServerMsg::VaultListing { .. })),
            "a refused write must not emit a successful vault listing: {messages:?}"
        );
    }

    #[test]
    fn rejects_parent_traversal_before_creating_anything() {
        let f = fixture(true);
        let messages = write_asset(&f.state, &f.vault, "../../etc/passwd");
        assert_access_denied(&messages, "path escapes the vault");
        assert!(
            !f.tmp.path().join("etc").join("passwd").exists(),
            "parent traversal must not create a file outside the vault"
        );
    }

    #[test]
    fn rejects_absolute_paths_even_inside_the_scratch_area() {
        let f = fixture(true);
        let target = f.tmp.path().join("outside").join("absolute.png");
        let absolute = target.to_string_lossy().to_string();
        let messages = write_asset(&f.state, &f.vault, &absolute);
        assert_access_denied(&messages, "absolute paths are not allowed");
        assert!(
            !target.exists(),
            "an absolute target outside the vault must not be written"
        );
    }

    #[test]
    fn rejects_the_vault_root_itself_as_a_file_target() {
        let f = fixture(true);
        let sibling_escape = f.vault.parent().unwrap().join("vault-2");
        let messages = write_asset(&f.state, &f.vault, ".");
        assert!(
            error_messages(&messages)
                .iter()
                .any(|e| e.contains("vault write-asset refused")),
            "expected the root target to be refused; got {messages:?}"
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
        let f = fixture(true);
        let outside = f.tmp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        let link = f.vault.join("linked");
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

        let messages = write_asset(&f.state, &f.vault, "linked/escape.png");
        assert_access_denied(&messages, "outside allowed directories");
        assert!(
            !outside.join("escape.png").exists(),
            "a symlinked directory must not carry the write outside the vault"
        );

        // A link back to the vault root is containment-valid as a path, but it
        // is not a file target: without a root-target guard the dedupe step
        // would look for `vault-2` beside the vault, outside the sandbox.
        let root_link = f.vault.join("root-link");
        symlink_dir(&f.vault, &root_link).unwrap();
        let messages = write_asset(&f.state, &f.vault, "root-link");
        assert!(
            error_messages(&messages)
                .iter()
                .any(|e| e.contains("vault write-asset refused")),
            "a symlink resolving to the vault root must be refused as a file target: {messages:?}"
        );
        assert!(
            !f.vault.parent().unwrap().join("vault-2").exists(),
            "root-resolving symlink must not create a sibling outside the vault"
        );
    }

    #[test]
    fn rejects_a_vault_root_that_was_never_granted() {
        let f = fixture(false);
        let messages = write_asset(&f.state, &f.vault, "pic.png");
        assert_access_denied(&messages, "outside allowed directories");
        assert!(
            !f.vault.join("pic.png").exists(),
            "an ungranted vault root must not become writable just because it exists"
        );
    }

    #[test]
    fn legitimate_nested_write_still_lands_in_the_vault_and_dedupes() {
        let f = fixture(true);
        let messages = write_asset(&f.state, &f.vault, "attachments/pic.png");
        assert!(
            messages
                .iter()
                .any(|m| matches!(m, ServerMsg::VaultListing { .. })),
            "a valid write should emit the refreshed vault listing: {messages:?}"
        );
        assert!(
            error_messages(&messages).is_empty(),
            "valid write errored: {messages:?}"
        );
        assert_eq!(
            std::fs::read(f.vault.join("attachments").join("pic.png")).unwrap(),
            b"png"
        );

        let messages = write_asset(&f.state, &f.vault, "attachments/pic.png");
        assert!(
            error_messages(&messages).is_empty(),
            "deduped write errored: {messages:?}"
        );
        assert_eq!(
            std::fs::read(f.vault.join("attachments").join("pic-2.png")).unwrap(),
            b"png"
        );
        assert_eq!(
            std::fs::read(f.vault.join("attachments").join("pic.png")).unwrap(),
            b"png",
            "the original file must never be clobbered"
        );
    }
}
