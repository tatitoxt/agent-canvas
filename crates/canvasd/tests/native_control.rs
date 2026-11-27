//! Native-control-plane roundtrip: serve the transport-independent control
//! router and drive it with the real `canvasctl` binary. This is the same
//! router the Tauri shell mounts; the test intentionally uses no Tauri runtime.

use canvasd::agent::AgentManager;
use canvasd::control;
use canvasd::orchestrate::{tokio_task_spawner, Orchestrator};
use canvasd::store::Store;
use std::process::Output;
use std::sync::Arc;
use std::time::{Duration, Instant};

fn init_repo(path: &std::path::Path) {
    std::process::Command::new("git")
        .args(["init", "-q"])
        .current_dir(path)
        .output()
        .unwrap();
    std::fs::write(path.join("seed.txt"), "seed").unwrap();
    std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(path)
        .output()
        .unwrap();
    std::process::Command::new("git")
        .args(["commit", "-qm", "seed"])
        .current_dir(path)
        .env("GIT_AUTHOR_NAME", "control-test")
        .env("GIT_AUTHOR_EMAIL", "control@test")
        .env("GIT_COMMITTER_NAME", "control-test")
        .env("GIT_COMMITTER_EMAIL", "control@test")
        .output()
        .unwrap();
}

struct ControlServer {
    port: u16,
    token: String,
    orchestrator: Orchestrator,
    serve: tokio::task::JoinHandle<()>,
    _repo: tempfile::TempDir,
}

impl ControlServer {
    async fn start() -> Self {
        let repo = tempfile::tempdir().unwrap();
        init_repo(repo.path());
        let store = Arc::new(Store::open(repo.path()).unwrap());
        let agents = Arc::new(AgentManager::new());
        agents.set_transcript_dir(repo.path().join(".canvas").join("transcripts"));
        let orchestrator = Orchestrator::new(
            store,
            agents,
            repo.path().to_path_buf(),
            tokio_task_spawner(),
        );
        let token = control::generate_token();
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0u16))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let router = control::router(orchestrator.clone(), token.clone());
        let serve = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self {
            port,
            token,
            orchestrator,
            serve,
            _repo: repo,
        }
    }

    async fn ctl(&self, args: &[&str], agent_id: Option<&str>) -> Output {
        let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_canvasctl"));
        cmd.args(args)
            .env("CANVAS_PORT", self.port.to_string())
            .env("CANVAS_TOKEN", &self.token);
        if let Some(id) = agent_id {
            cmd.env("CANVAS_AGENT_ID", id);
        }
        cmd.output().await.unwrap()
    }
}

impl Drop for ControlServer {
    fn drop(&mut self) {
        self.serve.abort();
    }
}

#[tokio::test]
async fn canvasctl_roundtrips_snapshot_artifact_spawn_delegate_and_result() {
    let server = ControlServer::start().await;

    // Snapshot-only commands connect, authenticate, and read the first frame.
    let boards = server.ctl(&["boards"], None).await;
    assert!(
        boards.status.success(),
        "boards failed: {}",
        String::from_utf8_lossy(&boards.stderr)
    );
    assert!(
        String::from_utf8_lossy(&boards.stdout).contains("main"),
        "expected main board in {}",
        String::from_utf8_lossy(&boards.stdout)
    );

    // Artifact reporting is a direct canvasctl → control-socket roundtrip.
    let artifact = server
        .ctl(
            &[
                "artifact",
                "--kind",
                "report",
                "--title",
                "control smoke",
                "--text",
                "artifact body",
            ],
            None,
        )
        .await;
    assert!(
        artifact.status.success(),
        "artifact failed: {}",
        String::from_utf8_lossy(&artifact.stderr)
    );
    let artifact_stdout = String::from_utf8_lossy(&artifact.stdout);
    assert!(
        artifact_stdout.starts_with("artifact art-"),
        "{artifact_stdout}"
    );
    assert_eq!(
        server
            .orchestrator
            .store
            .artifacts_snapshot()
            .unwrap()
            .len(),
        1
    );

    // Spawn a real PTY through canvasctl. Permission `auto` keeps the smoke
    // test non-interactive while exercising the same wire path agents use.
    let shell = if cfg!(windows) { "cmd" } else { "bash" };
    let spawned = server
        .ctl(
            &[
                "spawn",
                "--name",
                "parent",
                "--cmd",
                shell,
                "--cwd",
                ".",
                "--permission",
                "auto",
            ],
            None,
        )
        .await;
    assert!(
        spawned.status.success(),
        "spawn failed: {}",
        String::from_utf8_lossy(&spawned.stderr)
    );
    let spawned_stdout = String::from_utf8_lossy(&spawned.stdout);
    let parent = spawned_stdout
        .trim()
        .strip_prefix("spawned ")
        .unwrap_or_else(|| panic!("unexpected spawn output: {spawned_stdout}"))
        .to_string();
    assert!(server
        .orchestrator
        .store
        .agents_snapshot()
        .unwrap()
        .iter()
        .any(|a| a.0 == parent));

    // Delegate from inside that parent identity. The delegation edge and the
    // child spawn both traverse the control protocol.
    let delegated = server
        .ctl(
            &[
                "delegate",
                "--name",
                "child",
                "--cli",
                shell,
                "--task",
                "return-smoke",
                "--cwd",
                ".",
                "--permission",
                "auto",
            ],
            Some(&parent),
        )
        .await;
    assert!(
        delegated.status.success(),
        "delegate failed: {}",
        String::from_utf8_lossy(&delegated.stderr)
    );
    let delegated_stdout = String::from_utf8_lossy(&delegated.stdout);
    let rest = delegated_stdout
        .trim()
        .strip_prefix("delegated ")
        .unwrap_or_else(|| panic!("unexpected delegate output: {delegated_stdout}"));
    let (edge, child) = rest
        .split_once(" -> ")
        .unwrap_or_else(|| panic!("unexpected delegate output: {delegated_stdout}"));
    let edge = edge.to_string();
    let child = child.to_string();

    // The result protocol is the child PTY printing CANVAS_RESULT and then
    // exiting. Input is written as the operator/control plane would write it;
    // the line itself is what an agent would print when completing its task.
    tokio::time::sleep(Duration::from_millis(350)).await;
    server
        .orchestrator
        .agents
        .write(&child, b"echo 'CANVAS_RESULT: native-roundtrip'\nexit\n")
        .unwrap();

    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let row = server
            .orchestrator
            .store
            .delegations_snapshot()
            .unwrap()
            .into_iter()
            .find(|r| r.0 == edge);
        if let Some(row) = row {
            if row.5 == "returned" {
                assert_eq!(row.4.as_deref(), Some("native-roundtrip"));
                break;
            }
        }
        assert!(Instant::now() < deadline, "delegation never returned");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // Leave no interactive parent shell behind for the test runner.
    let _ = server.orchestrator.confirm_destructive(&parent, "kill");
}

#[tokio::test]
async fn control_socket_rejects_a_bad_token_before_upgrade() {
    let server = ControlServer::start().await;
    let url = format!("ws://127.0.0.1:{}/ws?token=wrong", server.port);
    assert!(tokio_tungstenite::connect_async(url).await.is_err());
}
