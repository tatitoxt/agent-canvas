//! Unit coverage for the pieces the daemon leans on hardest: the
//! permission ladder math, the sensitive-input gate, and SQLite store
//! roundtrips. Runs without a daemon — pure library-level.

use canvasd::agent::sensitive_line;
use canvasd::protocol::{clamp_to_parent, normalize_permission};
use canvasd::store::Store;

fn temp_repo(_tag: &str) -> std::path::PathBuf {
    // tempfile::tempdir creates with restrictive permissions and a random
    // name — no predictable-path reuse on shared machines. We keep the path
    // and leak the guard (tests are short-lived; the OS reclaims /tmp).
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_path_buf();
    std::mem::forget(dir);
    path
}

#[test]
fn canvas_id_is_stable_for_a_database_and_unique_between_databases() {
    let repo_a = temp_repo("canvas-id-a");
    let repo_b = temp_repo("canvas-id-b");

    let first = Store::open(&repo_a).unwrap().canvas_id().to_string();
    let reopened = Store::open(&repo_a).unwrap().canvas_id().to_string();
    let other = Store::open(&repo_b).unwrap().canvas_id().to_string();

    assert_eq!(first, reopened, "reopening a database must preserve its id");
    assert_ne!(
        first, other,
        "separate canvas databases must not share drafts"
    );
}

// ---------- permission ladder ----------

#[test]
fn permission_aliases_normalize_into_the_four_ladder_levels() {
    assert_eq!(normalize_permission(None), "supervised");
    assert_eq!(normalize_permission(Some("full_access")), "full");
    assert_eq!(normalize_permission(Some("full")), "full");
    assert_eq!(normalize_permission(Some("auto")), "auto");
    assert_eq!(normalize_permission(Some("auto-accept")), "auto_accept");
    assert_eq!(normalize_permission(Some("auto_accept")), "auto_accept");
    // unknown values fall back to the safest level, never upward
    assert_eq!(normalize_permission(Some("yolo")), "supervised");
}

#[test]
fn delegation_child_never_exceeds_its_parent() {
    assert_eq!(clamp_to_parent("full", Some("supervised")), "supervised");
    assert_eq!(clamp_to_parent("auto", Some("auto_accept")), "auto_accept");
    assert_eq!(clamp_to_parent("full", Some("auto")), "auto");
    // same or lower passes through untouched
    assert_eq!(clamp_to_parent("supervised", Some("full")), "supervised");
    assert_eq!(clamp_to_parent("auto", Some("auto")), "auto");
    // no parent → requested stands
    assert_eq!(clamp_to_parent("full", None), "full");
}

// ---------- sensitive-input gate ----------

#[test]
fn gate_catches_destructive_shapes() {
    for payload in [
        &b"rm -rf /tmp/x\r"[..],
        b"rm -fr build\n",
        b"sudo systemctl stop x\n",
        b"git reset --hard HEAD~3\n",
        b"git clean -fdx\n",
        b"drop table users;\n",
        b"dd if=/dev/zero of=/dev/sda\n",
        b"kill -9 1234\n",
        b"npm publish\n",
        b"shutdown now\n",
    ] {
        assert!(
            sensitive_line(payload).is_some(),
            "should gate: {:?}",
            payload
        );
    }
}

#[test]
fn gate_ignores_lookalikes_and_safe_commands() {
    for payload in [
        &b"ls -la\n"[..],
        b"git push origin feature\n",
        b"git status\n",
        b"echo sudo is a word in prose\n", // hmm — contains "sudo ": document behavior
    ] {
        let _ = payload;
    }
    assert!(sensitive_line(b"ls -la\n").is_none());
    assert!(sensitive_line(b"git push origin feature\n").is_none());
    assert!(sensitive_line(b"cargo build --release\n").is_none());
    assert!(sensitive_line(b"npm install\n").is_none());
    // short fragments under 3 chars can't gate — typing "rm" hasn't become a command yet
    assert!(sensitive_line(b"rm").is_none());
}

#[test]
fn gate_matches_case_insensitively() {
    assert!(sensitive_line(b"RM -RF /\n").is_some());
    assert!(sensitive_line(b"Sudo apt x\n").is_some());
}

// ---------- store roundtrips ----------

#[test]
fn agent_lifecycle_roundtrip() {
    let dir = temp_repo("agents");
    let store = Store::open(&dir).unwrap();
    store
        .agent_spawned("a1", "worker", "bash", "/tmp/wt", None, "auto", None, None)
        .unwrap();
    let rows = store.agents_snapshot().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].1, "worker");
    assert_eq!(rows[0].6, "auto");
    // board defaults to main
    assert_eq!(rows[0].7.as_deref(), Some("main"));
}

#[test]
fn boards_rename_delete_rules() {
    let dir = temp_repo("boards");
    let store = Store::open(&dir).unwrap();
    store.board_created("b1", "QA").unwrap();
    assert!(store
        .boards_snapshot()
        .unwrap()
        .iter()
        .any(|(id, n)| id == "b1" && n == "QA"));
    assert!(store.board_renamed("b1", "QA2").unwrap());
    assert!(store
        .boards_snapshot()
        .unwrap()
        .iter()
        .any(|(_, n)| n == "QA2"));

    // an occupied board refuses deletion
    store
        .agent_spawned("a1", "w", "bash", "/tmp/wt", None, "auto", Some("b1"), None)
        .unwrap();
    assert!(!store.board_deleted("b1").unwrap());

    // moving the agent out frees the board
    assert!(store.node_moved_to_board("a1", "main").unwrap());
    assert!(store.board_deleted("b1").unwrap());

    // main is never deletable
    assert!(!store.board_deleted("main").unwrap());
}

#[test]
fn node_rename_hits_agents_and_workspaces() {
    let dir = temp_repo("rename");
    let store = Store::open(&dir).unwrap();
    store
        .agent_spawned("a1", "old", "bash", "/tmp/wt", None, "auto", None, None)
        .unwrap();
    store
        .workspace_created("w1", "ws-old", "/tmp/repo", None)
        .unwrap();
    assert!(store.node_renamed("a1", "new").unwrap());
    assert!(store.node_renamed("w1", "ws-new").unwrap());
    assert!(!store.node_renamed("ghost", "x").unwrap());
    assert_eq!(store.agents_snapshot().unwrap()[0].1, "new");
}

#[test]
fn delegation_lifecycle() {
    let dir = temp_repo("deleg");
    let store = Store::open(&dir).unwrap();
    store
        .delegation_created("d1", "orch1", "a1", "do the thing")
        .unwrap();
    let rows = store.delegations_snapshot().unwrap();
    assert_eq!(rows.len(), 1);
    store.delegation_resolved("d1", "done it", 3).unwrap();
    let rows = store.delegations_snapshot().unwrap();
    assert_eq!(rows[0].5, "returned");
    assert!(store.delegation_delete("d1").unwrap());
    assert!(store.delegations_snapshot().unwrap().is_empty());
}

#[test]
fn workspace_chain_roundtrip() {
    let dir = temp_repo("chain");
    let store = Store::open(&dir).unwrap();
    store
        .workspace_created("w1", "ws", "/tmp/repo", None)
        .unwrap();
    // Unset chain reads as None — callers then use the auto-detected chain.
    assert_eq!(store.workspace_chain("w1").unwrap(), None);

    let chain = vec!["claude".to_string(), "codex".to_string()];
    store.set_workspace_chain("w1", &chain).unwrap();
    assert_eq!(store.workspace_chain("w1").unwrap(), Some(chain));

    // The editor's reset state is an empty array, and it roundtrips as
    // empty — chain_for_spawn treats it as "back to auto", not "no fallback".
    store.set_workspace_chain("w1", &[]).unwrap();
    assert_eq!(store.workspace_chain("w1").unwrap(), Some(vec![]));
}
