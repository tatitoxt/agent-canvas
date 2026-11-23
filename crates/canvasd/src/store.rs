//! Local-first persistence: one SQLite file per board under
//! `<repo>/.canvas/board.db`. Boards also export to JSON for diffing/git.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

/// Row of the agents table: (id, name, command, worktree, status,
/// workspace_id, permission).
pub type AgentRow = (String, String, String, String, String, Option<String>, String);
/// Row of the delegations table: (id, from, to, task, result, state,
/// files_changed).
pub type DelegationRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    String,
    Option<i64>,
);
/// Row of the automations table: (id, name, prompt, command, workspace_id,
/// permission, idle_secs, on_approval, last_run_at).
pub type AutomationRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    String,
    i64,
    String,
    Option<String>,
);

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open(repo_root: &Path) -> Result<Self> {
        let dir = repo_root.join(".canvas");
        std::fs::create_dir_all(&dir)?;
        let conn = Connection::open(dir.join("board.db"))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS agents (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               command TEXT NOT NULL,
               worktree TEXT NOT NULL,
               status TEXT NOT NULL DEFAULT 'idle',
               created_at TEXT NOT NULL DEFAULT (datetime('now')),
               exited_at TEXT
             );
             CREATE TABLE IF NOT EXISTS delegations (
               id TEXT PRIMARY KEY,
               from_node TEXT NOT NULL,
               to_node TEXT NOT NULL,
               task TEXT NOT NULL,
               result TEXT,
               state TEXT NOT NULL DEFAULT 'delegated',
               created_at TEXT NOT NULL DEFAULT (datetime('now')),
               resolved_at TEXT
             );
             CREATE TABLE IF NOT EXISTS workspaces (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               repo TEXT NOT NULL,
               created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE TABLE IF NOT EXISTS layout (
               node_id TEXT PRIMARY KEY,
               x REAL NOT NULL,
               y REAL NOT NULL
             );",
        )?;
        // Migrations: v0 → v1 adds agents.workspace_id (agents live inside
        // user-created workspaces that coexist on one canvas).
        let version: u32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version < 1 {
            conn.execute_batch(
                "ALTER TABLE agents ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
                 PRAGMA user_version = 1;",
            )?;
        }
        // v1 → v2: per-agent permission level (Deska-style ladder; default
        // most restrictive so old rows never silently gain autonomy).
        if version < 2 {
            conn.execute_batch(
                "ALTER TABLE agents ADD COLUMN permission TEXT NOT NULL DEFAULT 'supervised';
                 PRAGMA user_version = 2;",
            )?;
        }
        // v2 → v3: how many files the child's worktree changed when the
        // delegation resolved — the edge's produced diff, persisted.
        if version < 3 {
            conn.execute_batch(
                "ALTER TABLE delegations ADD COLUMN files_changed INTEGER;
                 PRAGMA user_version = 3;",
            )?;
        }
        // v3 → v4: saved automations — a task the user runs on demand,
        // with guardrails (hang limit + approval policy) like Deska's.
        if version < 4 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS automations (
                   id TEXT PRIMARY KEY,
                   name TEXT NOT NULL,
                   prompt TEXT NOT NULL,
                   command TEXT NOT NULL,
                   workspace_id TEXT,
                   permission TEXT NOT NULL DEFAULT 'auto',
                   idle_secs INTEGER NOT NULL DEFAULT 300,
                   on_approval TEXT NOT NULL DEFAULT 'hold',
                   last_run_at TEXT,
                   created_at TEXT DEFAULT (datetime('now'))
                 );
                 PRAGMA user_version = 4;",
            )?;
        }
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn agent_spawned(
        &self,
        id: &str,
        name: &str,
        command: &str,
        worktree: &str,
        workspace_id: Option<&str>,
        permission: &str,
    ) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO agents (id, name, command, worktree, workspace_id, permission) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (id, name, command, worktree, workspace_id, permission),
        )?;
        Ok(())
    }

    pub fn workspace_created(&self, id: &str, name: &str, repo: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO workspaces (id, name, repo) VALUES (?1, ?2, ?3)",
            (id, name, repo),
        )?;
        Ok(())
    }

    /// Repo path for a workspace — agents spawn inside their workspace's repo.
    pub fn workspace_repo(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT repo FROM workspaces WHERE id = ?1")?;
        let mut rows = st.query_map([id], |r| r.get::<_, String>(0))?;
        Ok(rows.next().transpose()?)
    }

    pub fn workspaces_snapshot(&self) -> Result<Vec<(String, String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT id, name, repo FROM workspaces ORDER BY created_at")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Every PTY dies with the daemon — on boot, mark anything not already
    /// exited as exited so stale "waiting"/"working" never replay as live.
    pub fn mark_all_exited(&self) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE agents SET status = 'exited', exited_at = COALESCE(exited_at, datetime('now')) WHERE status != 'exited'",
            (),
        )?;
        Ok(())
    }

    /// An agent's permission level — used to clamp a delegation child's
    /// level to at most its parent's.
    pub fn agent_permission(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT permission FROM agents WHERE id = ?1")?;
        let mut rows = st.query_map([id], |r| r.get::<_, String>(0))?;
        Ok(rows.next().transpose()?)
    }

    pub fn agent_status(&self, id: &str, status: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE agents SET status = ?2, exited_at = CASE WHEN ?2 = 'exited' THEN datetime('now') ELSE exited_at END WHERE id = ?1",
            (id, status),
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn delegation_created(
        &self,
        id: &str,
        from: &str,
        to: &str,
        task: &str,
    ) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO delegations (id, from_node, to_node, task) VALUES (?1, ?2, ?3, ?4)",
            (id, from, to, task),
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn delegation_resolved(&self, id: &str, result: &str, files: u32) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE delegations SET result = ?2, files_changed = ?3, state = 'returned', resolved_at = datetime('now') WHERE id = ?1",
            (id, result, files),
        )?;
        Ok(())
    }

    pub fn save_node_position(&self, node_id: &str, x: f64, y: f64) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO layout (node_id, x, y) VALUES (?1, ?2, ?3)
             ON CONFLICT(node_id) DO UPDATE SET x = excluded.x, y = excluded.y",
            (node_id, x, y),
        )?;
        Ok(())
    }

    /// Agents seen by this board, newest last — replayed to new clients so
    /// the canvas shows pre-existing agents, not just ones spawned live.
    /// Tuple: (id, name, command, worktree, status, workspace_id, permission).
    pub fn agents_snapshot(
        &self,
    ) -> Result<Vec<AgentRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, name, command, worktree, status, workspace_id, permission FROM agents ORDER BY created_at",
        )?;
        let rows = st.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Delegation edges seen by this board — replayed on connect.
    pub fn delegations_snapshot(
        &self,
    ) -> Result<Vec<DelegationRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, from_node, to_node, task, result, state, files_changed FROM delegations ORDER BY created_at",
        )?;
        let rows = st.query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Tuple: (id, name, prompt, command, workspace_id, permission,
    /// idle_secs, on_approval, last_run_at).
    #[allow(clippy::type_complexity)]
    #[allow(clippy::too_many_arguments)]
    pub fn automation_created(
        &self,
        id: &str,
        name: &str,
        prompt: &str,
        command: &str,
        workspace_id: Option<&str>,
        permission: &str,
        idle_secs: u64,
        on_approval: &str,
    ) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO automations (id, name, prompt, command, workspace_id, permission, idle_secs, on_approval) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            (id, name, prompt, command, workspace_id, permission, idle_secs as i64, on_approval),
        )?;
        Ok(())
    }

    pub fn automation_row(&self, id: &str) -> Result<Option<AutomationRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, name, prompt, command, workspace_id, permission, idle_secs, on_approval, last_run_at FROM automations WHERE id = ?1",
        )?;
        let mut rows = st.query_map([id], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get::<_, i64>(6)?,
                r.get(7)?,
                r.get(8)?,
            ))
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn automations_snapshot(&self) -> Result<Vec<AutomationRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, name, prompt, command, workspace_id, permission, idle_secs, on_approval, last_run_at FROM automations ORDER BY created_at",
        )?;
        let rows = st.query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get::<_, i64>(6)?,
                r.get(7)?,
                r.get(8)?,
            ))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn automation_ran(&self, id: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE automations SET last_run_at = datetime('now') WHERE id = ?1",
            (id,),
        )?;
        Ok(())
    }

    pub fn automation_deleted(&self, id: &str) -> Result<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM automations WHERE id = ?1", (id,))?;
        Ok(())
    }

    pub fn layout_map(&self) -> Result<std::collections::HashMap<String, (f64, f64)>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT node_id, x, y FROM layout")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?))))?;
        Ok(rows.collect::<rusqlite::Result<std::collections::HashMap<_, _>>>()?)
    }
}
