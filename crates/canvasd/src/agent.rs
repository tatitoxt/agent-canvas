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
        let last_line = text.lines().last().unwrap_or("").trim_end();
        let promptish = last_line.ends_with('$')
            || last_line.ends_with('#')
            || last_line.ends_with('>')
            || last_line.ends_with(":?")
            || last_line.contains("(y/n)")
            || last_line.contains("[Y/n]")
            || last_line.contains("Allow")
            || last_line.contains("approve");
        if promptish {
            "waiting"
        } else {
            "idle"
        }
    }
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
}

/// Cap transcripts at ~1MB; when exceeded keep the newest 512KB.
const TRANSCRIPT_CAP: u64 = 1_048_576;

/// Append PTY output to the agent's transcript file — best effort, never
/// fails the read loop.
fn append_transcript(path: &Path, chunk: &[u8]) {
    use std::io::Seek;
    let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) else {
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

/// Ensure `cwd` stays inside `repo_root`: reject absolute paths and `..`.
fn sanitize_relpath(cwd: &str) -> Result<PathBuf> {
    let rel = Path::new(cwd);
    if rel.is_absolute() || cwd.split('/').any(|seg| seg == "..") {
        anyhow::bail!("cwd must be a repo-relative path without '..'");
    }
    Ok(rel.to_path_buf())
}

/// Create (or reuse) a git worktree for the agent under
/// `<repo>/.canvas-worktrees/<agent_id>`.
fn ensure_worktree(repo_root: &Path, agent_id: &str, branch: &str) -> Result<PathBuf> {
    let dir = repo_root.join(".canvas-worktrees").join(agent_id);
    if dir.exists() {
        return Ok(dir);
    }
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
        }
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
        let mut cmd = CommandBuilder::new("/bin/bash");
        cmd.arg("-lc");
        cmd.arg(command);
        cmd.cwd(&spawn_dir);
        cmd.env("TERM", "xterm-256color");
        cmd.env("CANVAS_AGENT_ID", &id);
        cmd.env("HOME", std::env::var("HOME").unwrap_or_else(|_| "/".into()));
        cmd.env("PATH", std::env::var("PATH").unwrap_or_default());

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
                        if out_tx.send((id_for_reader.clone(), buf[..n].to_vec())).is_err() {
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
            AutoMeta { idle_secs, deny_approvals, hang_notified: false },
        );
    }

    /// The agent's automation policy, if it was spawned by a run.
    pub fn automation(&self, id: &str) -> Option<AutoMeta> {
        self.automation_meta.lock().unwrap().get(id).copied()
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
        let path = self.transcript_dir.lock().unwrap().join(format!("{}.bin", id));
        let data = std::fs::read(&path).ok()?;
        let start = data.len().saturating_sub(65_536);
        Some(data[start..].to_vec())
    }

    /// Agent ids that carry automation guardrails — the hang ticker scans
    /// only these.
    pub fn automation_ids(&self) -> Vec<AgentId> {
        self.automation_meta.lock().unwrap().keys().cloned().collect()
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

    /// Agent's worktree path — for the diff ticker (`git status`).
    /// Permission level for a live agent — `None` if it already exited.
    pub fn permission(&self, id: &str) -> Option<String> {
        self.agents.lock().unwrap().get(id).map(|a| a.permission.clone())
    }

    pub fn worktree(&self, id: &str) -> Option<PathBuf> {
        self.agents.lock().unwrap().get(id).map(|a| a.worktree.clone())
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
pub fn canvas_result_line(tail: &str) -> Option<String> {
    tail.lines()
        .rev()
        .map(strip_ansi)
        .find_map(|l| {
            l.trim()
                .strip_prefix("CANVAS_RESULT:")
                .map(|s| s.trim().to_string())
        })
        .filter(|s| !s.is_empty())
}

/// Destructive patterns gated on `supervised` agents: if the operator
/// (or a script via `pty_input`) sends a command line containing one of
/// these, the daemon holds it and asks for explicit approval instead of
/// writing it to the PTY. Supervised means supervised.
const SENSITIVE_PATTERNS: &[&str] = &[
    "rm -rf", "rm -fr", "rm -r ",
    "sudo ", "su -",
    "git push -f", "git push --force", "git reset --hard", "git clean -f",
    "drop table", "drop database", "truncate table",
    "mkfs", "dd if=", "> /dev/",
    "chmod -r", "chown -r",
    "kill -9", "pkill -9", "killall",
    "npm publish", "cargo publish", "gh release",
    "shutdown", "reboot", ":(){ :|:& };:",
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

/// Files with uncommitted changes in a worktree — the node's "files
/// changed" badge. Untracked files count too (`??` lines).
pub fn dirty_file_count(worktree: &Path) -> u32 {
    std::process::Command::new("git")
        .args(["status", "--porcelain=v1"])
        .current_dir(worktree)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().count() as u32)
        .unwrap_or(0)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canvas_result_survives_pty_escapes() {
        // Real PTYs wrap output: bracketed-paste end + \r precede the line.
        let tail = "$ echo 'CANVAS_RESULT: shipped it'\r\n\u{1b}[?2004l\rCANVAS_RESULT: shipped it\r\n$ ";
        assert_eq!(canvas_result_line(tail).as_deref(), Some("shipped it"));
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
    fn rejects_unsafe_cwd() {
        assert!(sanitize_relpath("../etc").is_err());
        assert!(sanitize_relpath("/tmp").is_err());
        assert!(sanitize_relpath("a/../b").is_err());
        assert!(sanitize_relpath("src/lib").is_ok());
    }
}
