//! Full board-state dump — the `/api/export` JSON. Shared by the daemon's
//! HTTP endpoint and the Tauri shell so both runtimes answer the identical
//! shape: the portable answer to "do my canvases persist" (restore happens
//! by moving `.canvas/board.db` between machines).

use crate::store::Store;

/// Snapshot every board-scoped table as JSON. Per-table failures degrade
/// to empty collections rather than failing the whole dump — a partial
/// export still restores most of a board.
pub fn state_json(store: &Store) -> serde_json::Value {
    serde_json::json!({
        "version": 1,
        "exported_at": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        "boards": store.boards_snapshot().unwrap_or_default(),
        "layout": store.layout_map().unwrap_or_default(),
        "agents": store.agents_snapshot().unwrap_or_default(),
        "workspaces": store.workspaces_snapshot().unwrap_or_default(),
        "delegations": store.delegations_snapshot().unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_shape_is_stable_and_versioned() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::open(tmp.path()).unwrap();
        store.board_created("b-1", "alpha").unwrap();
        let dump = state_json(&store);
        assert_eq!(dump["version"], 1);
        assert!(dump["exported_at"].as_u64().unwrap() > 0);
        // The default 'main' board plus the one we created.
        let boards = dump["boards"].as_array().unwrap();
        assert_eq!(boards.len(), 2);
        assert!(boards.iter().any(|b| b[0] == "b-1" && b[1] == "alpha"));
        for key in ["layout", "agents", "workspaces", "delegations"] {
            assert!(dump.get(key).is_some(), "missing export key {key}");
        }
    }
}
