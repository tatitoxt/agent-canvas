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

  spawnAgent(name: string, command: string, cwd = ".", workspaceId?: string, permission?: string, boardId?: string) {
    void invoke("spawn_agent", { name, command, cwd, workspaceId: workspaceId ?? null, permission: permission ?? null, boardId: boardId ?? null }).catch(
      console.error,
    );
  }

  createWorkspace(name: string, repo: string, boardId?: string) {
    void invoke("create_workspace", { name, repo, boardId: boardId ?? null }).catch(console.error);
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

  createAutomation(a: {
    name: string;
    prompt: string;
    command: string;
    workspace_id?: string;
    permission?: string;
    idle_secs?: number;
    on_approval?: string;
  }) {
    void invoke("create_automation", {
      name: a.name,
      prompt: a.prompt,
      command: a.command,
      workspaceId: a.workspace_id ?? null,
      permission: a.permission ?? null,
      idleSecs: a.idle_secs ?? null,
      onApproval: a.on_approval ?? null,
    }).catch(console.error);
  }

  runAutomation(automationId: string) {
    void invoke("run_automation", { automationId }).catch(console.error);
  }

  deleteAutomation(automationId: string) {
    void invoke("delete_automation", { automationId }).catch(console.error);
  }

  delegate(from: string, name: string, command: string, task: string, cwd = ".", workspaceId?: string, permission?: string) {
    void invoke("delegate", { from, name, command, task, cwd, workspaceId: workspaceId ?? null, permission: permission ?? null }).catch(
      console.error,
    );
  }

  createBoard(name: string) {
    invoke("create_board", { name }).catch(console.error);
  }

  moveToBoard(nodeId: string, boardId: string) {
    invoke("move_to_board", { nodeId, boardId }).catch(console.error);
  }

  renameNode(nodeId: string, name: string) {
    invoke("rename_node", { nodeId, name }).catch(console.error);
  }

  renameBoard(boardId: string, name: string) {
    invoke("rename_board", { boardId, name }).catch(console.error);
  }

  deleteBoard(boardId: string) {
    invoke("delete_board", { boardId }).catch(console.error);
  }

  diffDetail(agentId: string) {
    invoke("diff_detail", { agentId }).catch(console.error);
  }

  transcript(agentId: string) {
    void invoke("transcript", { agentId }).catch(console.error);
  }
}

export const isTauri = () =>
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in window;
