//! canvasctl — orchestration primitive injected into every agent PTY.
//!
//! Any CLI agent (claude, codex, gemini, a plain bash, an orchestrator
//! persona) can drive the canvas it lives on:
//!
//!   canvasctl agents                        list agents on this daemon
//!   canvasctl delegate --name N --cli CMD --task TEXT [opts]
//!   canvasctl spawn --name N --cmd CMD [--cwd .]
//!   canvasctl boards                        list boards
//!
//! Auth comes from env the daemon injects: CANVAS_PORT + CANVAS_TOKEN.
//! CANVAS_AGENT_ID marks the caller as a delegation parent when set.

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

type Ws = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

async fn connect() -> Result<Ws> {
    let port = std::env::var("CANVAS_PORT").context("CANVAS_PORT not set (not inside a canvas PTY?)")?;
    let token = std::env::var("CANVAS_TOKEN").context("CANVAS_TOKEN not set")?;
    let url = format!("ws://127.0.0.1:{port}/ws?token={token}");
    let (ws, _) = connect_async(url).await.context("cannot reach canvasd")?;
    Ok(ws)
}

/// Read frames until `pred` matches a text JSON message (skips binary PTY
/// frames), with an overall timeout.
async fn wait_for(
    ws: &mut (impl StreamExt<Item = std::result::Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin),
    timeout: Duration,
    pred: impl Fn(&Value) -> bool,
) -> Result<Value> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        if left.is_zero() {
            bail!("timeout waiting for daemon reply");
        }
        match tokio::time::timeout(left, ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                let v: Value = serde_json::from_str(&t).unwrap_or(Value::Null);
                if v.get("type").and_then(|t| t.as_str()) == Some("error") {
                    bail!("daemon error: {}", v["message"].as_str().unwrap_or("?"));
                }
                if pred(&v) {
                    return Ok(v);
                }
            }
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(e))) => bail!("ws error: {e}"),
            Ok(None) => bail!("daemon closed the connection"),
            Err(_) => bail!("timeout waiting for daemon reply"),
        }
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let sub = args.get(1).map(|s| s.as_str()).unwrap_or_else(|| usage());
    let rest = &args[2.min(args.len())..];

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
            let command = flag(rest, cmd_flag)
                .unwrap_or_else(|| "bash".into());
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
            let title = flag(rest, "--title")
                .unwrap_or_else(|| usage());
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
            println!("artifact {}", reply["artifact"]["artifact_id"].as_str().unwrap_or(""));
        }
        _ => usage(),
    }
    Ok(())
}
