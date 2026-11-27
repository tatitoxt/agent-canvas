//! End-to-end: boot a real `canvasd` binary, drive it over the real
//! WebSocket protocol, and assert control events, auth and worktree
//! isolation. Runs against the shipped protocol, not mocks.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::MaybeTlsStream;
use tokio_tungstenite::WebSocketStream;

type Ws = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

struct Daemon {
    child: Child,
    port: u16,
    token: String,
    repo: std::path::PathBuf,
    home: std::path::PathBuf,
}

impl Daemon {
    /// Boot canvasd on an ephemeral port inside a fresh git repo.
    fn start() -> Self {
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let repo = std::env::temp_dir().join(format!(
            "canvasd-e2e-{}-{}",
            std::process::id(),
            N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        let home = std::env::temp_dir().join(format!(
            "canvasd-e2e-home-{}-{}",
            std::process::id(),
            N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        let _ = std::fs::remove_dir_all(&repo);
        std::fs::create_dir_all(&repo).unwrap();
        Command::new("git")
            .args(["init", "-q"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::fs::write(repo.join("seed.txt"), "seed").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-qm", "seed"])
            .current_dir(&repo)
            .env("GIT_AUTHOR_NAME", "e2e")
            .env("GIT_AUTHOR_EMAIL", "e2e@canvas")
            .env("GIT_COMMITTER_NAME", "e2e")
            .env("GIT_COMMITTER_EMAIL", "e2e@canvas")
            .output()
            .unwrap();

        let mut child = Command::new(env!("CARGO_BIN_EXE_canvasd"))
            .env("CANVASD_PORT", port.to_string())
            .env("CANVAS_REPO", &repo)
            .env("HOME", &home)
            // Keep user-config resolution inside the temp home too: on a
            // Linux dev machine with XDG_CONFIG_HOME set, vault writes
            // would otherwise escape into the real config dir.
            .env("XDG_CONFIG_HOME", home.join(".config"))
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("spawn canvasd");
        let stdout = child.stdout.take().unwrap();
        let mut lines = BufReader::new(stdout).lines();
        let mut token = String::new();
        // Token is printed on stdout at startup: `CANVASD_TOKEN=<hex>`.
        for _ in 0..50 {
            let line = lines.next().unwrap().unwrap();
            if let Some(t) = line.strip_prefix("CANVASD_TOKEN=") {
                token = t.trim().to_string();
                break;
            }
        }
        assert!(!token.is_empty(), "canvasd never printed its session token");
        Self {
            child,
            port,
            token,
            repo,
            home,
        }
    }

    fn ws_url(&self, token: &str) -> String {
        format!("ws://127.0.0.1:{}/ws?token={}", self.port, token)
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = std::fs::remove_dir_all(&self.repo);
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

/// Next JSON control message within `timeout`, skipping binary PTY
/// frames. `None` means the stream ended (a quiet stretch is retried
/// until the deadline, not treated as the end).
async fn next_ctrl(ws: &mut Ws, timeout: Duration) -> Option<Value> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let msg = match tokio::time::timeout(remaining, ws.next()).await {
            Err(_) => return None,   // timed out, no frame in the whole window
            Ok(None) => return None, // stream ended
            Ok(Some(Err(_))) => return None,
            Ok(Some(Ok(m))) => m,
        };
        if let Message::Text(text) = msg {
            return serde_json::from_str(&text).ok();
        }
        // Binary PTY frames are skipped.
    }
    None
}

/// Collect control messages until `pred` matches or the deadline passes;
/// returns every message seen (for asserting sequences). Quiet stretches
/// keep waiting — ticks arrive every 1-3s; only a dead stream stops early.
async fn collect_until(
    ws: &mut Ws,
    timeout: Duration,
    pred: impl Fn(&Value) -> bool,
) -> Vec<Value> {
    let deadline = Instant::now() + timeout;
    let mut seen = Vec::new();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match next_ctrl(ws, remaining).await {
            Some(m) => {
                let hit = pred(&m);
                seen.push(m);
                if hit {
                    break;
                }
            }
            None => break,
        }
    }
    seen
}

fn pty_frame(agent_id: &str, data: &[u8]) -> Vec<u8> {
    let id = agent_id.as_bytes();
    let mut buf = Vec::with_capacity(1 + id.len() + data.len());
    buf.push(id.len() as u8);
    buf.extend_from_slice(id);
    buf.extend_from_slice(data);
    buf
}

#[tokio::test]
async fn rejects_bad_token() {
    let d = Daemon::start();
    let r = tokio_tungstenite::connect_async(d.ws_url("nope")).await;
    assert!(r.is_err(), "a wrong session token must not upgrade to WS");
}

#[tokio::test]
async fn end_to_end_agent_lifecycle() {
    let d = Daemon::start();
    let (mut ws, _) = tokio_tungstenite::connect_async(d.ws_url(&d.token))
        .await
        .expect("ws connect");

    // First control message on connect is the board snapshot.
    let snap = next_ctrl(&mut ws, Duration::from_secs(5)).await.unwrap();
    assert_eq!(snap["type"], "snapshot");

    // Create a workspace; agents spawned into it run in ITS repo.
    ws.send(Message::Text(
        json!({"cmd":"create_workspace","name":"e2e-ws","repo":d.repo.to_str().unwrap()})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(3), |m| {
        m["type"] == "workspace_created"
    })
    .await;
    let ws_id = seen
        .iter()
        .find(|m| m["type"] == "workspace_created")
        .unwrap()["workspace_id"]
        .as_str()
        .unwrap()
        .to_string();

    // Spawn a bash agent inside the workspace.
    ws.send(Message::Text(
        json!({
            "cmd": "spawn_agent", "name": "e2e-agent", "command": "bash",
            "cwd": ".", "workspace_id": ws_id, "permission": "auto"
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(5), |m| m["type"] == "spawned").await;
    let agent_id = seen.iter().find(|m| m["type"] == "spawned").unwrap()["agent_id"]
        .as_str()
        .unwrap()
        .to_string();

    // Write a file inside the agent's PTY; the diff ticker should report it.
    ws.send(Message::Binary(
        pty_frame(&agent_id, b"echo x > made.txt\n").into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(12), |m| {
        m["type"] == "diff" && m["files"].as_u64().unwrap_or(0) >= 1
    })
    .await;
    assert!(
        seen.iter()
            .any(|m| m["type"] == "diff" && m["files"].as_u64().unwrap_or(0) >= 1),
        "expected a diff event reporting the file the agent created; saw {seen:?}"
    );
    // The file must exist inside the agent's own worktree, not the repo root.
    let worktree = d.repo.join(".canvas-worktrees").join(&agent_id);
    assert!(
        worktree.join("made.txt").exists(),
        "agent wrote outside its worktree?"
    );

    // Kill is gated: bare kill_agent is refused, confirm_destructive executes.
    ws.send(Message::Text(
        json!({"cmd":"kill_agent","agent_id":agent_id})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(3), |m| {
        m["type"] == "error"
            && m["message"]
                .as_str()
                .unwrap_or("")
                .contains("confirm_destructive")
    })
    .await;
    assert!(
        seen.iter().any(|m| m["type"] == "error"),
        "bare kill must be refused"
    );

    ws.send(Message::Text(
        json!({"cmd":"confirm_destructive","agent_id":agent_id,"action":"kill"})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(5), |m| {
        m["type"] == "status" && m["status"] == "exited"
    })
    .await;
    assert!(
        seen.iter()
            .any(|m| m["type"] == "status" && m["status"] == "exited"),
        "confirmed kill must exit the agent"
    );
}

#[tokio::test]
async fn repo_write_requires_a_registered_repository_not_only_a_vault_grant() {
    let d = Daemon::start();
    let vault = d.home.join("vault");
    let workspace = d.home.join("workspace");
    std::fs::create_dir_all(&vault).unwrap();
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::write(vault.join("private.md"), "original vault contents").unwrap();
    std::fs::write(workspace.join("README.md"), "workspace original").unwrap();

    let (mut ws, _) = tokio_tungstenite::connect_async(d.ws_url(&d.token))
        .await
        .expect("ws connect");
    let snap = next_ctrl(&mut ws, Duration::from_secs(5)).await.unwrap();
    assert_eq!(snap["type"], "snapshot");

    // An explicit Vault grant makes the path accessible to vault features,
    // but must not authorize repository editor writes.
    ws.send(Message::Text(
        json!({"cmd":"vault_register","dir":vault.to_str().unwrap()})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    collect_until(&mut ws, Duration::from_secs(3), |m| {
        m["type"] == "vault_discovered"
    })
    .await;
    ws.send(Message::Text(
        json!({
            "cmd":"repo_write", "dir":vault.to_str().unwrap(), "path":"private.md",
            "text":"overwritten", "base_text":"original vault contents"
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(3), |m| {
        m["type"] == "error"
            && m["message"]
                .as_str()
                .unwrap_or("")
                .contains("repository is not registered")
    })
    .await;
    assert!(
        seen.iter().any(|m| m["type"] == "error"),
        "Vault grant must not grant repo-write access: {seen:?}"
    );
    assert_eq!(
        std::fs::read_to_string(vault.join("private.md")).unwrap(),
        "original vault contents"
    );

    // Registering a workspace is the explicit action that grants the Code
    // Editor write path for that repository.
    ws.send(Message::Text(
        json!({"cmd":"create_workspace","name":"writable","repo":workspace.to_str().unwrap()})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    collect_until(&mut ws, Duration::from_secs(3), |m| {
        m["type"] == "workspace_created"
    })
    .await;
    ws.send(Message::Text(
        json!({
            "cmd":"repo_write", "dir":workspace.to_str().unwrap(), "path":"README.md",
            "text":"workspace updated", "base_text":"workspace original"
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(3), |m| {
        m["type"] == "repo_file" && m["path"] == "README.md"
    })
    .await;
    assert!(
        seen.iter().any(|m| m["type"] == "repo_file"),
        "registered workspace should remain editable: {seen:?}"
    );
    assert_eq!(
        std::fs::read_to_string(workspace.join("README.md")).unwrap(),
        "workspace updated"
    );

    let _ = std::fs::remove_dir_all(vault);
    let _ = std::fs::remove_dir_all(workspace);
}

#[tokio::test]
async fn delegation_resolves_on_canvas_result() {
    let d = Daemon::start();
    let (mut ws, _) = tokio_tungstenite::connect_async(d.ws_url(&d.token))
        .await
        .expect("ws connect");
    let snap = next_ctrl(&mut ws, Duration::from_secs(5)).await.unwrap();
    assert_eq!(snap["type"], "snapshot");

    ws.send(Message::Text(
        json!({
            "cmd": "delegate", "from": "orchestrator", "name": "child",
            "command": "bash", "task": "prove it", "cwd": ".",
            "workspace_id": null, "permission": "full"
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(5), |m| {
        m["type"] == "delegation"
    })
    .await;
    let child = seen
        .iter()
        .find(|m| m["type"] == "spawned")
        .expect("delegation spawns a child agent")["agent_id"]
        .as_str()
        .unwrap()
        .to_string();
    let edge_id = seen.iter().find(|m| m["type"] == "delegation").unwrap()["edge_id"]
        .as_str()
        .unwrap()
        .to_string();

    // The PTY process is announced before its shell necessarily finishes
    // startup. Wait for the first visible prompt so this test exercises
    // result handling rather than racing bash's initial line setup.
    let ready = collect_until(&mut ws, Duration::from_secs(5), |m| {
        m["type"] == "activity" && m["agent_id"] == child
    })
    .await;
    assert!(
        ready.iter().any(|m| m["type"] == "activity"),
        "child shell never produced its initial prompt"
    );

    // Child prints the protocol line; the tail scanner resolves the edge.
    ws.send(Message::Binary(
        pty_frame(&child, b"echo 'CANVAS_RESULT: shipped it'\r").into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(8), |m| m["type"] == "result").await;
    let result = seen.iter().find(|m| m["type"] == "result").unwrap_or_else(|| {
        let transcript = std::fs::read(d.repo.join(".canvas/transcripts").join(format!("{child}.bin")))
            .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            .unwrap_or_else(|error| format!("<transcript unavailable: {error}>"));
        let parsed = canvasd::agent::canvas_result_line(&transcript);
        panic!("edge must resolve; events: {seen:?}; parsed: {parsed:?}; transcript: {transcript:?}")
    });
    assert_eq!(result["edge_id"].as_str().unwrap(), edge_id);
    assert!(result["summary"].as_str().unwrap().contains("shipped it"));
}

/// Scan binary PTY frames for `needle` (echoed input / command output)
/// until the deadline; skips control messages.
async fn collect_pty_until(ws: &mut Ws, timeout: Duration, needle: &[u8]) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(remaining, ws.next()).await {
            Ok(Some(Ok(Message::Binary(b)))) => {
                if b.windows(needle.len()).any(|w| w == needle) {
                    return true;
                }
            }
            Ok(Some(Ok(_))) => continue,
            _ => return false,
        }
    }
    false
}

#[tokio::test]
async fn supervised_input_is_gated_until_approved() {
    let d = Daemon::start();
    let (mut ws, _) = tokio_tungstenite::connect_async(d.ws_url(&d.token))
        .await
        .unwrap();
    // Drain the snapshot.
    let _ = next_ctrl(&mut ws, Duration::from_secs(3)).await;

    ws.send(Message::Text(
        json!({"cmd":"spawn_agent","name":"sup","command":"bash","cwd":".","permission":"supervised"})
            .to_string().into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(5), |m| m["type"] == "spawned").await;
    let agent_id = seen.iter().find(|m| m["type"] == "spawned").unwrap()["agent_id"]
        .as_str()
        .unwrap()
        .to_string();

    // Destructive input is held, not written.
    ws.send(Message::Binary(
        pty_frame(&agent_id, b"rm -rf nope.txt\n").into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(4), |m| {
        m["type"] == "needs_approval"
    })
    .await;
    let held = seen.iter().find(|m| m["type"] == "needs_approval");
    assert!(
        held.is_some(),
        "supervised agent must gate destructive input"
    );
    assert!(held.unwrap()["line"].as_str().unwrap().contains("rm -rf"));

    // Denied input never reaches the PTY; approving after a deny is a no-op.
    ws.send(Message::Text(
        json!({"cmd":"deny_input","agent_id":agent_id})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    ws.send(Message::Text(
        json!({"cmd":"approve_input","agent_id":agent_id})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(3), |m| {
        m["type"] == "error"
            && m["message"]
                .as_str()
                .unwrap_or("")
                .contains("no pending input")
    })
    .await;
    assert!(
        seen.iter().any(|m| m["type"] == "error"),
        "deny must drop the stashed input"
    );

    // Approved input is released to the PTY — bash echoes it back.
    ws.send(Message::Binary(
        pty_frame(&agent_id, b"rm -rf nope.txt\n").into(),
    ))
    .await
    .unwrap();
    let _ = collect_until(&mut ws, Duration::from_secs(4), |m| {
        m["type"] == "needs_approval"
    })
    .await;
    ws.send(Message::Text(
        json!({"cmd":"approve_input","agent_id":agent_id})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    assert!(
        collect_pty_until(&mut ws, Duration::from_secs(5), b"rm -rf nope.txt").await,
        "approved input must reach the agent's PTY"
    );
}

#[tokio::test]
async fn automation_guardrails_fire() {
    let d = Daemon::start();
    let (mut ws, _) = tokio_tungstenite::connect_async(d.ws_url(&d.token))
        .await
        .unwrap();
    let _ = next_ctrl(&mut ws, Duration::from_secs(3)).await;

    // Save an automation: deny policy for gated input, 10s hang limit.
    ws.send(Message::Text(
        json!({
            "cmd": "create_automation",
            "name": "nightly",
            "prompt": "sleep 30",
            "command": "bash",
            "workspace_id": null,
            "permission": "supervised",
            "idle_secs": 10,
            "on_approval": "deny"
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(4), |m| {
        m["type"] == "automation_saved"
    })
    .await;
    let auto_id = seen
        .iter()
        .find(|m| m["type"] == "automation_saved")
        .unwrap()["automation"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Run it → agent spawns under automation meta.
    ws.send(Message::Text(
        json!({"cmd":"run_automation","automation_id":auto_id})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(5), |m| m["type"] == "spawned").await;
    let agent_id = seen.iter().find(|m| m["type"] == "spawned").unwrap()["agent_id"]
        .as_str()
        .unwrap()
        .to_string();

    // Deny policy: gated input surfaces as needs_attention, never needs_approval.
    ws.send(Message::Binary(
        pty_frame(&agent_id, b"sudo rm -rf /\n").into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(4), |m| {
        m["type"] == "needs_attention" || m["type"] == "needs_approval"
    })
    .await;
    assert!(seen.iter().any(|m| m["type"] == "needs_attention"));
    assert!(!seen.iter().any(|m| m["type"] == "needs_approval"));

    // Hang guardrail: agent goes silent; after idle_secs an alert fires once.
    let seen = collect_until(&mut ws, Duration::from_secs(14), |m| {
        m["type"] == "needs_attention" && m["reason"].as_str().unwrap_or("").contains("silent")
    })
    .await;
    assert!(
        seen.iter()
            .any(|m| m["reason"].as_str().unwrap_or("").contains("silent")),
        "idle agent must raise a hang alert"
    );
}

/// Chain fallback end-to-end: a workspace chain of fake CLIs where `claude`
/// dies at launch and `codex` idles. The daemon must announce the original
/// spawn, then a replacement spawned as the next chain entry with
/// `fallback_from` marking the substitution — the same events the Tauri
/// shell now emits through its mirrored watcher.
#[cfg(unix)]
#[tokio::test]
async fn chain_fallback_respawns_dead_cli_as_next_chain_entry() {
    let d = Daemon::start();
    // Fake CLIs must win resolution inside the PTY's login shell:
    // ~/.bash_profile runs after /etc/profile, so this prepend survives
    // path_helper-style PATH reordering. `claude` dies instantly; `codex`
    // idles long enough to observe the replacement (and is killed after).
    let fakebin = d.home.join("fakebin");
    std::fs::create_dir_all(&fakebin).unwrap();
    for (name, body) in [
        ("claude", "#!/bin/sh\nexit 1\n"),
        ("codex", "#!/bin/sh\nexec sleep 30\n"),
    ] {
        let path = fakebin.join(name);
        std::fs::write(&path, body).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::fs::write(
        d.home.join(".bash_profile"),
        format!("export PATH=\"{}:$PATH\"\n", fakebin.display()),
    )
    .unwrap();

    let (mut ws, _) = tokio_tungstenite::connect_async(d.ws_url(&d.token))
        .await
        .expect("ws connect");
    let snap = next_ctrl(&mut ws, Duration::from_secs(5)).await.unwrap();
    assert_eq!(snap["type"], "snapshot");

    ws.send(Message::Text(
        json!({"cmd":"create_workspace","name":"chain-ws","repo":d.repo.to_str().unwrap()})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(3), |m| {
        m["type"] == "workspace_created"
    })
    .await;
    let ws_id = seen
        .iter()
        .find(|m| m["type"] == "workspace_created")
        .unwrap()["workspace_id"]
        .as_str()
        .unwrap()
        .to_string();

    // The configured chain drives the fallback order — no reliance on what
    // the host machine happens to have installed.
    ws.send(Message::Text(
        json!({"cmd":"set_agent_chain","workspace_id":ws_id,"chain":["claude","codex"]})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();

    ws.send(Message::Text(
        json!({
            "cmd": "spawn_agent", "name": "chain-agent", "command": "claude",
            "cwd": ".", "workspace_id": ws_id, "permission": "auto"
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(5), |m| m["type"] == "spawned").await;
    let first = seen.iter().find(|m| m["type"] == "spawned").unwrap();
    assert_eq!(first["command"].as_str().unwrap_or(""), "claude");
    assert!(first["fallback_from"].is_null());

    // The fake claude exits instantly — within seconds the daemon must
    // announce the replacement: same workspace, codex command, the dead
    // CLI marked as the fallback origin.
    let seen = collect_until(&mut ws, Duration::from_secs(10), |m| {
        m["type"] == "spawned" && m["fallback_from"].as_str() == Some("claude")
    })
    .await;
    let replacement = seen
        .iter()
        .find(|m| m["type"] == "spawned" && m["fallback_from"].as_str() == Some("claude"))
        .unwrap_or_else(|| panic!("no fallback replacement announced; saw {seen:?}"));
    assert_eq!(replacement["command"].as_str().unwrap_or(""), "codex");
    assert_eq!(
        replacement["workspace_id"].as_str().unwrap_or(""),
        ws_id.as_str()
    );
    let replacement_id = replacement["agent_id"].as_str().unwrap().to_string();

    // The replacement is a live agent: killing it is operator intent and
    // must not respawn further down the chain.
    ws.send(Message::Text(
        json!({"cmd":"confirm_destructive","agent_id":replacement_id,"action":"kill"})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let seen = collect_until(&mut ws, Duration::from_secs(6), |m| {
        m["type"] == "status" && m["agent_id"] == replacement_id && m["status"] == "exited"
    })
    .await;
    assert!(
        seen.iter()
            .any(|m| m["type"] == "status" && m["status"] == "exited"),
        "replacement must die on confirmed kill"
    );
    // No third spawn may appear: the chain ends at codex, and a deliberate
    // kill disarms the fallback either way.
    let seen = collect_until(&mut ws, Duration::from_secs(3), |m| m["type"] == "spawned").await;
    assert!(
        !seen.iter().any(|m| m["type"] == "spawned"),
        "a deliberate kill must not fall back; saw {seen:?}"
    );
}

/// Raw HTTP/1.1 roundtrip over plain TCP — the daemon's REST surface is
/// small enough that a hand-rolled request beats pulling in a client crate
/// for the e2e suite alone.
async fn raw_http(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n");
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    if !body.is_empty() {
        req.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    req.push_str("\r\n");
    // Write-then-read with writes tolerant of reset: a rejecting server
    // (413 oversize) responds and closes long before an 11 MB body finishes
    // uploading, and the RST its close generates must not eat the response
    // the test is asserting on.
    let _ = stream.write_all(req.as_bytes()).await;
    let _ = stream.write_all(body).await;
    let mut out = Vec::new();
    let read = stream.read_to_end(&mut out).await;
    assert!(
        read.is_ok() && !out.is_empty(),
        "no response read: {read:?}"
    );
    String::from_utf8_lossy(&out).to_string()
}

#[tokio::test]
async fn share_and_export_roundtrip_over_http() {
    let d = Daemon::start();
    let auth = format!("Bearer {}", d.token);

    // POST /api/share publishes the bytes and answers the share path. The
    // base64 decodes to "%PDF-e2e-bytes".
    let payload =
        json!({"title":"e2e digest","mime":"application/pdf","b64":"JVBERi1lMmUtYnl0ZXM="})
            .to_string();
    let res = raw_http(
        d.port,
        "POST",
        "/api/share",
        &[
            ("Authorization", auth.as_str()),
            ("Content-Type", "application/json"),
        ],
        payload.as_bytes(),
    )
    .await;
    assert!(
        res.starts_with("HTTP/1.1 200"),
        "share create failed: {res}"
    );
    let body = res.split("\r\n\r\n").nth(1).unwrap_or("");
    let created: Value = serde_json::from_str(body).unwrap();
    let share_path = created["url"].as_str().unwrap();
    assert!(share_path.starts_with("/share/"), "got {share_path}");

    // GET /share/{id} is public — no token — and streams the exact bytes
    // back with the mime type and an inline pdf filename.
    let res = raw_http(d.port, "GET", share_path, &[], b"").await;
    assert!(res.starts_with("HTTP/1.1 200"), "share get failed: {res}");
    assert!(res.contains("content-type: application/pdf"), "got: {res}");
    assert!(
        res.contains("content-disposition: inline; filename=\"e2e digest.pdf\""),
        "got: {res}"
    );
    assert!(res.contains("%PDF-e2e-bytes"), "body missing: {res}");

    // Unknown ids 404 with the same message either shell serves.
    let res = raw_http(d.port, "GET", "/share/0000000000000000", &[], b"").await;
    assert!(res.starts_with("HTTP/1.1 404"), "got: {res}");

    // The share endpoint rejects oversize payloads with 413 and bad base64
    // with 400 — the two rejection paths share::DecodeError keeps distinct.
    use base64::Engine;
    let oversized = json!({
        "title": "big",
        "mime": "application/pdf",
        "b64": base64::engine::general_purpose::STANDARD.encode(vec![0u8; 8 * 1024 * 1024 + 1]),
    })
    .to_string();
    let res = raw_http(
        d.port,
        "POST",
        "/api/share",
        &[
            ("Authorization", auth.as_str()),
            ("Content-Type", "application/json"),
        ],
        oversized.as_bytes(),
    )
    .await;
    assert!(
        res.starts_with("HTTP/1.1 413"),
        "got: {}",
        &res[..200.min(res.len())]
    );
    let bad = json!({"title":"x","mime":"m","b64":"!!!"}).to_string();
    let res = raw_http(
        d.port,
        "POST",
        "/api/share",
        &[
            ("Authorization", auth.as_str()),
            ("Content-Type", "application/json"),
        ],
        bad.as_bytes(),
    )
    .await;
    assert!(res.starts_with("HTTP/1.1 400"), "got: {res}");

    // GET /api/export answers the versioned dump; auth required.
    let res = raw_http(
        d.port,
        "GET",
        "/api/export",
        &[("Authorization", auth.as_str())],
        b"",
    )
    .await;
    assert!(res.starts_with("HTTP/1.1 200"), "export failed: {res}");
    assert!(res.contains("\"version\":1"), "got: {res}");
    assert!(res.contains("\"boards\""), "got: {res}");
}
