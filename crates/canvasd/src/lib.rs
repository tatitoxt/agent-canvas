//! Shared canvas core: agent PTYs, wire protocol, persistence.
//! Used by both the canvasd daemon (WS, remote access) and the Tauri app
//! (native commands/events).

pub mod agent;
pub mod detect;
pub mod paths;
pub mod protocol;
pub mod store;
pub mod vault;
