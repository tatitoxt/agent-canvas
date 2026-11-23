// Tauri transport: same surface as CanvasClient but over native
// commands (invoke) + events (listen) instead of a WebSocket.
// Control payloads are identical ServerMsg JSON — one protocol, two transports.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Handlers } from "./client";

const b64encode = (bytes: Uint8Array) => {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
};

const b64decode = (s: string) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class TauriCanvasClient {
  private unlistens: UnlistenFn[] = [];

  constructor(handlers: Handlers) {
    void listen<{ agent_id: string; data: string }>("canvas://pty", (ev) => {
      handlers.onPty(ev.payload.agent_id, b64decode(ev.payload.data));
    }).then((u) => this.unlistens.push(u));

    void listen<unknown>("canvas://control", (ev) => {
      handlers.onControl(ev.payload as Parameters<Handlers["onControl"]>[0]);
    }).then((u) => this.unlistens.push(u));

    // Snapshot arrives via command, not an event, in Tauri mode.
    void invoke<unknown>("snapshot").then((snap) => {
      handlers.onControl(snap as Parameters<Handlers["onControl"]>[0]);
    });
  }

  whenOpen(): Promise<void> {
    return Promise.resolve();
  }

  spawnAgent(name: string, command: string, cwd = ".", workspaceId?: string, permission?: string) {
    void invoke("spawn_agent", { name, command, cwd, workspaceId: workspaceId ?? null, permission: permission ?? null }).catch(
      console.error,
    );
  }

  createWorkspace(name: string, repo: string) {
    void invoke("create_workspace", { name, repo }).catch(console.error);
  }

  ptyInput(agentId: string, bytes: Uint8Array) {
    void invoke("pty_input", { agentId, data: b64encode(bytes) }).catch(
      console.error,
    );
  }

  resize(agentId: string, cols: number, rows: number) {
    void invoke("pty_resize", { agentId, cols, rows }).catch(console.error);
  }

  confirmDestructive(agentId: string, action: "kill") {
    void invoke("confirm_destructive", { agentId, action: action }).catch(
      console.error,
    );
  }

  moveNode(agentId: string, x: number, y: number) {
    void invoke("move_node", { agentId, x, y }).catch(console.error);
  }

  approveInput(agentId: string) {
    void invoke("approve_input", { agentId }).catch(console.error);
  }

  denyInput(agentId: string) {
    void invoke("deny_input", { agentId }).catch(console.error);
  }

  delegate(from: string, name: string, command: string, task: string, cwd = ".", workspaceId?: string, permission?: string) {
    void invoke("delegate", { from, name, command, task, cwd, workspaceId: workspaceId ?? null, permission: permission ?? null }).catch(
      console.error,
    );
  }
}

export const isTauri = () =>
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in window;
