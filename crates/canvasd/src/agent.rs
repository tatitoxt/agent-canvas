//! PTY agent lifecycle: spawn, input/output piping, resize, kill.
//! Each agent runs a real interactive CLI in its own PTY inside its own
//! git worktree, so two agents never share a working directory.

use anyhow::{Context, Result};
use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio::sync::mpsc;
use tracing::info;

pub type AgentId = String;

pub struct Agent {
    #[allow(dead_code)]
    pub id: AgentId,
    #[allow(dead_code)]
    pub name: String,
    #[allow(dead_code)]
    pub command: String,
    #[allow(dead_code)]
    pub worktree: PathBuf,
    /// Permission ladder level — gates PTY input the operator must approve.
    pub permission: String,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    /// Last PTY activity + rolling tail for status derivation. Shared with
    /// the reader thread via Arc so output updates land on the live agent.
    pub last_output_at: Arc<Mutex<std::time::Instant>>,
    pub tail: Arc<Mutex<Vec<u8>>>,
}

impl Agent {
    /// Derive a coarse status from PTY activity — CLI-agnostic. Where a CLI
    /// exposes real hooks later, they override this.
    pub fn derived_status(&self) -> &'static str {
        if !self.is_alive() {
            return "exited";
        }
        let quiet_for = self.last_output_at.lock().unwrap().elapsed();
        if quiet_for < std::time::Duration::from_secs(2) {
            return "working";
        }
        let tail = self.tail.lock().unwrap();
        let text = String::from_utf8_lossy(&tail);
        if looks_like_waiting_prompt(&text) {
            "waiting"
        } else {
            "idle"
        }
    }
}

/// Detect an interactive CLI or shell prompt from the text currently visible
/// at the end of a PTY buffer. PTYs redraw prompts with carriage returns and
/// CLIs commonly color the prompt, so inspect only the final visible segment
/// after removing ANSI escapes.
fn looks_like_waiting_prompt(tail: &str) -> bool {
    let Some(line) = tail.lines().last().and_then(|line| {
        line.split('\r')
            .rev()
            .map(strip_ansi)
            .map(|segment| segment.trim().to_string())
            .find(|segment| !segment.is_empty())
    }) else {
        return false;
    };
    let lower = line.to_lowercase();

    // Shell prompts and the prompt glyphs used by Claude Code and Codex.
    if line.ends_with(['$', '#', '>', '❯', '›']) {
        return true;
    }

    // Only treat approval language as a prompt when the visible line reads
    // like an actual question/action gate; ordinary output can mention these
    // words without waiting for input.
    let asks_for_approval = [
        "(y/n)",
        "[y/n]",
        "[y]",
        "(yes/no)",
        "do you want to proceed",
        "would you like to proceed",
        "needs your approval",
        "press enter to",
    ];
    asks_for_approval
        .iter()
        .any(|phrase| lower.contains(phrase))
        || ((lower.contains("allow") || lower.contains("approve") || lower.contains("permission"))
            && (line.ends_with('?')
                || lower.starts_with("allow ")
                || lower.starts_with("approve ")))
}

impl Agent {
    pub fn write(&self, data: &[u8]) -> Result<()> {
        self.writer.lock().unwrap().write_all(data)?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.master.lock().unwrap().resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    pub fn kill(&self) {
        let _ = self.child.lock().unwrap().kill();
    }

    /// SIGSTOP/SIGCONT the PTY child — Symvibe's "pause all": output
    /// queues in the kernel PTY buffer and the process resumes mid-line.
    #[cfg(unix)]
    fn signal(&self, sig: i32) -> bool {
        self.child
            .lock()
            .unwrap()
            .process_id()
            .map(|pid| unsafe { libc::kill(pid as i32, sig) == 0 })
            .unwrap_or(false)
    }

    #[cfg(unix)]
    pub fn suspend(&self) -> bool {
        self.signal(libc::SIGSTOP)
    }

    #[cfg(unix)]
    pub fn resume(&self) -> bool {
        self.signal(libc::SIGCONT)
    }

    /// Windows v1 has no agent pause/resume: SIGSTOP/SIGCONT do not exist
    /// and portable-pty exposes no process suspension primitive. Return
    /// false so pause-all reports zero signalled agents instead of
    /// pretending the freeze happened.
    #[cfg(not(unix))]
    pub fn suspend(&self) -> bool {
        false
    }

    #[cfg(not(unix))]
    pub fn resume(&self) -> bool {
        false
    }

    #[allow(dead_code)]
    pub fn is_alive(&self) -> bool {
        matches!(self.child.lock().unwrap().try_wait(), Ok(None))
    }
}

/// Automation run policy attached to a spawned agent (Deska-style
/// guardrails): how silent it may go before the operator is alerted, and
/// whether approval prompts auto-deny instead of waiting forever.
#[derive(Clone, Copy)]
pub struct AutoMeta {
    pub idle_secs: u64,
    pub deny_approvals: bool,
    /// Set once a hang alert fired; reset when output resumes.
    pub hang_notified: bool,
}

pub struct AgentManager {
    agents: Mutex<HashMap<AgentId, Agent>>,
    automation_meta: Mutex<HashMap<AgentId, AutoMeta>>,
    transcript_dir: Mutex<PathBuf>,
    extra_env: Mutex<HashMap<String, String>>,
}

/// Cap transcripts at ~1MB; when exceeded keep the newest 512KB.
const TRANSCRIPT_CAP: u64 = 1_048_576;

/// Append PTY output to the agent's transcript file — best effort, never
/// fails the read loop.
fn append_transcript(path: &Path, chunk: &[u8]) {
    use std::io::Seek;
    let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    else {
        return;
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len > TRANSCRIPT_CAP {
        // Keep the tail half; a rewrite is rare (once per ~1MB of output).
        if let Ok(data) = std::fs::read(path) {
            let keep = &data[data.len().saturating_sub((TRANSCRIPT_CAP / 2) as usize)..];
            let _ = f.set_len(0);
            let _ = f.seek(std::io::SeekFrom::Start(0));
            let _ = f.write_all(keep);
        }
    }
    let _ = f.write_all(chunk);
}

/// Ensure `cwd` stays inside `repo_root`: reject absolute paths, Windows
/// drive/UNC prefixes, and `..` using the platform's path-component parser
/// (so `..\x` is rejected on Windows as well as `../x` everywhere).
fn sanitize_relpath(cwd: &str) -> Result<PathBuf> {
    use std::path::Component;
    let rel = Path::new(cwd);
    if rel.components().any(|component| {
        matches!(
            component,
            Component::Prefix(_) | Component::RootDir | Component::ParentDir
        )
    }) {
        anyhow::bail!("cwd must be a repo-relative path without '..'");
    }
    Ok(rel.to_path_buf())
}

/// A commitless repository has no HEAD for `git worktree add` to branch
/// from, so every spawn dies before the PTY exists — the first-run failure
/// of a fresh `~/Canvas`. Bootstrap one empty commit so the worktree model
/// holds in scratch repos. Best effort: a missing git binary or a directory
/// that is not a git repo at all falls through to the worktree error, which
/// the caller surfaces to the operator.
pub fn ensure_initial_commit(repo_root: &Path) {
    let head_resolves = std::process::Command::new("git")
        .args(["rev-parse", "--verify", "HEAD"])
        .current_dir(repo_root)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if head_resolves {
        return;
    }
    // Only bootstrap inside an existing git repository — never `git init`
    // a plain directory as a side effect of spawning a terminal.
    let is_repo = std::process::Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(repo_root)
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false);
    if !is_repo {
        return;
    }
    // Inline identity: a fresh machine may have no user.name/user.email
    // configured, and --no-gpg-sign keeps commit.gpgsign=true setups from
    // blocking on a key prompt. The commit is empty — no content authorship.
    let _ = std::process::Command::new("git")
        .args([
            "-c",
            "user.name=Canvas",
            "-c",
            "user.email=canvas@localhost",
            "commit",
            "--allow-empty",
            "--no-gpg-sign",
            "-m",
            "canvas: initial commit",
        ])
        .current_dir(repo_root)
        .output();
}

/// Create (or reuse) a git worktree for the agent under
/// `<repo>/.canvas-worktrees/<agent_id>`.
fn ensure_worktree(repo_root: &Path, agent_id: &str, branch: &str) -> Result<PathBuf> {
    let dir = repo_root.join(".canvas-worktrees").join(agent_id);
    if dir.exists() {
        return Ok(dir);
    }
    ensure_initial_commit(repo_root);
    let status = std::process::Command::new("git")
        .args([
            "worktree",
            "add",
            "-b",
            &format!("canvas/{branch}-{agent_id}"),
            dir.to_str().context("non-utf8 worktree path")?,
            "HEAD",
        ])
        .current_dir(repo_root)
        .output()
        .context("failed to run git worktree add")?;
    if !status.status.success() {
        anyhow::bail!(
            "git worktree add failed: {}",
            String::from_utf8_lossy(&status.stderr)
        );
    }
    Ok(dir)
}

/// Build the platform shell used to launch an agent command inside the PTY.
///
/// Unix needs a bash shim because the slave PTY starts in ECHO+ICANON mode:
/// query replies sent before the child CLI configures termios would otherwise
/// be echoed into the scrollback and line-buffered away from the child. The
/// shim disables both, then `exec`s the requested command so the shell does
/// not remain as an extra process.
#[cfg(unix)]
fn shell_command(command: &str) -> CommandBuilder {
    let mut cmd = CommandBuilder::new("/bin/bash");
    cmd.arg("-lc");
    cmd.arg(format!("stty -echo -icanon 2>/dev/null; exec {}", command));
    cmd
}

/// Windows uses ConPTY rather than Unix termios, so there is no `stty` race
/// to work around. `cmd /C` preserves the existing command-line shape: agent
/// commands may include flags or cmd shell syntax, and the interactive child
/// still runs attached to the ConPTY.
#[cfg(windows)]
fn shell_command(command: &str) -> CommandBuilder {
    let shell = std::env::var_os("ComSpec").unwrap_or_else(|| "cmd.exe".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("/C");
    cmd.arg(command);
    cmd
}

/// Prepend the directory holding this binary to PATH so `canvasctl` is
/// reachable inside every PTY, using the host platform's PATH separator.
fn path_with_exe_dir() -> Option<std::ffi::OsString> {
    let exe_dir = std::env::current_exe()
        .ok()?
        .parent()
        .map(|dir| dir.to_path_buf())?;
    let mut entries = vec![exe_dir];
    if let Some(path) = std::env::var_os("PATH") {
        entries.extend(std::env::split_paths(&path));
    }
    std::env::join_paths(entries).ok()
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentManager {
    pub fn new() -> Self {
        Self {
            agents: Mutex::new(HashMap::new()),
            automation_meta: Mutex::new(HashMap::new()),
            transcript_dir: Mutex::new(
                std::env::current_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .join(".canvas")
                    .join("transcripts"),
            ),
            extra_env: Mutex::new(HashMap::new()),
        }
    }

    /// Extra env injected into every spawned PTY — the daemon seeds
    /// CANVAS_TOKEN/CANVAS_PORT here so `canvasctl` can reach it.
    pub fn set_env(&self, key: &str, value: &str) {
        self.extra_env
            .lock()
            .unwrap()
            .insert(key.to_string(), value.to_string());
    }

    /// Where per-agent transcript files live (`<dir>/<agent_id>.bin`).
    /// Overridable because the Tauri app's cwd is not the repo.
    pub fn set_transcript_dir(&self, dir: impl Into<PathBuf>) {
        *self.transcript_dir.lock().unwrap() = dir.into();
    }

    /// Spawn `command` in a PTY inside a fresh worktree of `repo_root`.
    /// Returns the agent id; output frames stream through `out_tx` as
    /// `(agent_id, raw_bytes)`.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        &self,
        name: &str,
        command: &str,
        cwd: &str,
        repo_root: &Path,
        permission: &str,
        out_tx: mpsc::UnboundedSender<(AgentId, Vec<u8>)>,
        exit_tx: mpsc::UnboundedSender<AgentId>,
        pty_env: &[(String, String)],
    ) -> Result<AgentId> {
        let rel = sanitize_relpath(cwd)?;
        let id = uuid_like();
        let worktree = ensure_worktree(repo_root, &id, name)?;
        let spawn_dir = worktree.join(&rel);

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        // Allowlisted env: the PTY does not inherit arbitrary session env.
        let mut cmd = shell_command(command);
        cmd.cwd(&spawn_dir);
        cmd.env("TERM", "xterm-256color");
        cmd.env("CANVAS_AGENT_ID", &id);
        // The PTY's HOME comes from the portable resolver: $HOME verbatim
        // when set (identical to before), the passwd entry when unset —
        // the old `/` fallback only ever applied on a home-less system.
        #[cfg(unix)]
        cmd.env(
            "HOME",
            crate::paths::home_dir()
                .unwrap_or_else(|| PathBuf::from("/"))
                .to_string_lossy()
                .to_string(),
        );
        // Many agent CLIs read HOME even on Windows. Populate it from the
        // real user profile instead of the Unix-only `/` fallback — env
        // first (an intentional USERPROFILE redirect must win), then the
        // known-folder API for environments where the variables are absent.
        #[cfg(windows)]
        if let Some(home) = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
            .or_else(crate::paths::home_dir)
        {
            cmd.env("HOME", home);
        }
        for (k, v) in self.extra_env.lock().unwrap().iter() {
            cmd.env(k, v);
        }
        for (k, v) in pty_env {
            cmd.env(k, v);
        }
        // Put the directory holding this binary (canvasd / the app) first
        // on PATH so `canvasctl` is reachable inside every PTY. If the exe
        // path is unavailable, CommandBuilder still inherits the ambient PATH.
        if let Some(path) = path_with_exe_dir() {
            cmd.env("PATH", path);
        }

        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        let agent_id = id.clone();
        let last_output_at = Arc::new(Mutex::new(std::time::Instant::now()));
        let tail = Arc::new(Mutex::new(Vec::new()));
        let last_for_reader = last_output_at.clone();
        let tail_for_reader = tail.clone();
        let id_for_reader = id.clone();
        let transcript_dir = self.transcript_dir.lock().unwrap().clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let _ = std::fs::create_dir_all(&transcript_dir);
            let transcript_path = transcript_dir.join(format!("{}.bin", id_for_reader));
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => {
                        let _ = exit_tx.send(id_for_reader.clone());
                        break;
                    }
                    Ok(n) => {
                        *last_for_reader.lock().unwrap() = std::time::Instant::now();
                        {
                            let mut t = tail_for_reader.lock().unwrap();
                            t.extend_from_slice(&buf[..n]);
                            // 64KB scrollback: doubles as the transcript
                            // replayed to clients on (re)connect.
                            let excess = t.len().saturating_sub(65_536);
                            if excess > 0 {
                                t.drain(..excess);
                            }
                        }
                        append_transcript(&transcript_path, &buf[..n]);
                        if out_tx
                            .send((id_for_reader.clone(), buf[..n].to_vec()))
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        });

        let agent = Agent {
            id: id.clone(),
            name: name.to_string(),
            command: command.to_string(),
            worktree,
            permission: permission.to_string(),
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
            last_output_at,
            tail,
        };
        self.agents.lock().unwrap().insert(agent_id.clone(), agent);
        info!(agent_id, name, command, "agent spawned");
        Ok(agent_id)
    }

    pub fn write(&self, agent_id: &str, data: &[u8]) -> Result<()> {
        let agents = self.agents.lock().unwrap();
        let agent = agents.get(agent_id).context("no such agent")?;
        agent.write(data)
    }

    pub fn resize(&self, agent_id: &str, cols: u16, rows: u16) -> Result<()> {
        let agents = self.agents.lock().unwrap();
        let agent = agents.get(agent_id).context("no such agent")?;
        agent.resize(cols, rows)
    }

    /// Suspend/resume a set of live agents (pause-all on a board).
    /// Returns how many were actually signalled.
    pub fn suspend_many(&self, ids: &[String]) -> usize {
        let agents = self.agents.lock().unwrap();
        ids.iter()
            .filter(|id| agents.get(*id).map(|a| a.suspend()).unwrap_or(false))
            .count()
    }

    pub fn resume_many(&self, ids: &[String]) -> usize {
        let agents = self.agents.lock().unwrap();
        ids.iter()
            .filter(|id| agents.get(*id).map(|a| a.resume()).unwrap_or(false))
            .count()
    }

    /// Kill is gated: callers must have received an explicit ConfirmDestructive
    /// first — enforced by the caller in main.rs, not by prompt text.
    pub fn kill(&self, agent_id: &str) -> Result<()> {
        let mut agents = self.agents.lock().unwrap();
        let agent = agents.remove(agent_id).context("no such agent")?;
        drop(agents);
        self.automation_meta.lock().unwrap().remove(agent_id);
        agent.kill();
        info!(agent_id, "agent killed");
        Ok(())
    }

    /// Attach automation guardrails to a live agent.
    pub fn set_automation(&self, id: &str, idle_secs: u64, deny_approvals: bool) {
        self.automation_meta.lock().unwrap().insert(
            id.to_string(),
            AutoMeta {
                idle_secs,
                deny_approvals,
                hang_notified: false,
            },
        );
    }

    /// The agent's automation policy, if it was spawned by a run.
    pub fn automation(&self, id: &str) -> Option<AutoMeta> {
        self.automation_meta.lock().unwrap().get(id).copied()
    }

    /// Drop automation guardrails for an agent that exited on its own.
    /// A dead agent is never "hung" — without this its metadata keeps
    /// aging in the hang ticker and fires a spurious idle alert. On a
    /// chain fallback the guardrails already ride the replacement.
    pub fn clear_automation(&self, id: &str) {
        self.automation_meta.lock().unwrap().remove(id);
    }

    /// Hang detection for the ticker: seconds since the agent's last PTY
    /// output — `None` for unknown agents.
    pub fn silent_for(&self, id: &str) -> Option<u64> {
        self.agents
            .lock()
            .unwrap()
            .get(id)
            .map(|a| a.last_output_at.lock().unwrap().elapsed().as_secs())
    }

    pub fn set_hang_notified(&self, id: &str, notified: bool) {
        if let Some(m) = self.automation_meta.lock().unwrap().get_mut(id) {
            m.hang_notified = notified;
        }
    }

    /// Rolling PTY scrollback (last ~64KB) for transcript replay. Falls
    /// back to the on-disk transcript for agents that already exited (or
    /// lived under a previous daemon run).
    pub fn scrollback(&self, id: &str) -> Option<Vec<u8>> {
        if let Some(a) = self.agents.lock().unwrap().get(id) {
            return Some(a.tail.lock().unwrap().clone());
        }
        let path = self
            .transcript_dir
            .lock()
            .unwrap()
            .join(format!("{}.bin", id));
        let data = std::fs::read(&path).ok()?;
        let start = data.len().saturating_sub(65_536);
        Some(data[start..].to_vec())
    }

    /// Agent ids that carry automation guardrails — the hang ticker scans
    /// only these.
    pub fn automation_ids(&self) -> Vec<AgentId> {
        self.automation_meta
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect()
    }

    #[allow(dead_code)]
    pub fn list(&self) -> Vec<AgentId> {
        self.agents.lock().unwrap().keys().cloned().collect()
    }

    /// Snapshot of `(agent_id, derived_status)` for the status ticker.
    pub fn statuses(&self) -> Vec<(AgentId, &'static str)> {
        self.agents
            .lock()
            .unwrap()
            .iter()
            .map(|(id, a)| (id.clone(), a.derived_status()))
            .collect()
    }

    /// Live agent ids — for the activity ticker.
    pub fn ids(&self) -> Vec<String> {
        self.agents.lock().unwrap().keys().cloned().collect()
    }

    /// Change a live agent's permission level in place.
    pub fn set_permission(&self, id: &str, level: &str) {
        if let Some(a) = self.agents.lock().unwrap().get_mut(id) {
            a.permission = level.to_string();
        }
    }

    /// Agent's worktree path — for the diff ticker (`git status`).
    /// Permission level for a live agent — `None` if it already exited.
    pub fn permission(&self, id: &str) -> Option<String> {
        self.agents
            .lock()
            .unwrap()
            .get(id)
            .map(|a| a.permission.clone())
    }

    pub fn worktree(&self, id: &str) -> Option<PathBuf> {
        self.agents
            .lock()
            .unwrap()
            .get(id)
            .map(|a| a.worktree.clone())
    }

    /// Rolling PTY tail as text, for the CANVAS_RESULT scanner.
    pub fn tail_text(&self, id: &str) -> Option<String> {
        self.agents
            .lock()
            .unwrap()
            .get(id)
            .map(|a| String::from_utf8_lossy(&a.tail.lock().unwrap()).to_string())
    }
}

/// Last non-empty PTY line with ANSI sequences stripped — the one-line
/// preview the node card shows (Deska-style background summaries).
pub fn last_visible_line(tail: &str) -> Option<String> {
    tail.lines()
        .rev()
        .map(strip_ansi)
        .map(|l| l.trim().to_string())
        .find(|l| !l.is_empty())
        .map(|l| l.chars().take(160).collect())
}

/// `CANVAS_RESULT: <summary>` from a child PTY — the delegation edge's
/// return value. ANSI-stripped first: real PTYs wrap output in escape
/// sequences (bracketed paste, colors), so a raw prefix match misses.
/// `\r` inside a line is a cursor return (prompt redraw before the real
/// output) — only the last segment is what the screen actually shows.
pub fn canvas_result_line(tail: &str) -> Option<String> {
    tail.lines()
        .rev()
        .find_map(|l| {
            // Check the last non-empty \r-segment BEFORE stripping:
            // strip_ansi drops carriage returns, which would fuse a redrawn
            // prompt with the real output. Only the final segment is what
            // the screen actually shows — a result overwritten by later
            // output on the same line doesn't count, while a CRLF-writing
            // child leaves \r\r\n and its empty tail must be skipped.
            let segments: Vec<String> = l
                .split('\r')
                .map(strip_ansi)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            let visible = segments.last()?;
            if let Some(result) = visible.strip_prefix("CANVAS_RESULT:") {
                return Some(result.trim().to_string());
            }
            if let Some((prefix, result)) = visible.split_once("CANVAS_RESULT:") {
                if prefix.trim_end().ends_with(['$', '#']) {
                    return Some(result.trim().to_string());
                }
            }
            if visible.ends_with(['$', '#']) {
                let previous = segments.iter().rev().nth(1)?;
                let (prefix, result) = previous.split_once("CANVAS_RESULT:")?;
                if prefix.trim_end().ends_with(['$', '#']) {
                    return Some(result.trim().to_string());
                }
            }

            None
        })
        .filter(|s| !s.is_empty())
}

/// Destructive patterns gated on `supervised` agents: if the operator
/// (or a script via `pty_input`) sends a command line containing one of
/// these, the daemon holds it and asks for explicit approval instead of
/// writing it to the PTY. Supervised means supervised.
const SENSITIVE_PATTERNS: &[&str] = &[
    "rm -rf",
    "rm -fr",
    "rm -r ",
    "sudo ",
    "su -",
    "git push -f",
    "git push --force",
    "git reset --hard",
    "git clean -f",
    "drop table",
    "drop database",
    "truncate table",
    "mkfs",
    "dd if=",
    "> /dev/",
    "chmod -r",
    "chown -r",
    "kill -9",
    "pkill -9",
    "killall",
    "npm publish",
    "cargo publish",
    "gh release",
    "shutdown",
    "reboot",
    ":(){ :|:& };:",
];

/// Returns the offending line (trimmed, ≤160 chars) when a PTY-input
/// payload contains a gated command, else `None`.
pub fn sensitive_line(payload: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(payload);
    let clean = strip_ansi(&text);
    for line in clean.lines() {
        let l = line.trim().to_lowercase();
        if l.len() < 3 {
            continue;
        }
        if SENSITIVE_PATTERNS.iter().any(|p| l.contains(p)) {
            return Some(l.chars().take(160).collect());
        }
    }
    None
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.peek() {
                Some(&'[') => {
                    // CSI: ESC [ params…final-byte.
                    chars.next();
                    while let Some(&p) = chars.peek() {
                        chars.next();
                        if p.is_ascii_alphabetic() || p == '@' {
                            break;
                        }
                    }
                }
                Some(&']') => {
                    // OSC: ESC ] … BEL or ESC \ terminator.
                    chars.next();
                    let mut prev = '\0';
                    while let Some(&p) = chars.peek() {
                        chars.next();
                        if p == '\u{7}' || (prev == '\u{1b}' && p == '\\') {
                            break;
                        }
                        prev = p;
                    }
                }
                _ => {
                    chars.next();
                }
            }
        } else if c != '\r' && c != '\u{7}' {
            out.push(c);
        }
    }
    out
}

/// Paths with uncommitted changes in a worktree — parsed from
/// `git status --porcelain` (handles `??` and `old -> new` renames).
/// `-uall` expands untracked directories into their files — otherwise a
/// new dir counts as one entry and hides what the child actually wrote.
pub fn dirty_files(worktree: &Path) -> Vec<String> {
    let Ok(out) = std::process::Command::new("git")
        .args(["status", "--porcelain=v1", "--untracked-files=all"])
        .current_dir(worktree)
        .output()
    else {
        return Vec::new();
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let path = l.get(3..)?.trim();
            let path = path.split(" -> ").last().unwrap_or(path).trim_matches('"');
            if path.is_empty() {
                None
            } else {
                Some(path.to_string())
            }
        })
        .take(200)
        .collect()
}

/// Unified diff of uncommitted work in a worktree — what the delegation
/// edge actually produced. Includes untracked files via `git add -N` so
/// new files show up; capped so a huge diff can't flood the socket.
pub fn dirty_diff(worktree: &Path) -> String {
    // Intent-to-add makes `git diff` cover untracked files too.
    let _ = std::process::Command::new("git")
        .args(["add", "-N", "."])
        .current_dir(worktree)
        .output();
    let Ok(out) = std::process::Command::new("git")
        .args(["diff", "--no-color", "--no-ext-diff", "HEAD"])
        .current_dir(worktree)
        .output()
    else {
        return String::new();
    };
    let text = String::from_utf8_lossy(&out.stdout);
    const CAP: usize = 96_000;
    if text.len() > CAP {
        let mut cut = text[..CAP].to_string();
        cut.push_str("\n… diff truncated\n");
        cut
    } else {
        text.into_owned()
    }
}

/// Files with uncommitted changes in a worktree — the node's "files
/// changed" badge. Untracked files count too (`??` lines).
pub fn dirty_file_count(worktree: &Path) -> u32 {
    dirty_files(worktree).len() as u32
}

/// Current branch of the agent's worktree (`canvas/<name>-<id>`) — the
/// node's branch badge; empty string when git can't answer.
pub fn worktree_branch(worktree: &Path) -> String {
    std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(worktree)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD")
        .unwrap_or_default()
}

fn uuid_like() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

/// Env var that points a CLI at a per-account config dir, so two
/// accounts of the same CLI keep separate auth. `None` = the CLI has no
/// documented config-dir override.
pub fn account_env_key(cli: &str) -> Option<&'static str> {
    match cli {
        c if c.contains("codex") => Some("CODEX_HOME"),
        c if c.contains("claude") => Some("CLAUDE_CONFIG_DIR"),
        c if c.contains("gemini") => Some("GEMINI_CLI_HOME"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canvas_result_survives_pty_escapes() {
        // Real PTYs wrap output: bracketed-paste end + \r precede the line.
        let tail =
            "$ echo 'CANVAS_RESULT: shipped it'\r\n\u{1b}[?2004l\rCANVAS_RESULT: shipped it\r\n$ ";
        assert_eq!(canvas_result_line(tail).as_deref(), Some("shipped it"));
        // A real shell prints its prompt, then \r-overwrites with output —
        // the visible line is only what follows the last carriage return.
        let tail = "user@box:~/repo$ \u{1b}[?2004l\rCANVAS_RESULT: shipped it\r\nuser@box:~/repo$ ";
        assert_eq!(canvas_result_line(tail).as_deref(), Some("shipped it"));
        // A child that writes CRLF gets its LF expanded again by the PTY
        // (\r\r\n on the wire): the empty last segment must not hide it.
        let tail = "user@box:~/repo$ \rCANVAS_RESULT: shipped it\r\r\nuser@box:~/repo$ ";
        assert_eq!(canvas_result_line(tail).as_deref(), Some("shipped it"));
        // Result-looking text overwritten by later output on the same
        // line is not a result — the screen no longer shows it.
        assert_eq!(
            canvas_result_line("x \rCANVAS_RESULT: stale\rnext output"),
            None
        );
        assert_eq!(
            canvas_result_line("bash-3.2$ CANVAS_RESULT: shipped it\rbash-3.2$ "),
            Some("shipped it".to_string())
        );
        let macos_bash_tail = concat!(
            "\r\nThe default interactive shell is now zsh.\r\n",
            "To update your account to use zsh.\r\n",
            "\u{1b}[?1034hbash-3.2$ CANVAS_RESULT: shipped it\r\n",
            "bash-3.2$ "
        );
        assert_eq!(
            canvas_result_line(macos_bash_tail).as_deref(),
            Some("shipped it")
        );
        assert_eq!(canvas_result_line("$ echo hi\r\nhi\r\n$ "), None);
    }

    #[test]
    fn sensitive_input_is_detected_through_escapes() {
        assert_eq!(
            sensitive_line(b"rm -rf ~/work\r").as_deref(),
            Some("rm -rf ~/work")
        );
        assert!(sensitive_line(b"sudo apt install x\n").is_some());
        assert!(sensitive_line(b"git push --force origin main\n").is_some());
        assert!(sensitive_line(b"ls -la\n").is_none());
        assert!(sensitive_line(b"git push origin feature\n").is_none());
        // ANSI-wrapped input still matches (real PTYs interleave escapes).
        assert!(sensitive_line("\u{1b}[?2004lrm -rf x\r".as_bytes()).is_some());
    }

    #[test]
    fn ansi_stripping_yields_last_visible_line() {
        let tail = "\u{1b}[32mok\u{1b}[0m\r\n\u{1b}[1mworking…\u{1b}[0m\n";
        assert_eq!(last_visible_line(tail).as_deref(), Some("working…"));
    }

    #[test]
    fn waiting_prompt_detection_handles_cli_glyphs_and_pty_redraws() {
        assert!(looks_like_waiting_prompt("\u{1b}[32m❯\u{1b}[0m "));
        assert!(looks_like_waiting_prompt("\u{1b}[34m›\u{1b}[0m "));
        assert!(looks_like_waiting_prompt("user@box:~/repo$ "));
        assert!(looks_like_waiting_prompt(
            "working…\r\u{1b}[33mAllow this action?\u{1b}[0m "
        ));
        assert!(looks_like_waiting_prompt("Continue? [Y/n]"));
        assert!(!looks_like_waiting_prompt(
            "The agent will allow this when ready"
        ));
        assert!(!looks_like_waiting_prompt("Implemented approval handling."));
        assert!(!looks_like_waiting_prompt("working…"));
    }

    #[test]
    fn rejects_unsafe_cwd() {
        assert!(sanitize_relpath("../etc").is_err());
        assert!(sanitize_relpath("/tmp").is_err());
        assert!(sanitize_relpath("a/../b").is_err());
        assert!(sanitize_relpath("src/lib").is_ok());
    }

    fn git_temp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "canvas-agent-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn git(args: &[&str], cwd: &Path) -> std::process::Output {
        std::process::Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap()
    }

    fn head_resolves(repo: &Path) -> bool {
        git(&["rev-parse", "--verify", "HEAD"], repo)
            .status
            .success()
    }

    #[test]
    fn worktree_bootstraps_commitless_repo() {
        // The first-run ~/Canvas failure: `git init` happened but no commit
        // exists, so HEAD is unborn and plain `git worktree add … HEAD` dies.
        let repo = git_temp_root();
        assert!(git(&["init"], &repo).status.success());
        assert!(!head_resolves(&repo));

        let wt = ensure_worktree(&repo, "testagent01", "Terminal").unwrap();
        assert!(wt.exists());
        assert!(head_resolves(&repo));
        // Exactly one commit — the empty bootstrap — and the worktree branch
        // forked off it.
        let log = git(&["log", "--oneline"], &repo);
        assert_eq!(String::from_utf8_lossy(&log.stdout).lines().count(), 1);
        let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"], &wt);
        assert_eq!(
            String::from_utf8_lossy(&branch.stdout).trim(),
            "canvas/Terminal-testagent01"
        );
        std::fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn bootstrap_does_not_add_commits_to_a_committed_repo() {
        let repo = git_temp_root();
        assert!(git(&["init"], &repo).status.success());
        ensure_initial_commit(&repo);
        assert!(head_resolves(&repo));
        // Second run is a no-op — one commit total, not one per spawn.
        ensure_initial_commit(&repo);
        let log = git(&["log", "--oneline"], &repo);
        assert_eq!(String::from_utf8_lossy(&log.stdout).lines().count(), 1);
        std::fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn bootstrap_never_inits_a_plain_directory() {
        let dir = git_temp_root();
        ensure_initial_commit(&dir);
        assert!(!dir.join(".git").exists());
        // …and the worktree failure still surfaces rather than being hidden.
        assert!(ensure_worktree(&dir, "testagent02", "Terminal").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
