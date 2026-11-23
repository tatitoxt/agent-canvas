//! Local-first persistence: one SQLite file per board under
//! `<repo>/.canvas/board.db`. Boards also export to JSON for diffing/git.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

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
             CREATE TABLE IF NOT EXISTS layout (
               node_id TEXT PRIMARY KEY,
               x REAL NOT NULL,
               y REAL NOT NULL
             );",
        )?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn agent_spawned(&self, id: &str, name: &str, command: &str, worktree: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO agents (id, name, command, worktree) VALUES (?1, ?2, ?3, ?4)",
            (id, name, command, worktree),
        )?;
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

    #[allow(dead_code)]
    pub fn delegation_resolved(&self, id: &str, result: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE delegations SET result = ?2, state = 'returned', resolved_at = datetime('now') WHERE id = ?1",
            (id, result),
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn save_node_position(&self, node_id: &str, x: f64, y: f64) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO layout (node_id, x, y) VALUES (?1, ?2, ?3)
             ON CONFLICT(node_id) DO UPDATE SET x = excluded.x, y = excluded.y",
            (node_id, x, y),
        )?;
        Ok(())
    }
}
