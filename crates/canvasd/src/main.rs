//! canvasd — local daemon for the agent canvas.
//!
//! Binds to 127.0.0.1 only. Every connection requires the per-launch session
//! token (`?token=` on /ws, `Authorization: Bearer` on /api/*).

mod agent;
mod protocol;
mod store;

use agent::AgentManager;
use anyhow::Result;
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    http::{header, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use base64::Engine;
use protocol::{decode_pty_frame, encode_pty_frame, AgentStatus, ClientMsg, ServerMsg};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::sync::{broadcast, mpsc};
use tracing::{info, warn};

type AgentId = String;

#[derive(Clone)]
struct AppState {
    token: String,
    events: broadcast::Sender<Event>,
    agents: Arc<AgentManager>,
    store: Arc<store::Store>,
    repo_root: PathBuf,
}

/// Wire event: control (JSON) or raw PTY output (binary).
#[derive(Debug, Clone)]
enum Event {
    Control(ServerMsg),
    PtyOutput(AgentId, Vec<u8>),
}

#[derive(Debug, Deserialize)]
struct WsQuery {
    token: String,
}

#[derive(Debug, Serialize)]
struct Health {
    status: &'static str,
    version: &'static str,
}

async fn health() -> Json<Health> {
    Json(Health { status: "ok", version: env!("CARGO_PKG_VERSION") })
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    if q.token != state.token {
        return (StatusCode::UNAUTHORIZED, "invalid session token").into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    let mut rx = state.events.subscribe();
    info!("websocket client connected");

    // Fan-out task: broadcast events → socket (JSON for control, binary for PTY).
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(256);
    let writer_state = state.clone();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(Event::Control(msg)) => {
                    let Ok(text) = serde_json::to_string(&msg) else { continue };
                    if out_tx.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                Ok(Event::PtyOutput(id, bytes)) => {
                    if out_tx
                        .send(Message::Binary(encode_pty_frame(&id, &bytes).into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "client lagged on board events");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
        drop(writer_state);
    });

    let send_control = |msg: ServerMsg| {
        let _ = state.events.send(Event::Control(msg));
    };

    loop {
        tokio::select! {
            out = out_rx.recv() => match out {
                Some(msg) => {
                    if socket.send(msg).await.is_err() {
                        break;
                    }
                }
                None => break,
            },
            msg = socket.recv() => match msg {
                Some(Ok(Message::Text(text))) => {
                    handle_client_msg(&text, &state, &send_control);
                }
                Some(Ok(Message::Binary(frame))) => {
                    // [id_len][agent_id][payload] — client typing into a PTY.
                    if let Some((id, payload)) = decode_pty_frame(&frame) {
                        if let Err(e) = state.agents.write(id, payload) {
                            send_control(ServerMsg::Error {
                                agent_id: Some(id.to_string()),
                                message: e.to_string(),
                            });
                        }
                    }
                }
                Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_))) | None => break,
                Some(Err(_)) => break,
            },
        }
    }
    info!("websocket client disconnected");
}

fn handle_client_msg(
    text: &str,
    state: &Arc<AppState>,
    send_control: &impl Fn(ServerMsg),
) {
    let msg: ClientMsg = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            send_control(ServerMsg::Error {
                agent_id: None,
                message: format!("bad message: {e}"),
            });
            return;
        }
    };

    match msg {
        ClientMsg::SpawnAgent { name, command, cwd } => {
            // Channel for PTY output → broadcast events.
            let (out_tx, mut out_rx) = mpsc::unbounded_channel::<(String, Vec<u8>)>();
            let (exit_tx, mut exit_rx) = mpsc::unbounded_channel::<String>();
            let ev = state.events.clone();
            tokio::spawn(async move {
                while let Some((id, bytes)) = out_rx.recv().await {
                    let _ = ev.send(Event::PtyOutput(id, bytes));
                }
            });
            let ev2 = state.events.clone();
            let store2 = state.store.clone();
            tokio::spawn(async move {
                while let Some(id) = exit_rx.recv().await {
                    let _ = store2.agent_status(&id, "exited");
                    let _ = ev2.send(Event::Control(ServerMsg::Status {
                        agent_id: id,
                        status: AgentStatus::Exited,
                    }));
                }
            });

            match state.agents.spawn(
                &name,
                &command,
                &cwd,
                &state.repo_root,
                out_tx,
                exit_tx,
            ) {
                Ok(id) => {
                    if let Err(e) = state.store.agent_spawned(
                        &id,
                        &name,
                        &command,
                        &id, // worktree path resolved inside manager; id suffices for now
                    ) {
                        warn!(error = %e, "failed to persist agent");
                    }
                    send_control(ServerMsg::Spawned { agent_id: id, name });
                }
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: None,
                    message: e.to_string(),
                }),
            }
        }
        ClientMsg::PtyInput { agent_id, data } => {
            match base64::engine::general_purpose::STANDARD.decode(&data) {
                Ok(bytes) => {
                    if let Err(e) = state.agents.write(&agent_id, &bytes) {
                        send_control(ServerMsg::Error {
                            agent_id: Some(agent_id),
                            message: e.to_string(),
                        });
                    }
                }
                Err(e) => send_control(ServerMsg::Error {
                    agent_id: Some(agent_id),
                    message: format!("bad base64: {e}"),
                }),
            }
        }
        ClientMsg::PtyResize { agent_id, cols, rows } => {
            if let Err(e) = state.agents.resize(&agent_id, cols, rows) {
                send_control(ServerMsg::Error {
                    agent_id: Some(agent_id),
                    message: e.to_string(),
                });
            }
        }
        ClientMsg::ConfirmDestructive { agent_id, action } => {
            // The ONLY path to destructive actions — never prompt text.
            match action.as_str() {
                "kill" => match state.agents.kill(&agent_id) {
                    Ok(()) => {
                        let _ = state.store.agent_status(&agent_id, "exited");
                        send_control(ServerMsg::Status {
                            agent_id,
                            status: AgentStatus::Exited,
                        });
                    }
                    Err(e) => send_control(ServerMsg::Error {
                        agent_id: Some(agent_id),
                        message: e.to_string(),
                    }),
                },
                other => send_control(ServerMsg::Error {
                    agent_id: Some(agent_id),
                    message: format!("unknown destructive action: {other}"),
                }),
            }
        }
        ClientMsg::KillAgent { agent_id } => {
            // Direct kill requests are refused: require ConfirmDestructive.
            send_control(ServerMsg::Error {
                agent_id: Some(agent_id),
                message: "kill requires confirm_destructive".into(),
            });
        }
    }
}

async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let ok = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v == format!("Bearer {}", state.token))
        .unwrap_or(false);
    if ok {
        next.run(req).await
    } else {
        (StatusCode::UNAUTHORIZED, "invalid session token").into_response()
    }
}

fn generate_token() -> String {
    use rand::RngCore;
    let mut buf = [0u8; 32];
    rand::rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "canvasd=info".into()),
        )
        .init();

    let repo_root = std::env::var("CANVAS_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap());

    let token = generate_token();
    let (events, _) = broadcast::channel(512);
    let store = Arc::new(store::Store::open(&repo_root)?);
    let state = Arc::new(AppState {
        token: token.clone(),
        events,
        agents: Arc::new(AgentManager::new()),
        store,
        repo_root,
    });

    let api = Router::new()
        .route("/health", get(health))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .nest("/api", api)
        .with_state(state.clone());

    let port: u16 = std::env::var("CANVASD_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(4242);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!(%addr, "canvasd listening (localhost only)");
    println!("CANVASD_TOKEN={token}");

    axum::serve(listener, app).await?;
    Ok(())
}
