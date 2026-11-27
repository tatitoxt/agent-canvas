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
  private handlers: Handlers;
  private snapshotReady = false;
  private pendingPty: Array<{ agentId: string; bytes: Uint8Array }> = [];

  constructor(handlers: Handlers) {
    this.handlers = handlers;
    // Install both event listeners before requesting the snapshot. The
    // snapshot command emits PTY scrollback while it builds that response;
    // queue those bytes until the store has reset existing live terminals.
    const ptyReady = listen<{ agent_id: string; data: string }>("canvas://pty", (ev) => {
      const item = { agentId: ev.payload.agent_id, bytes: b64decode(ev.payload.data) };
      if (this.snapshotReady) handlers.onPty(item.agentId, item.bytes);
      else this.pendingPty.push(item);
    }).then((u) => this.unlistens.push(u));

    const controlReady = listen<unknown>("canvas://control", (ev) => {
      handlers.onControl(ev.payload as Parameters<Handlers["onControl"]>[0]);
    }).then((u) => this.unlistens.push(u));

    void Promise.all([ptyReady, controlReady])
      .then(() => invoke<unknown>("snapshot"))
      .then((snap) => {
        handlers.onControl(snap as Parameters<Handlers["onControl"]>[0]);
        this.snapshotReady = true;
        this.pendingPty.splice(0).forEach(({ agentId, bytes }) => handlers.onPty(agentId, bytes));
      })
      .catch((error) => {
        this.snapshotReady = true;
        this.pendingPty.splice(0).forEach(({ agentId, bytes }) => handlers.onPty(agentId, bytes));
        console.error(error);
      });
  }

  whenOpen(): Promise<void> {
    return Promise.resolve();
  }
  isClosed(): boolean {
    return false;
  }

  /** A rejected invoke never reaches the control channel — without this the
   * click appears to do nothing (the commitless-~/Canvas spawn failure was
   * invisible for exactly this reason). Log for the record, then surface. */
  private reportFailure(op: string, error: unknown) {
    console.error(`[tauri] ${op} failed:`, error);
    const detail =
      typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
    this.handlers.onError?.(detail);
  }

  setAgentChain(workspaceId: string, chain: string[]) {
    void invoke("set_agent_chain", { workspaceId, chain }).catch((e) =>
      this.reportFailure("set_agent_chain", e),
    );
  }

  spawnAgent(name: string, command: string, cwd = ".", workspaceId?: string, permission?: string, boardId?: string, accountId?: string, initialInput?: string) {
    void invoke("spawn_agent", { name, command, cwd, workspaceId: workspaceId ?? null, permission: permission ?? null, boardId: boardId ?? null, accountId: accountId ?? null, initialInput: initialInput ?? null }).catch(
      (e) => this.reportFailure("spawn_agent", e),
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

  resize(agentId: string, cols: number, rows: number, requestId?: string): Promise<boolean> {
    return invoke("pty_resize", { agentId, cols, rows }).then(() => {
      if (requestId) this.handlers.onControl({ type: "pty_resized", agent_id: agentId, request_id: requestId });
      return true;
    }, (error) => {
      console.error(error);
      return false;
    });
  }

  confirmDestructive(agentId: string, action: "kill" | "forget") {
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

  setPermission(agentId: string, permission: string) {
    void invoke("set_permission", { agentId, permission }).catch(console.error);
  }

  createAutomation(a: {
    name: string;
    prompt: string;
    command: string;
    workspace_id?: string;
    permission?: string;
    idle_secs?: number;
    on_approval?: string;
    interval_secs?: number;
  }) {
    void invoke("create_automation", {
      name: a.name,
      prompt: a.prompt,
      command: a.command,
      workspaceId: a.workspace_id ?? null,
      permission: a.permission ?? null,
      idleSecs: a.idle_secs ?? null,
      onApproval: a.on_approval ?? null,
      intervalSecs: a.interval_secs ?? null,
    }).catch(console.error);
  }

  createLoop(l: {
    board_id: string;
    target: string;
    instruction: string;
    trigger: string;
    interval_secs?: number;
    pattern?: string;
  }) {
    void invoke("create_loop", {
      boardId: l.board_id,
      target: l.target,
      instruction: l.instruction,
      trigger: l.trigger,
      intervalSecs: l.interval_secs ?? null,
      pattern: l.pattern ?? null,
    }).catch(console.error);
  }

  deleteLoop(loopId: string) {
    void invoke("delete_loop", { loopId }).catch(console.error);
  }

  runLoop(loopId: string) {
    void invoke("run_loop", { loopId }).catch(console.error);
  }

  setLoopEnabled(loopId: string, enabled: boolean) {
    void invoke("set_loop_enabled", { loopId, enabled }).catch(console.error);
  }

  pauseAll(boardId?: string) {
    void invoke("pause_all", { boardId: boardId ?? null }).catch(console.error);
  }

  resumeAll(boardId?: string) {
    void invoke("resume_all", { boardId: boardId ?? null }).catch(console.error);
  }

  runAutomation(automationId: string) {
    void invoke("run_automation", { automationId }).catch(console.error);
  }

  deleteAutomation(automationId: string) {
    void invoke("delete_automation", { automationId }).catch(console.error);
  }

  delegate(from: string, name: string, command: string, task: string, cwd = ".", workspaceId?: string, permission?: string, accountId?: string, boardId?: string, initialInput?: string) {
    void invoke("delegate", { from, name, command, task, cwd, workspaceId: workspaceId ?? null, permission: permission ?? null, accountId: accountId ?? null, boardId: boardId ?? null, initialInput: initialInput ?? null }).catch(
      (e) => this.reportFailure("delegate", e),
    );
  }

  studioDoc() {
    void invoke("studio_doc", {}).catch(console.error);
  }

  vaultList(dir: string) {
    void invoke("vault_list", { dir }).catch(console.error);
  }

  repoTree(dir: string) {
    void invoke("repo_tree", { dir }).catch(console.error);
  }

  repoRead(dir: string, path: string) {
    void invoke("repo_read", { dir, path }).catch(console.error);
  }

  repoWrite(dir: string, path: string, text: string, baseText: string) {
    void invoke("repo_write", { dir, path, text, baseText }).catch(console.error);
  }

  vaultRead(dir: string, path: string) {
    void invoke("vault_read", { dir, path }).catch(console.error);
  }

  vaultPeek(dir: string, path: string) {
    void invoke("vault_peek", { dir, path }).catch(console.error);
  }

  vaultAsset(dir: string, path: string) {
    void invoke("vault_asset", { dir, path }).catch(console.error);
  }

  vaultAppend(dir: string, path: string, text: string) {
    void invoke("vault_append", { dir, path, text }).catch(console.error);
  }

  vaultWrite(dir: string, path: string, text: string) {
    void invoke("vault_write", { dir, path, text }).catch(console.error);
  }

  vaultWriteAsset(dir: string, path: string, data: string) {
    void invoke("vault_write_asset", { dir, path, data }).catch(console.error);
  }

  vaultDelete(dir: string, path: string) {
    void invoke("vault_delete", { dir, path }).catch(console.error);
  }
  vaultRename(dir: string, path: string, newPath: string) {
    void invoke("vault_rename", { dir, path, newPath }).catch(console.error);
  }
  vaultGraph(dir: string) {
    void invoke("vault_graph", { dir }).catch(console.error);
  }
  vaultDiscover() {
    void invoke("vault_discover").catch(console.error);
  }
  vaultRegister(dir: string) {
    void invoke("vault_register", { dir }).catch(console.error);
  }
  openObsidian(vaultDir: string, path: string): Promise<void> {
    return invoke("open_obsidian", { vaultDir, path });
  }
  async defaultVaultDir(): Promise<string | null> {
    try {
      return await invoke<string | null>("default_vault_dir");
    } catch {
      return null;
    }
  }

  vaultSearch(dir: string, query: string) {
    void invoke("vault_search", { dir, query }).catch(console.error);
  }

  gitPush(agentId: string) {
    void invoke("git_push", { agentId }).catch(console.error);
  }

  artifactCreate(boardId: string | undefined, kind: string, title: string, path?: string, text?: string) {
    void invoke("artifact_create", { boardId, kind, title, path, text }).catch(console.error);
  }

  artifactDelete(artifactId: string) {
    void invoke("artifact_delete", { artifactId }).catch(console.error);
  }

  noteUpsert(noteId: string | null, boardId: string | undefined, col: string, text: string, pos?: number, due?: string) {
    void invoke("note_upsert", { noteId, boardId, col, text, pos, due }).catch(console.error);
  }

  noteDelete(noteId: string) {
    void invoke("note_delete", { noteId }).catch(console.error);
  }

  digest() {
    void invoke("session_digest").catch(console.error);
  }

  memoryRead(nodeId: string) {
    void invoke("memory_read", { nodeId })
      .then((text) =>
        this.handlers.onControl({ type: "memory", node_id: nodeId, text: text as string } as Parameters<Handlers["onControl"]>[0]),
      )
      .catch(console.error);
  }

  memoryWrite(nodeId: string, text: string) {
    void invoke("memory_write", { nodeId, text }).catch(console.error);
  }

  createAccount(cli: string, label: string, env?: string) {
    void invoke("create_account", { cli, label, env: env || null }).catch(console.error);
  }

  deleteAccount(accountId: string) {
    void invoke("delete_account", { accountId }).catch(console.error);
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

  deleteWorkspace(workspaceId: string) {
    return invoke("delete_workspace", { workspaceId }) as Promise<unknown>;
  }

  deleteBoard(boardId: string) {
    invoke("delete_board", { boardId }).catch(console.error);
  }

  deleteDelegation(edgeId: string) {
    invoke("delete_delegation", { edgeId }).catch(console.error);
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

export type ChromeBookmark = { name: string; url: string; folder: string | null };

/** Local Chrome bookmark bar — desktop shell only; [] when unavailable. */
export const chromeBookmarks = (): Promise<ChromeBookmark[]> =>
  invoke<ChromeBookmark[]>("chrome_bookmarks").catch(() => []);
