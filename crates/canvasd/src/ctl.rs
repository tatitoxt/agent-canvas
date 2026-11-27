//! canvasctl client implementation as a library.
//!
//! The standalone `canvasctl` binary is a thin wrapper around this module.
//! Keeping the client here lets the native shell re-enter the same CLI when
//! its generated shim invokes the app executable with `--canvasctl`, so agents
//! get byte-identical behavior whether the board is owned by canvasd or by
//! the desktop app.

use anyhow::{bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio_tungstenite::{connect_async, tungstenite::Message};

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn usage() -> ! {
    eprintln!(
        "canvasctl — drive this canvas\n\
         \n  agents                          list agents\n\
           boards                          list boards\n\
           spawn  --name N --cmd C [--cwd .] [--workspace W] [--board B]\n\
           delegate --name N --cli C --task T [--cwd .] [--workspace W] [--permission P]
           artifact --kind K --title T [--path P] [--text T]"
    );
    std::process::exit(2);
}

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect() -> Result<Ws> {
    let port =
        std::env::var("CANVAS_PORT").context("CANVAS_PORT not set (not inside a canvas PTY?)")?;
    let token = std::env::var("CANVAS_TOKEN").context("CANVAS_TOKEN not set")?;
    let url = format!("ws://127.0.0.1:{port}/ws?token={token}");
    let (ws, _) = connect_async(url)
        .await
        .context("cannot reach the canvas control socket")?;
    Ok(ws)
}

/// Read frames until `pred` matches a text JSON message (skips binary PTY
/// frames), with an overall timeout.
async fn wait_for(
    ws: &mut (impl StreamExt<Item = std::result::Result<Message, tokio_tungstenite::tungstenite::Error>>
              + Unpin),
    timeout: Duration,
    pred: impl Fn(&Value) -> bool,
) -> Result<Value> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        if left.is_zero() {
            bail!("timeout waiting for control reply");
        }
        match tokio::time::timeout(left, ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                let v: Value = serde_json::from_str(&t).unwrap_or(Value::Null);
                if v.get("type").and_then(|t| t.as_str()) == Some("error") {
                    bail!("control error: {}", v["message"].as_str().unwrap_or("?"));
                }
                if pred(&v) {
                    return Ok(v);
                }
            }
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(e))) => bail!("ws error: {e}"),
            Ok(None) => bail!("control socket closed"),
            Err(_) => bail!("timeout waiting for control reply"),
        }
    }
}

/// Run one canvasctl invocation. `args` excludes argv[0]: the first item is
/// the subcommand (`agents`, `spawn`, …).
pub async fn run(args: Vec<String>) -> Result<()> {
    let sub = args.first().map(|s| s.as_str()).unwrap_or_else(|| usage());
    let rest: &[String] = if args.len() > 1 { &args[1..] } else { &[] };

    match sub {
        "agents" | "boards" => {
            let mut ws = connect().await?;
            let snap = wait_for(&mut ws, Duration::from_secs(10), |v| {
                v["type"] == "snapshot"
            })
            .await?;
            if sub == "agents" {
                for a in snap["agents"].as_array().cloned().unwrap_or_default() {
                    println!(
                        "{}\t{}\t{}\t{}",
                        a["agent_id"].as_str().unwrap_or(""),
                        a["status"].as_str().unwrap_or(""),
                        a["command"].as_str().unwrap_or(""),
                        a["name"].as_str().unwrap_or("")
                    );
                }
            } else {
                for b in snap["boards"].as_array().cloned().unwrap_or_default() {
                    println!(
                        "{}\t{}",
                        b["board_id"].as_str().unwrap_or(""),
                        b["name"].as_str().unwrap_or("")
                    );
                }
            }
        }
        "spawn" | "delegate" => {
            let is_delegate = sub == "delegate";
            let name = flag(rest, "--name").unwrap_or_else(|| "agent".into());
            let cmd_flag = if is_delegate { "--cli" } else { "--cmd" };
            // Default shell is platform-native: bash exists on every Unix
            // canvas targets; Windows gets cmd (bash only exists there as
            // an optional git-bash install).
            let default_shell = if cfg!(windows) { "cmd" } else { "bash" };
            let command = flag(rest, cmd_flag).unwrap_or_else(|| default_shell.into());
            let cwd = flag(rest, "--cwd").unwrap_or_else(|| ".".into());
            let mut msg = json!({
                "cmd": if is_delegate { "delegate" } else { "spawn_agent" },
                "name": name,
                "command": command,
                "cwd": cwd,
            });
            for (k, f) in [
                ("workspace_id", "--workspace"),
                ("permission", "--permission"),
                ("board_id", "--board"),
            ] {
                if let Some(v) = flag(rest, f) {
                    msg[k] = json!(v);
                }
            }
            if is_delegate {
                let task = flag(rest, "--task").context("--task is required")?;
                msg["task"] = json!(task);
                msg["from"] = json!(std::env::var("CANVAS_AGENT_ID")
                    .context("CANVAS_AGENT_ID not set — delegate must run inside an agent")?);
            }

            let mut ws = connect().await?;
            // Drain the snapshot first, then send.
            let _ = wait_for(&mut ws, Duration::from_secs(10), |v| {
                v["type"] == "snapshot"
            })
            .await?;
            ws.send(Message::text(msg.to_string())).await?;
            let reply = wait_for(&mut ws, Duration::from_secs(30), |v| {
                v["type"] == if is_delegate { "delegation" } else { "spawned" }
            })
            .await?;
            if is_delegate {
                println!(
                    "delegated {} -> {}",
                    reply["edge_id"].as_str().unwrap_or(""),
                    reply["to"].as_str().unwrap_or("")
                );
            } else {
                println!("spawned {}", reply["agent_id"].as_str().unwrap_or(""));
            }
        }
        "artifact" => {
            let mut ws = connect().await?;
            let kind = flag(rest, "--kind").unwrap_or_else(|| "note".into());
            let title = flag(rest, "--title").unwrap_or_else(|| usage());
            let mut msg = json!({
                "cmd": "artifact_create",
                "kind": kind,
                "title": title,
            });
            if let Some(v) = flag(rest, "--path") {
                msg["path"] = json!(v);
            }
            if let Some(v) = flag(rest, "--text") {
                msg["text"] = json!(v);
            }
            if let Ok(id) = std::env::var("CANVAS_AGENT_ID") {
                msg["agent_id"] = json!(id);
            }
            ws.send(Message::text(msg.to_string())).await?;
            let reply = wait_for(&mut ws, Duration::from_secs(30), |v| {
                v["type"] == "artifact_created" || v["type"] == "error"
            })
            .await?;
            if reply["type"] == "error" {
                anyhow::bail!("{}", reply["message"].as_str().unwrap_or("error"));
            }
            println!(
                "artifact {}",
                reply["artifact"]["artifact_id"].as_str().unwrap_or("")
            );
        }
        _ => usage(),
    }
    Ok(())
}

/// Synchronous entry point for thin binaries embedding the CLI. A
/// current-thread runtime is enough: every invocation is one short-lived
/// websocket client.
pub fn run_blocking(args: Vec<String>) -> Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("failed to create canvasctl runtime")?;
    runtime.block_on(run(args))
}
