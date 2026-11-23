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

pub struct AgentManager {
    agents: Mutex<HashMap<AgentId, Agent>>,
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

impl AgentManager {
    pub fn new() -> Self {
        Self { agents: Mutex::new(HashMap::new()) }
    }

    /// Spawn `command` in a PTY inside a fresh worktree of `repo_root`.
    /// Returns the agent id; output frames stream through `out_tx` as
    /// `(agent_id, raw_bytes)`.
    pub fn spawn(
        &self,
        name: &str,
        command: &str,
        cwd: &str,
        repo_root: &Path,
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
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
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
                            let excess = t.len().saturating_sub(4096);
                            if excess > 0 {
                                t.drain(..excess);
                            }
                        }
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
        agent.kill();
        info!(agent_id, "agent killed");
        Ok(())
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
}

fn uuid_like() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_cwd() {
        assert!(sanitize_relpath("../etc").is_err());
        assert!(sanitize_relpath("/tmp").is_err());
        assert!(sanitize_relpath("a/../b").is_err());
        assert!(sanitize_relpath("src/lib").is_ok());
    }
}
