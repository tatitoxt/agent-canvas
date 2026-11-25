//! Local-first persistence: one SQLite file per board under
//! `<repo>/.canvas/board.db`. Boards also export to JSON for diffing/git.

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension};
use std::path::Path;
use std::sync::Mutex;

/// Row of the agents table: (id, name, command, worktree, status,
/// workspace_id, permission).
/// (id, name, command, worktree, status, workspace_id, permission, board_id)
pub type AgentRow = (String, String, String, String, String, Option<String>, String, Option<String>, Option<String>);
/// Row of the delegations table: (id, from, to, task, result, state,
/// files_changed, created_at, resolved_at).
pub type DelegationRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    String,
    Option<i64>,
    Option<String>,
    Option<String>,
);
/// Row of the automations table: (id, name, prompt, command, workspace_id,
/// permission, idle_secs, on_approval, last_run_at, interval_secs, next_run_at).
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
    Option<i64>,
    Option<String>,
);

/// Row of the loops table: (id, board_id, target, instruction,
/// trigger_kind, interval_secs, pattern, enabled, last_fired_at).
pub type LoopRow = (
    String,
    String,
    String,
    String,
    String,
    Option<i64>,
    Option<String>,
    bool,
    Option<String>,
);
/// Row of the workspaces table: (id, name, repo, board_id).
pub type WorkspaceRow = (String, String, String, Option<String>);
/// Row of the artifacts table: (id, board_id, agent_id, kind, title, path,
/// text, created_at).
pub type ArtifactRow = (
    String,
    String,
    Option<String>,
    String,
    String,
    Option<String>,
    Option<String>,
    String,
);
/// Row of the notes table: (id, board_id, col, text, pos, due).
pub type NoteRow = (String, String, String, String, i64, Option<String>);

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
        // v4 → v5: named boards — separate canvases each with their own
        // agents/workspaces/edges (Deska "Spaces"). Every existing node
        // backfills to 'main'.
        if version < 5 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS boards (
                   id TEXT PRIMARY KEY,
                   name TEXT NOT NULL,
                   created_at TEXT DEFAULT (datetime('now'))
                 );
                 INSERT OR IGNORE INTO boards (id, name) VALUES ('main', 'Main');
                 ALTER TABLE agents ADD COLUMN board_id TEXT;
                 ALTER TABLE workspaces ADD COLUMN board_id TEXT;
                 UPDATE agents SET board_id = 'main' WHERE board_id IS NULL;
                 UPDATE workspaces SET board_id = 'main' WHERE board_id IS NULL;
                 PRAGMA user_version = 5;",
            )?;
        }
        if version < 6 {
            conn.execute_batch(
                // v5 → v6: automation schedules — repeat every interval_secs.
                "ALTER TABLE automations ADD COLUMN interval_secs INTEGER;
                 ALTER TABLE automations ADD COLUMN next_run_at TEXT;
                 PRAGMA user_version = 6;",
            )?;
        }
        if version < 7 {
            conn.execute_batch(
                // v6 → v7: named CLI accounts — one canvas user, several
                // sign-ins of the same CLI side by side; each gets its own
                // config dir so codex/claude/gemini auth never collides.
                "CREATE TABLE IF NOT EXISTS accounts (
                   id TEXT PRIMARY KEY,
                   cli TEXT NOT NULL,
                   label TEXT NOT NULL,
                   config_dir TEXT NOT NULL,
                   created_at TEXT NOT NULL DEFAULT (datetime('now'))
                 );
                 ALTER TABLE agents ADD COLUMN account_id TEXT;
                 PRAGMA user_version = 7;",
            )?;
        }
        // v7 → v8: kanban notes — a card lives on a board in a column
        // (todo/doing/done), like Symvibe's tasks panel.
        if version < 8 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS notes (
                   id TEXT PRIMARY KEY,
                   board_id TEXT NOT NULL DEFAULT 'main',
                   col TEXT NOT NULL DEFAULT 'todo',
                   text TEXT NOT NULL,
                   pos INTEGER NOT NULL DEFAULT 0,
                   created_at TEXT DEFAULT (datetime('now'))
                 );
                 PRAGMA user_version = 8;",
            )?;
        }
        // v8 → v9: artifacts — deliverables an agent produces (a report,
        // a plan, a diff summary) each with a kind the UI symbols+colors.
        if version < 9 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS artifacts (
                   id TEXT PRIMARY KEY,
                   board_id TEXT NOT NULL DEFAULT 'main',
                   agent_id TEXT,
                   kind TEXT NOT NULL DEFAULT 'note',
                   title TEXT NOT NULL,
                   path TEXT,
                   text TEXT,
                   created_at TEXT DEFAULT (datetime('now'))
                 );
                 PRAGMA user_version = 9;",
            )?;
        }
        // v9 → v10: optional due date on notes — the calendar dimension
        // of the kanban.
        if version < 10 {
            conn.execute_batch("ALTER TABLE notes ADD COLUMN due TEXT;
                 PRAGMA user_version = 10;")?;
        }
        // v10 → v11: loops — a saved instruction the daemon re-sends to a
        // live console on a trigger (interval / agent-went-idle / output
        // match), Symvibe's "put your agents on autopilot".
        if version < 11 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS loops (
                   id TEXT PRIMARY KEY,
                   board_id TEXT NOT NULL DEFAULT 'main',
                   target TEXT NOT NULL,
                   instruction TEXT NOT NULL,
                   trigger_kind TEXT NOT NULL DEFAULT 'interval',
                   interval_secs INTEGER,
                   pattern TEXT,
                   enabled INTEGER NOT NULL DEFAULT 1,
                   last_fired_at TEXT,
                   created_at TEXT DEFAULT (datetime('now'))
                 );
                 PRAGMA user_version = 11;",
            )?;
        }
        Ok(Self { conn: Mutex::new(conn) })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn agent_spawned(
        &self,
        id: &str,
        name: &str,
        command: &str,
        worktree: &str,
        workspace_id: Option<&str>,
        permission: &str,
        board_id: Option<&str>,
        account_id: Option<&str>,
    ) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO agents (id, name, command, worktree, workspace_id, permission, board_id, account_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, 'main'), ?8)",
            (id, name, command, worktree, workspace_id, permission, board_id, account_id),
        )?;
        Ok(())
    }

    pub fn workspace_created(&self, id: &str, name: &str, repo: &str, board_id: Option<&str>) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO workspaces (id, name, repo, board_id) VALUES (?1, ?2, ?3, COALESCE(?4, 'main'))",
            (id, name, repo, board_id),
        )?;
        Ok(())
    }

    pub fn board_created(&self, id: &str, name: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO boards (id, name) VALUES (?1, ?2)",
            (id, name),
        )?;
        Ok(())
    }

    pub fn boards_snapshot(&self) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT id, name FROM boards ORDER BY created_at")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Move a node (agent or workspace) to another board. Returns whether
    /// any row was updated.
    pub fn node_moved_to_board(&self, node_id: &str, board_id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE agents SET board_id = ?2 WHERE id = ?1",
            (node_id, board_id),
        )? + conn.execute(
            "UPDATE workspaces SET board_id = ?2 WHERE id = ?1",
            (node_id, board_id),
        )?;
        Ok(n > 0)
    }

    /// Rename an agent or workspace node.
    pub fn node_renamed(&self, node_id: &str, name: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE agents SET name = ?2 WHERE id = ?1",
            (node_id, name),
        )? + conn.execute(
            "UPDATE workspaces SET name = ?2 WHERE id = ?1",
            (node_id, name),
        )?;
        Ok(n > 0)
    }

    pub fn board_renamed(&self, board_id: &str, name: &str) -> Result<bool> {
        let n = self.conn.lock().unwrap().execute(
            "UPDATE boards SET name = ?2 WHERE id = ?1",
            (board_id, name),
        )?;
        Ok(n > 0)
    }

    /// A board can only be deleted when it holds no nodes — same rule as
    /// Deska Spaces so work is never silently discarded.
    pub fn board_deleted(&self, board_id: &str) -> Result<bool> {
        if board_id == "main" {
            return Ok(false);
        }
        let conn = self.conn.lock().unwrap();
        let used: i64 = conn.query_row(
            "SELECT (SELECT COUNT(*) FROM agents WHERE board_id = ?1) +
                    (SELECT COUNT(*) FROM workspaces WHERE board_id = ?1)",
            (board_id,),
            |r| r.get(0),
        )?;
        if used > 0 {
            return Ok(false);
        }
        let n = conn.execute("DELETE FROM boards WHERE id = ?1", (board_id,))?;
        Ok(n > 0)
    }

    /// A workspace can only be deleted when no live agent belongs to it —
    /// dead agents keep their records but the container can go.
    pub fn workspace_deleted(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let live: i64 = conn.query_row(
            "SELECT COUNT(*) FROM agents WHERE workspace_id = ?1 AND status != 'exited'",
            (id,),
            |r| r.get(0),
        )?;
        if live > 0 {
            return Ok(false);
        }
        // Detach dead agents so they stay on the canvas as loose nodes.
        conn.execute(
            "UPDATE agents SET workspace_id = NULL WHERE workspace_id = ?1",
            (id,),
        )?;
        let n = conn.execute("DELETE FROM workspaces WHERE id = ?1", (id,))?;
        Ok(n > 0)
    }

    /// Worktree path of any agent row (live or dead) — DiffDetail falls
    /// back here for agents whose PTY already exited.
    pub fn agent_worktree(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT worktree FROM agents WHERE id = ?1")?;
        let mut rows = st.query_map([id], |r| r.get::<_, String>(0))?;
        Ok(rows.next().transpose()?)
    }

    /// Absolute path of the agent's persisted worktree. Rows store it
    /// relative to the repo the agent spawned in: its workspace's repo,
    /// else `fallback_root` (the daemon's own).
    pub fn agent_worktree_abs(
        &self,
        id: &str,
        fallback_root: &std::path::Path,
    ) -> Result<Option<std::path::PathBuf>> {
        Ok(self.agent_worktree(id)?.map(|p| {
            let p = std::path::PathBuf::from(p);
            if p.is_absolute() {
                p
            } else {
                self.agent_repo(id)
                    .ok()
                    .flatten()
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|| fallback_root.to_path_buf())
                    .join(p)
            }
        }))
    }

    /// Repo the agent's worktree lives in — its workspace's repo; None when
    /// it spawned straight on the daemon's own repo root.
    pub fn agent_repo(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT w.repo FROM agents a JOIN workspaces w ON a.workspace_id = w.id WHERE a.id = ?1",
        )?;
        let mut rows = st.query_map([id], |r| r.get::<_, String>(0))?;
        Ok(rows.next().transpose()?)
    }

    /// Board an agent lives on — a delegation child inherits its parent's.
    pub fn agent_board(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT board_id FROM agents WHERE id = ?1")?;
        let mut rows = st.query_map([id], |r| r.get::<_, Option<String>>(0))?;
        Ok(rows.next().transpose()?.flatten())
    }

    /// Board a workspace node lives on — spawned agents inherit it.
    pub fn workspace_board(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT board_id FROM workspaces WHERE id = ?1")?;
        let mut rows = st.query_map([id], |r| r.get::<_, Option<String>>(0))?;
        Ok(rows.next().transpose()?.flatten())
    }

    /// Repo path for a workspace — agents spawn inside their workspace's repo.
    pub fn workspace_repo(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT repo FROM workspaces WHERE id = ?1")?;
        let mut rows = st.query_map([id], |r| r.get::<_, String>(0))?;
        Ok(rows.next().transpose()?)
    }

    /// Tuple: (id, name, repo, board_id).
    pub fn workspaces_snapshot(&self) -> Result<Vec<WorkspaceRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT id, name, repo, board_id FROM workspaces ORDER BY created_at")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
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

    pub fn set_agent_permission(&self, id: &str, level: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE agents SET permission = ?2 WHERE id = ?1",
            (id, level),
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

    /// Forget an agent entirely — removes its row so it stops showing up
    /// in snapshots. Used by "clear done"; kill() only marks it exited.
    pub fn remove_agent(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM agents WHERE id = ?1", (id,))?;
        conn.execute("DELETE FROM layout WHERE node_id = ?1", (id,))?;
        Ok(())
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

    /// Child exited without returning a result — close the ticket as
    /// failed so it doesn't hang as "in flight" forever. `files` keeps the
    /// child's remaining worktree edits visible on the ticket.
    pub fn delegation_failed(&self, id: &str, files: u32) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE delegations SET state = 'failed', files_changed = ?2, resolved_at = datetime('now') WHERE id = ?1",
            (id, files),
        )?;
        Ok(())
    }

    pub fn delegation_resolved(&self, id: &str, result: &str, files: u32) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE delegations SET result = ?2, files_changed = ?3, state = 'returned', resolved_at = datetime('now') WHERE id = ?1",
            (id, result, files),
        )?;
        Ok(())
    }

    pub fn delegation_delete(&self, id: &str) -> Result<bool> {
        let n = self
            .conn
            .lock()
            .unwrap()
            .execute("DELETE FROM delegations WHERE id = ?1", (id,))?;
        Ok(n > 0)
    }

    pub fn account_created(&self, id: &str, cli: &str, label: &str, config_dir: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO accounts (id, cli, label, config_dir) VALUES (?1, ?2, ?3, ?4)",
            (id, cli, label, config_dir),
        )?;
        Ok(())
    }

    pub fn account_deleted(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE agents SET account_id = NULL WHERE account_id = ?1", (id,))?;
        conn.execute("DELETE FROM accounts WHERE id = ?1", (id,))?;
        Ok(())
    }

    /// (id, cli, label) for the snapshot replay.
    /// (id, board_id, agent_id, kind, title, path, text, created_at) —
    /// every artifact, newest first.
    pub fn artifacts_snapshot(&self) -> Result<Vec<ArtifactRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, board_id, agent_id, kind, title, path, text, created_at FROM artifacts ORDER BY created_at DESC, id",
        )?;
        let rows = st
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn artifact_created(
        &self,
        id: &str,
        board_id: &str,
        agent_id: Option<&str>,
        kind: &str,
        title: &str,
        path: Option<&str>,
        text: Option<&str>,
    ) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO artifacts (id, board_id, agent_id, kind, title, path, text) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, board_id, agent_id, kind, title, path, text],
        )?;
        Ok(())
    }

    /// An agent's display name, for artifact attribution.
    pub fn agent_name(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        Ok(conn
            .query_row("SELECT name FROM agents WHERE id = ?1", [id], |r| r.get(0))
            .optional()?)
    }

    pub fn artifact_deleted(&self, id: &str) -> Result<()> {
        self.conn.lock().unwrap().execute("DELETE FROM artifacts WHERE id = ?1", [id])?;
        Ok(())
    }

    /// (id, board_id, col, text, pos, due) — the kanban cards of one board.
    pub fn notes_snapshot(&self, board_id: &str) -> Result<Vec<NoteRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, board_id, col, text, pos, due FROM notes WHERE board_id = ?1 ORDER BY col, pos",
        )?;
        let rows = st
            .query_map([board_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// All notes across boards — the full snapshot embeds them so a
    /// board switch needs no round-trip.
    pub fn all_notes(&self) -> Result<Vec<NoteRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, board_id, col, text, pos, due FROM notes ORDER BY board_id, col, pos",
        )?;
        let rows = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn note_upsert(&self, id: &str, board_id: &str, col: &str, text: &str, pos: i64, due: Option<&str>) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO notes (id, board_id, col, text, pos, due) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET board_id=excluded.board_id, col=excluded.col, text=excluded.text, pos=excluded.pos, due=excluded.due",
            rusqlite::params![id, board_id, col, text, pos, due],
        )?;
        Ok(())
    }

    pub fn note_deleted(&self, id: &str) -> Result<()> {
        self.conn.lock().unwrap().execute("DELETE FROM notes WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Next position value inside a column — appended cards land last.
    pub fn note_next_pos(&self, board_id: &str, col: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let pos: i64 = conn.query_row(
            "SELECT COALESCE(MAX(pos) + 1, 0) FROM notes WHERE board_id = ?1 AND col = ?2",
            rusqlite::params![board_id, col],
            |r| r.get(0),
        )?;
        Ok(pos)
    }

    pub fn accounts_snapshot(&self) -> Result<Vec<(String, String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT id, cli, label FROM accounts ORDER BY created_at")?;
        let rows = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// (cli, label, config_dir) for a spawn that uses this account.
    pub fn account_record(&self, id: &str) -> Result<Option<(String, String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT cli, label, config_dir FROM accounts WHERE id = ?1")?;
        Ok(st
            .query_row((id,), |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()?)
    }

    /// Label of an agent's account, for the node card.
    pub fn agent_account_label(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT a.label FROM accounts a JOIN agents g ON g.account_id = a.id WHERE g.id = ?1",
        )?;
        Ok(st.query_row((id,), |r| r.get(0)).optional()?)
    }

    /// Delegation edges still waiting on a CANVAS_RESULT — used by the
    /// startup sweep to resolve results that landed before a restart.
    pub fn unresolved_delegations(&self) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut q = conn
            .prepare("SELECT id, to_node FROM delegations WHERE state = 'delegated'")?;
        let rows = q
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
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
            "SELECT id, name, command, worktree, status, workspace_id, permission, board_id, account_id FROM agents ORDER BY created_at",
        )?;
        let rows = st.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Delegation edges seen by this board — replayed on connect.
    pub fn delegations_snapshot(
        &self,
    ) -> Result<Vec<DelegationRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, from_node, to_node, task, result, state, files_changed, created_at, resolved_at FROM delegations ORDER BY created_at",
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
                r.get(7)?,
                r.get(8)?,
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
        interval_secs: Option<u64>,
    ) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO automations (id, name, prompt, command, workspace_id, permission, idle_secs, on_approval, interval_secs, next_run_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CASE WHEN ?9 IS NULL THEN NULL ELSE datetime('now', '+' || ?9 || ' seconds') END)",
            (id, name, prompt, command, workspace_id, permission, idle_secs as i64, on_approval, interval_secs.map(|v| v as i64)),
        )?;
        Ok(())
    }

    pub fn automation_row(&self, id: &str) -> Result<Option<AutomationRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, name, prompt, command, workspace_id, permission, idle_secs, on_approval, last_run_at, interval_secs, next_run_at FROM automations WHERE id = ?1",
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
                r.get(9)?,
                r.get(10)?,
            ))
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn automations_snapshot(&self) -> Result<Vec<AutomationRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, name, prompt, command, workspace_id, permission, idle_secs, on_approval, last_run_at, interval_secs, next_run_at FROM automations ORDER BY created_at",
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
                r.get(9)?,
                r.get(10)?,
            ))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Record a run: stamp last_run_at and advance the schedule so a
    /// repeating automation fires again interval_secs from now.
    pub fn automation_ran(&self, id: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE automations SET last_run_at = datetime('now'),
                next_run_at = CASE WHEN interval_secs IS NULL THEN NULL
                    ELSE datetime('now', '+' || interval_secs || ' seconds') END
             WHERE id = ?1",
            (id,),
        )?;
        Ok(())
    }

    /// Scheduled automations whose next_run_at is due now.
    pub fn automations_due(&self) -> Result<Vec<AutomationRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, name, prompt, command, workspace_id, permission, idle_secs, on_approval, last_run_at, interval_secs, next_run_at FROM automations WHERE next_run_at IS NOT NULL AND next_run_at <= datetime('now')",
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
                r.get(9)?,
                r.get(10)?,
            ))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Create a loop: `target` is an agent id or "*" (every live agent on
    /// the board). `trigger`: 'interval' (needs interval_secs), 'idle'
    /// (fires when the agent finishes/goes idle) or 'match' (fires when
    /// the PTY tail starts containing `pattern`, edge-detected).
    #[allow(clippy::too_many_arguments)]
    pub fn loop_insert(
        &self,
        id: &str,
        board_id: &str,
        target: &str,
        instruction: &str,
        trigger: &str,
        interval_secs: Option<u64>,
        pattern: Option<&str>,
    ) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO loops (id, board_id, target, instruction, trigger_kind, interval_secs, pattern) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (id, board_id, target, instruction, trigger, interval_secs.map(|v| v as i64), pattern),
        )?;
        Ok(())
    }

    pub fn loops_snapshot(&self) -> Result<Vec<LoopRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, board_id, target, instruction, trigger_kind, interval_secs, pattern, enabled, last_fired_at FROM loops ORDER BY created_at",
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
                r.get::<_, i64>(7)? != 0,
                r.get(8)?,
            ))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Enabled loops on a board (scheduler read each tick).
    pub fn loops_enabled(&self) -> Result<Vec<LoopRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, board_id, target, instruction, trigger_kind, interval_secs, pattern, enabled, last_fired_at FROM loops WHERE enabled = 1",
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
                r.get::<_, i64>(7)? != 0,
                r.get(8)?,
            ))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn loop_set_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE loops SET enabled = ?2 WHERE id = ?1",
            (id, if enabled { 1 } else { 0 }),
        )?;
        Ok(())
    }

    pub fn loop_fired(&self, id: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE loops SET last_fired_at = datetime('now') WHERE id = ?1",
            (id,),
        )?;
        Ok(())
    }

    /// Interval loops whose period elapsed since last_fired_at (or never
    /// fired — those are due immediately).
    pub fn loops_interval_due(&self) -> Result<Vec<LoopRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, board_id, target, instruction, trigger_kind, interval_secs, pattern, enabled, last_fired_at FROM loops
             WHERE enabled = 1 AND trigger_kind = 'interval'
               AND (last_fired_at IS NULL OR datetime(last_fired_at, '+' || interval_secs || ' seconds') <= datetime('now'))",
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
                r.get::<_, i64>(7)? != 0,
                r.get(8)?,
            ))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn loop_deleted(&self, id: &str) -> Result<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM loops WHERE id = ?1", (id,))?;
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
