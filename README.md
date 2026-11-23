# Agent Canvas

An infinite dark canvas for coordinating real coding agents — an orchestrator node delegates tasks to agent nodes, and every delegation is a first-class edge carrying the task down and the result back.

**Status: early prototype.** Visual prototype (P0.5) with mock data, plus the daemon skeleton it will grow into.

## Architecture

A local Rust daemon (`canvasd`) owns the real work — PTY sessions, git worktrees, SQLite persistence — and the web frontend is a pure client talking to it over a session-token-authenticated WebSocket. Same frontend serves local and (later) remote/cloud setups; the daemon is the future always-on machine.

```
web/                Vite + React 19 + TypeScript + React Flow v12 + xterm.js
crates/canvasd/     Rust daemon: tokio + axum + portable-pty + rusqlite
```

## Develop

```sh
cd web && npm install
make dev            # daemon on 127.0.0.1:4242 + web dev server
```

The daemon binds localhost only and prints a `CANVASD_TOKEN` at launch; WS clients pass it as `?token=`, HTTP as `Authorization: Bearer`.

## Design language

Dark-first. One glance at the mission strip answers: what is running, what needs you, what is blocked, what is done. Status lives in the node halo and pill; delegation edges show direction (task → result ←) with expandable payload labels.

## Limitations

- P0.5: nodes/edges are mock data; no PTY is spawned yet.
- Multi-account, remote access, marketplace and voice are explicitly out of scope for the MVP.
- The daemon protocol is pre-1.0 and will change.
