//! Agent orchestration runtime shared by transports.
//!
//! The daemon historically owned this logic inside its WebSocket binary and
//! the Tauri shell carried a copy inside `main.rs`: spawn a PTY, persist the
//! node, wire chain fallbacks, hold supervised input, and close delegation
//! tickets when `CANVAS_RESULT:` appears. Neither concern belongs to a
//! transport. `Orchestrator` is the transport-independent core; the daemon,
//! the native shell, and the native control socket can all subscribe to the
//! same control/PTY event streams and drive the same operations.

use crate::agent::{canvas_result_line, dirty_file_count, sensitive_line, AgentManager};
use crate::chain::{chain_for_spawn, command_cli, substitute_cli};
use crate::protocol::{self, AgentStatus, ServerMsg};
use crate::store::Store;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, mpsc};

/// Registration-completion gate handed back from [`Orchestrator::spawn`].
/// The agent's exit watcher waits on it before processing any exit, so a PTY
/// dying during spawn can never outrun the registration of its fallback
/// state, automation metadata, or delegation ticket. Callers fire it once
/// their own post-spawn registration completes; dropping it (error paths)
/// releases the watcher too — a permanently-blocked watcher would never
/// mark the agent exited at all.
pub type RegistrationGate = tokio::sync::oneshot::Sender<()>;

type BoxedTask = std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'static>>;

/// Runtime-specific fire-and-forget task launcher. canvasd runs directly on
/// tokio; Tauri commands may execute outside a tokio thread-local context and
/// therefore need `tauri::async_runtime::spawn`. Keeping the launcher injected
/// keeps this crate independent of either runtime's event loop shape.
pub type TaskSpawner = Arc<dyn Fn(BoxedTask) + Send + Sync>;

/// A spawner for hosts already running inside tokio (tests, canvasd, axum).
pub fn tokio_task_spawner() -> TaskSpawner {
    Arc::new(|task| {
        drop(tokio::spawn(task));
    })
}

/// Per-spawn retry state: when a fresh PTY dies within seconds, the next
/// chain candidate gets a chance with the same parameters.
pub struct FallbackState {
    pub spawned_at: std::time::Instant,
    pub name: String,
    pub command: String,
    pub cwd: String,
    pub workspace_id: Option<String>,
    pub permission: String,
    pub board_id: Option<String>,
    pub account_id: Option<String>,
    /// Automation guardrails (idle alert secs, deny-approvals policy) —
    /// re-applied to every replacement so a fallback keeps the original's
    /// automation constraints.
    pub automation: Option<(u64, bool)>,
    /// CLIs not yet tried, in order.
    pub remaining: Vec<String>,
    /// Task text queued for the original PTY — re-injected into the
    /// replacement so a fallback never silently drops the user's task.
    /// Never cleared on a successful write: fallback only fires when the
    /// original DIED within seconds of launch, so its copy of the task
    /// never completed and re-running it is the correct retry semantics.
    pub initial_input: Option<String>,
}

/// Inputs for a normal node spawn. Optional fields mirror `ClientMsg::SpawnAgent`.
#[derive(Debug, Clone)]
pub struct SpawnParams {
    pub name: String,
    pub command: String,
    pub cwd: String,
    pub workspace_id: Option<String>,
    pub permission: Option<String>,
    pub board_id: Option<String>,
    pub account_id: Option<String>,
    pub initial_input: Option<String>,
}

/// Inputs for an edge-owned delegation spawn.
#[derive(Debug, Clone)]
pub struct DelegateParams {
    pub from: String,
    pub name: String,
    pub command: String,
    pub task: String,
    pub cwd: String,
    pub workspace_id: Option<String>,
    pub permission: Option<String>,
    pub account_id: Option<String>,
    pub board_id: Option<String>,
    pub initial_input: Option<String>,
}

/// What happened to a supervised-gated input write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputDisposition {
    /// Bytes reached the PTY.
    Written,
    /// Bytes are parked in pending_inputs awaiting operator approval.
    Held,
    /// An automation deny-policy deliberately dropped the bytes.
    Denied,
}

/// Transport-independent agent orchestration state and operations.
///
/// The event senders are broadcast channels rather than callbacks: the native
/// shell forwards one subscription to the webview, the control socket forwards
/// another to WebSocket clients, and tests can subscribe directly.
#[derive(Clone)]
pub struct Orchestrator {
    pub agents: Arc<AgentManager>,
    pub store: Arc<Store>,
    pub repo_root: PathBuf,
    /// agent_id → delegation edge_id: which child still owes a CANVAS_RESULT.
    pub pending_results: Arc<Mutex<HashMap<String, String>>>,
    /// agent_id → held PTY input bytes a supervised agent needs approval for.
    pub pending_inputs: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    /// agent_id → chain-retry state for early PTY deaths.
    pub pending_fallbacks: Arc<Mutex<HashMap<String, FallbackState>>>,
    control_events: broadcast::Sender<ServerMsg>,
    pty_events: broadcast::Sender<(String, Vec<u8>)>,
    spawner: TaskSpawner,
}

impl Orchestrator {
    pub fn new(
        store: Arc<Store>,
        agents: Arc<AgentManager>,
        repo_root: PathBuf,
        spawner: TaskSpawner,
    ) -> Self {
        let (control_events, _) = broadcast::channel(512);
        // PTY output is much noisier than control traffic. 1024 chunks is
        // generous for interactive terminals while still bounding a lagging
        // client; very noisy agents rely on transcript files for durability.
        let (pty_events, _) = broadcast::channel(1024);
        Self {
            agents,
            store,
            repo_root,
            pending_results: Arc::new(Mutex::new(HashMap::new())),
            pending_inputs: Arc::new(Mutex::new(HashMap::new())),
            pending_fallbacks: Arc::new(Mutex::new(HashMap::new())),
            control_events,
            pty_events,
            spawner,
        }
    }

    pub fn control_sender(&self) -> broadcast::Sender<ServerMsg> {
        self.control_events.clone()
    }

    pub fn pty_sender(&self) -> broadcast::Sender<(String, Vec<u8>)> {
        self.pty_events.clone()
    }

    pub fn subscribe_control(&self) -> broadcast::Receiver<ServerMsg> {
        self.control_events.subscribe()
    }

    pub fn subscribe_pty(&self) -> broadcast::Receiver<(String, Vec<u8>)> {
        self.pty_events.subscribe()
    }

    pub fn emit_control(&self, msg: ServerMsg) {
        // No receivers is normal (e.g. a headless test that only inspects
        // the store), so broadcast's Err(no receivers) is deliberately ignored.
        let _ = self.control_events.send(msg);
    }

    pub fn emit_error(&self, agent_id: Option<String>, message: impl Into<String>) {
        self.emit_control(ServerMsg::Error {
            agent_id,
            message: message.into(),
        });
    }

    pub fn emit_pty(&self, agent_id: &str, bytes: &[u8]) {
        let _ = self.pty_events.send((agent_id.to_string(), bytes.to_vec()));
    }

    /// Memory file for a node: the board repo's `.canvas/memory.md`, or the
    /// workspace's repo memory when node_id is a workspace.
    pub fn memory_path(&self, node_id: &str) -> PathBuf {
        let repo = if node_id == "main" {
            self.repo_root.clone()
        } else {
            self.store
                .workspace_repo(node_id)
                .ok()
                .flatten()
                .map(PathBuf::from)
                .unwrap_or_else(|| self.repo_root.clone())
        };
        repo.join(".canvas").join("memory.md")
    }

    /// Write PTY input honoring the supervised-input gate and report how the
    /// bytes were disposed. `supervised` agents hold destructive-looking input
    /// until the operator approves; automation deny-policies deliberately drop
    /// it rather than parking a run nobody is watching.
    pub fn gated_write_disposition(
        &self,
        agent_id: &str,
        bytes: &[u8],
    ) -> Result<InputDisposition, String> {
        let supervised = self
            .agents
            .permission(agent_id)
            .map(|p| p == "supervised")
            .unwrap_or(false);
        if supervised {
            if let Some(line) = sensitive_line(bytes) {
                // Automation guardrail: a run whose approval policy is "deny"
                // never waits on a human — the input is dropped and reported.
                if self
                    .agents
                    .automation(agent_id)
                    .map(|m| m.deny_approvals)
                    .unwrap_or(false)
                {
                    self.emit_control(ServerMsg::NeedsAttention {
                        agent_id: agent_id.to_string(),
                        reason: format!("automation policy denied: {line}"),
                    });
                    return Ok(InputDisposition::Denied);
                }
                self.pending_inputs
                    .lock()
                    .unwrap()
                    .insert(agent_id.to_string(), bytes.to_vec());
                self.emit_control(ServerMsg::NeedsApproval {
                    agent_id: agent_id.to_string(),
                    line,
                });
                return Ok(InputDisposition::Held);
            }
        }
        self.agents
            .write(agent_id, bytes)
            .map_err(|e| e.to_string())?;
        Ok(InputDisposition::Written)
    }

    /// Write PTY input honoring the supervised-input gate. Returns true when
    /// the payload was written, held, or deliberately policy-dropped without
    /// a PTY error.
    pub fn gated_write(&self, agent_id: &str, bytes: &[u8]) -> bool {
        self.gated_write_disposition(agent_id, bytes).is_ok()
    }

    /// Spawn a PTY agent wired to emit events + persist. Shared by normal
    /// spawns, delegation children, automations, and chain-fallback retries.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        &self,
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
    ) -> Result<(String, Option<String>, RegistrationGate), String> {
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<(String, Vec<u8>)>();
        let (exit_tx, mut exit_rx) = mpsc::unbounded_channel::<String>();
        // The exit watcher waits on this gate before processing any exit —
        // the PTY reader can report a death before spawn even returns, and
        // without the gate that exit would be handled with fallback state,
        // automation metadata, or delegation tickets not yet registered.
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();

        let output_core = self.clone();
        (self.spawner)(Box::pin(async move {
            while let Some((id, bytes)) = out_rx.recv().await {
                output_core.emit_pty(&id, &bytes);
            }
        }));

        let watcher = self.clone();
        let original_workspace = workspace_id.map(str::to_string);
        (self.spawner)(Box::pin(async move {
            // Hold exit processing until the spawning call signals that all
            // registration for this agent is complete. Dropping the sender
            // (spawn error paths) releases the watcher too.
            let _ = ready_rx.await;
            while let Some(id) = exit_rx.recv().await {
                // Chain fallback: a PTY dying within seconds of launch never
                // gave the operator a working agent — retry the next CLI with
                // the same parameters and announce the replacement.
                let fb = watcher.pending_fallbacks.lock().unwrap().remove(&id);
                let mut fell_back = false;
                if let Some(fb) = fb {
                    if fb.spawned_at.elapsed() < std::time::Duration::from_secs(5)
                        && !fb.remaining.is_empty()
                    {
                        let next = fb.remaining[0].clone();
                        let cmd = substitute_cli(&fb.command, &next);
                        let respawned = watcher.spawn(
                            &fb.name,
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
                        );
                        if let Ok((new_id, new_board, new_ready)) = respawned {
                            fell_back = true;
                            // Re-inject the queued task into the replacement —
                            // gated, so a supervised automation keeps its
                            // approval gate on the fallback too.
                            if let Some(text) = fb.initial_input.clone() {
                                let delayed = watcher.clone();
                                let target = new_id.clone();
                                (watcher.spawner)(Box::pin(async move {
                                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                                    let mut data = text.into_bytes();
                                    data.push(b'\r');
                                    delayed.gated_write(&target, &data);
                                }));
                            }
                            // A delegation awaiting this child's result moves to
                            // the replacement — otherwise the original exit marks
                            // the ticket failed and the parent's result is lost.
                            let edge = watcher.pending_results.lock().unwrap().remove(&id);
                            if let Some(edge) = edge {
                                // The replacement may have exited in the microseconds
                                // since spawn — its exit runs on a different watcher,
                                // so a ticket keyed to it would strand in flight.
                                // Already dead: fail the ticket now instead.
                                let replacement_live = watcher
                                    .agents
                                    .statuses()
                                    .iter()
                                    .any(|(aid, st)| aid == &new_id && *st != "exited");
                                if replacement_live {
                                    watcher
                                        .pending_results
                                        .lock()
                                        .unwrap()
                                        .insert(new_id.clone(), edge);
                                } else {
                                    let _ = watcher.store.delegation_failed(&edge, 0);
                                    watcher.emit_control(ServerMsg::DelegationFailed {
                                        edge_id: edge,
                                    });
                                }
                            }
                            // Registration for the replacement is complete
                            // (fallback state inside spawn, ticket transfer
                            // above) — release its exit watcher.
                            let _ = new_ready.send(());
                            let wt = watcher
                                .agents
                                .worktree(&new_id)
                                .map(|p| p.to_string_lossy().to_string());
                            watcher.emit_control(ServerMsg::Spawned {
                                agent_id: new_id,
                                name: fb.name.clone(),
                                command: cmd.clone(),
                                permission: fb.permission.clone(),
                                workspace_id: fb.workspace_id.clone(),
                                board_id: new_board.or(fb.board_id.clone()),
                                fallback_from: Some(command_cli(&fb.command).to_string()),
                                worktree: wt,
                            });
                        }
                    }
                }
                let _ = watcher.store.agent_status(&id, "exited");
                // Held input keyed to a dead agent can never be approved —
                // drop it. On fallback the re-injection re-holds against the
                // replacement through the gate.
                watcher.pending_inputs.lock().unwrap().remove(&id);
                // Close delegation tickets waiting on this agent: last-chance
                // CANVAS_RESULT scan, else fail so the board isn't stuck in
                // flight. Skipped when the agent fell back — its ticket moved
                // to the replacement and belongs to the replacement's exit.
                if !fell_back {
                    // The in-memory ticket map is the primary key (a fallback
                    // replacement inherits the ticket under its own id, while
                    // the store row keeps the original's); the store scan
                    // sweeps tickets the map no longer holds — e.g. one
                    // removed by a kill confirmation before the PTY died.
                    let mut edges: Vec<String> = watcher
                        .pending_results
                        .lock()
                        .unwrap()
                        .remove(&id)
                        .into_iter()
                        .collect();
                    for (edge_id, _) in watcher
                        .store
                        .unresolved_delegations()
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|(_, to)| to == &id)
                    {
                        if !edges.contains(&edge_id) {
                            edges.push(edge_id);
                        }
                    }
                    if !edges.is_empty() {
                        let summary = watcher
                            .agents
                            .scrollback(&id)
                            .map(|b| String::from_utf8_lossy(&b).to_string())
                            .and_then(|t| canvas_result_line(&t))
                            .map(|s| s.trim().to_string());
                        let repo = original_workspace
                            .as_deref()
                            .and_then(|w| watcher.store.workspace_repo(w).ok().flatten())
                            .map(PathBuf::from)
                            .unwrap_or_else(|| watcher.repo_root.clone());
                        let files = watcher
                            .store
                            .agent_worktree_abs(&id, &repo)
                            .ok()
                            .flatten()
                            .map(|w| dirty_file_count(&w))
                            .unwrap_or(0);
                        for edge_id in edges {
                            if let Some(summary) = summary.clone() {
                                let _ =
                                    watcher.store.delegation_resolved(&edge_id, &summary, files);
                                watcher.emit_control(ServerMsg::Result {
                                    edge_id,
                                    summary,
                                    files,
                                });
                            } else {
                                let _ = watcher.store.delegation_failed(&edge_id, files);
                                watcher.emit_control(ServerMsg::DelegationFailed { edge_id });
                            }
                        }
                    }
                }
                watcher.emit_control(ServerMsg::Status {
                    agent_id: id,
                    status: AgentStatus::Exited,
                });
            }
        }));

        let repo_root = match workspace_id.and_then(|w| self.store.workspace_repo(w).ok().flatten())
        {
            Some(repo) => PathBuf::from(repo),
            None => self.repo_root.clone(),
        };
        // Named account: per-account config dir so several sign-ins of the
        // same CLI coexist.
        let pty_env: Vec<(String, String)> = account_id
            .and_then(|a| self.store.account_record(a).ok().flatten())
            .and_then(|(cli, _label, dir, env)| {
                let abs = self.repo_root.join(&dir);
                let _ = std::fs::create_dir_all(&abs);
                // Account-level env override, else the CLI's known config-dir key.
                let key = env.or_else(|| crate::agent::account_env_key(&cli).map(str::to_string));
                key.map(|k| vec![(k, abs.to_string_lossy().to_string())])
            })
            .unwrap_or_default();
        // Workspace (or board) memory — injected as CANVAS_MEMORY.
        let mem_scope = workspace_id.unwrap_or("main");
        let mem_path = self.memory_path(mem_scope);
        if let Some(p) = mem_path.parent() {
            let _ = std::fs::create_dir_all(p);
        }
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
        let configured = workspace_id.and_then(|w| self.store.workspace_chain(w).ok().flatten());
        let chain =
            chain_override.unwrap_or_else(|| chain_for_spawn(configured, command_cli(command)));
        let mut remaining: Vec<String> = chain.iter().skip(1).cloned().collect();
        let mut cmd_attempt = command.to_string();
        let id = loop {
            match self.agents.spawn(
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
                        tracing::warn!(error = %e, cli = %command_cli(&cmd_attempt), fallback = %next, "spawn failed — trying fallback CLI");
                        cmd_attempt = substitute_cli(&cmd_attempt, &next);
                        remaining.remove(0);
                        continue;
                    }
                    return Err(e.to_string());
                }
            }
        };
        // Automation guardrails attach here — inside the spawn, before the
        // registration gate fires — so even a PTY dying in the meantime is
        // handled with the policy in place, and the fallback state carries it
        // to any replacement.
        if let Some((idle_secs, deny)) = automation {
            self.agents.set_automation(&id, idle_secs, deny);
        }
        if !remaining.is_empty() {
            self.pending_fallbacks.lock().unwrap().insert(
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
        // The persisted command is the one that actually launched, which may
        // be a fallback substitute of the requested one.
        let command = cmd_attempt.as_str();
        // Board: explicit, else the workspace's board, else 'main'.
        let board = board_id
            .map(|b| b.to_string())
            .or_else(|| workspace_id.and_then(|w| self.store.workspace_board(w).ok().flatten()));
        if let Err(e) = self.store.agent_spawned(
            &id,
            name,
            command,
            &format!(".canvas-worktrees/{id}"),
            workspace_id,
            permission,
            board.as_deref(),
            account_id,
        ) {
            tracing::warn!(error = %e, "failed to persist agent");
        }
        Ok((id, board, ready_tx))
    }

    /// Normal node spawn: low-level spawn + quick-request injection + Spawned event.
    pub fn spawn_node(&self, params: SpawnParams) -> Result<String, String> {
        let level = protocol::normalize_permission(params.permission.as_deref());
        let (id, board, ready) = self.spawn(
            &params.name,
            &params.command,
            &params.cwd,
            params.workspace_id.as_deref(),
            level,
            params.board_id.as_deref(),
            params.account_id.as_deref(),
            params.initial_input.as_deref(),
            None,
            None,
        )?;
        if let Some(text) = params.initial_input.clone() {
            // Quick request: type the task once the CLI has booted. The copy
            // in the fallback state is NOT cleared on write — fallback only
            // fires when the original died within seconds of launch, so its
            // copy of the task never completed and re-running it on the
            // replacement is the correct retry semantics.
            let delayed = self.clone();
            let target = id.clone();
            (self.spawner)(Box::pin(async move {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                let mut data = text.into_bytes();
                data.push(b'\r');
                // Initial prompts use the same supervised destructive-input
                // gate as typed input; a held prompt can then only be released
                // by the native UI.
                let _ = delayed.gated_write(&target, &data);
            }));
        }
        // Normal spawns register nothing beyond what spawn already did —
        // release the exit watcher.
        let _ = ready.send(());
        let wt = self
            .agents
            .worktree(&id)
            .map(|p| p.to_string_lossy().to_string());
        self.emit_control(ServerMsg::Spawned {
            agent_id: id.clone(),
            name: params.name,
            command: params.command,
            permission: level.to_string(),
            workspace_id: params.workspace_id,
            board_id: board,
            fallback_from: None,
            worktree: wt,
        });
        Ok(id)
    }

    /// Delegation: spawn a child and persist its result edge. The child must
    /// never climb above its parent's permission level.
    pub fn delegate(&self, params: DelegateParams) -> Result<String, String> {
        let parent_level = self
            .store
            .agent_permission(&params.from)
            .ok()
            .flatten()
            .ok_or_else(|| format!("unknown delegation parent: {}", params.from))?;
        let requested = protocol::normalize_permission(params.permission.as_deref());
        let level = protocol::clamp_to_parent(requested, Some(&parent_level));
        // The child lands on the requested board, else its parent's
        // (orchestrator nodes aren't agents — they carry theirs over).
        let parent_board = params.board_id.clone().or(self
            .store
            .agent_board(&params.from)
            .ok()
            .flatten());
        let (id, board, ready) = self.spawn(
            &params.name,
            &params.command,
            &params.cwd,
            params.workspace_id.as_deref(),
            level,
            parent_board.as_deref(),
            params.account_id.as_deref(),
            params.initial_input.as_deref(),
            None,
            None,
        )?;
        let edge_id = format!("edge-{}", &id[..8.min(id.len())]);
        let _ = self
            .store
            .delegation_created(&edge_id, &params.from, &id, &params.task);
        self.pending_results
            .lock()
            .unwrap()
            .insert(id.clone(), edge_id.clone());
        // The delegation ticket is the registration the exit watcher needs —
        // release it only now that the ticket is in place.
        let _ = ready.send(());
        if let Some(text) = params.initial_input.clone() {
            // Type the brief once the CLI has booted (same delay as spawn).
            let delayed = self.clone();
            let target = id.clone();
            (self.spawner)(Box::pin(async move {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                let mut data = text.into_bytes();
                data.push(b'\r');
                // Delegated briefs are usually agent-authored. They must pass
                // the same supervised destructive-input gate as typed input;
                // a held brief can then only be released by the native UI.
                let _ = delayed.gated_write(&target, &data);
            }));
        }
        let wt = self
            .agents
            .worktree(&id)
            .map(|p| p.to_string_lossy().to_string());
        self.emit_control(ServerMsg::Spawned {
            agent_id: id.clone(),
            name: params.name,
            command: params.command,
            permission: level.to_string(),
            workspace_id: params.workspace_id,
            board_id: board,
            fallback_from: None,
            worktree: wt,
        });
        self.emit_control(ServerMsg::Delegation {
            edge_id,
            from: params.from,
            to: id.clone(),
            task: params.task,
        });
        Ok(id)
    }

    /// Register an artifact and emit the protocol event. Returns the wire
    /// shape so a transport can answer its caller without re-reading the DB.
    pub fn artifact_create(
        &self,
        board_id: Option<String>,
        agent_id: Option<String>,
        kind: String,
        title: String,
        path: Option<String>,
        text: Option<String>,
    ) -> Result<protocol::SnapshotArtifact, String> {
        let id = format!("art-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
        let board = board_id
            .or_else(|| {
                agent_id
                    .as_deref()
                    .and_then(|a| self.store.agent_board(a).ok().flatten())
            })
            .unwrap_or_else(|| "main".to_string());
        let agent_name = agent_id
            .as_deref()
            .and_then(|a| self.store.agent_name(a).ok().flatten());
        self.store
            .artifact_created(
                &id,
                &board,
                agent_id.as_deref(),
                &kind,
                &title,
                path.as_deref(),
                text.as_deref(),
            )
            .map_err(|e| e.to_string())?;
        let artifact = protocol::SnapshotArtifact {
            artifact_id: id,
            board_id: board,
            agent_id,
            agent_name,
            kind,
            title,
            path,
            text,
            created_at: String::new(),
        };
        self.emit_control(ServerMsg::ArtifactCreated {
            artifact: artifact.clone(),
        });
        Ok(artifact)
    }

    /// Operator-confirmed destructive actions. Prompt text alone can never
    /// reach this method; transports must expose it as an explicit gesture.
    pub fn confirm_destructive(&self, agent_id: &str, action: &str) -> Result<(), String> {
        match action {
            "kill" => {
                // A deliberate kill is operator intent — never retry the chain.
                // Disarm BEFORE signaling the PTY: the exit watcher fires as soon
                // as the process closes and would claim the retry while the kill
                // was still returning.
                self.pending_fallbacks.lock().unwrap().remove(agent_id);
                self.agents.kill(agent_id).map_err(|e| e.to_string())?;
                let _ = self.store.agent_status(agent_id, "exited");
                self.pending_results.lock().unwrap().remove(agent_id);
                self.emit_control(ServerMsg::Status {
                    agent_id: agent_id.to_string(),
                    status: AgentStatus::Exited,
                });
                Ok(())
            }
            "forget" => {
                // Forget is operator intent too — a live agent cleared within
                // seconds of launch must not respawn as a fallback. Disarm
                // BEFORE the kill so the exit watcher can't claim the retry
                // in between.
                self.pending_fallbacks.lock().unwrap().remove(agent_id);
                // no-op if the agent is already gone
                let _ = self.agents.kill(agent_id);
                self.store
                    .remove_agent(agent_id)
                    .map_err(|e| e.to_string())?;
                self.emit_control(ServerMsg::Status {
                    agent_id: agent_id.to_string(),
                    status: AgentStatus::Exited,
                });
                Ok(())
            }
            other => Err(format!("unknown destructive action: {other}")),
        }
    }

    pub fn approve_input(&self, agent_id: &str) -> Result<(), String> {
        let bytes = self.pending_inputs.lock().unwrap().remove(agent_id);
        match bytes {
            Some(b) => self.agents.write(agent_id, &b).map_err(|e| e.to_string()),
            None => Err("no pending input to approve".to_string()),
        }
    }
}
