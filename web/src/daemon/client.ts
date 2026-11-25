// Typed WebSocket client for canvasd.
// Control frames: JSON text. PTY frames: binary [id_len][id][payload].

export type SnapshotAgent = {
  agent_id: string;
  name: string;
  command: string;
  worktree: string;
  status: string;
  permission?: string;
  workspace_id?: string | null;
  board_id?: string | null;
    fallback_from?: string | null;
  account_label?: string | null;
  /** PTY output bytes captured to disk. */
  output_bytes?: number;
  /** Diff state replayed so fresh clients aren't stuck on "clean". */
  files?: number;
  paths?: string[];
  branch?: string;
};

export type SnapshotArtifact = {
  artifact_id: string;
  board_id: string;
  agent_id?: string | null;
  agent_name?: string | null;
  kind: string;
  title: string;
  path?: string | null;
  text?: string | null;
  created_at: string;
};

export type SnapshotNote = {
  note_id: string;
  board_id: string;
  col: string;
  text: string;
  pos: number;
};

export type SnapshotAccount = {
  account_id: string;
  cli: string;
  label: string;
  /** Optional env var that points the CLI at the account's config dir
   * (overrides the built-in key — for CLIs `account_env_key` doesn't know). */
  env?: string | null;
};

export type ServerMsg =
  | { type: "spawned"; agent_id: string; name: string; command?: string; permission?: string; workspace_id?: string | null; board_id?: string | null; fallback_from?: string | null; worktree?: string | null }
  | { type: "workspace_created"; workspace_id: string; name: string; repo: string; board_id?: string | null }
  | { type: "board_created"; board_id: string; name: string }
  | { type: "board_moved"; node_id: string; board_id: string }
  | { type: "node_renamed"; node_id: string; name: string }
  | { type: "permission_changed"; agent_id: string; permission: string }
  | { type: "board_renamed"; board_id: string; name: string }
  | { type: "board_deleted"; board_id: string }
  | { type: "delegation_removed"; edge_id: string }
  | { type: "workspace_deleted"; workspace_id: string }
  | { type: "diff_detail"; agent_id: string; diff: string }
  | { type: "status"; agent_id: string; status: string }
  | { type: "activity"; agent_id: string; line: string }
  | { type: "diff"; agent_id: string; files: number; paths?: string[]; branch?: string }
  | { type: "error"; agent_id: string | null; message: string }
  | { type: "needs_approval"; agent_id: string; line: string }
  | { type: "needs_attention"; agent_id: string; reason: string }
  | { type: "automation_saved"; automation: AutomationDef }
  | { type: "automation_deleted"; automation_id: string }
  | { type: "loop_saved"; l: LoopDef }
  | { type: "loop_deleted"; loop_id: string }
  | { type: "account_created"; account_id: string; cli: string; label: string; env?: string | null }
  | { type: "account_deleted"; account_id: string }
  | { type: "memory"; node_id: string; text: string }
  | { type: "session_digest"; text: string }
  | { type: "note_upserted"; note: SnapshotNote }
  | { type: "note_deleted"; note_id: string }
  | { type: "artifact_created"; artifact: SnapshotArtifact }
  | { type: "artifact_deleted"; artifact_id: string }
  | { type: "git_pushed"; agent_id: string; output: string }
  | { type: "studio_doc_md"; text: string }
  | { type: "vault_listing"; dir: string; entries: string[] }
  | { type: "repo_listing"; dir: string; entries: string[] }
  | { type: "repo_file"; dir: string; path: string; text: string }
  | { type: "vault_file"; path: string; text: string }
  | { type: "vault_peeked"; path: string; text: string }
  | { type: "vault_asset_data"; path: string; mime: string; data: string }
  | { type: "vault_hits"; dir: string; query: string; hits: { path: string; line: number; text: string }[] }
  | { type: "vault_graph"; dir: string; nodes: string[]; edges: [string, string][] }
  | { type: "vault_discovered"; vaults: { name: string; path: string }[] }
  | { type: "delegation"; edge_id: string; from: string; to: string; task: string }
  | { type: "result"; edge_id: string; summary: string; files?: number }
  | { type: "delegation_failed"; edge_id: string }
  | {
      type: "snapshot";
      boards?: { board_id: string; name: string }[];
      agents: SnapshotAgent[];
      delegations?: SnapshotDelegation[];
      workspaces?: SnapshotWorkspace[];
      layout: Record<string, [number, number]>;
      approvals?: Record<string, string>;
      automations?: AutomationDef[];
      loops?: LoopDef[];
      accounts?: SnapshotAccount[];
    notes?: SnapshotNote[];
    artifacts?: SnapshotArtifact[];
      repo_url?: string | null;
      cli_identities?: Record<string, { account?: string | null; model?: string | null; source?: string | null }>;
    };

export type SnapshotWorkspace = {
  workspace_id: string;
  name: string;
  repo: string;
  board_id?: string | null;
  agent_chain?: string[] | null;
};

export type SnapshotDelegation = {
  edge_id: string;
  from: string;
  to: string;
  task: string;
  result?: string | null;
  files?: number;
  state: string;
  created_at?: string | null;
  resolved_at?: string | null;
};

export type AutomationDef = {
  id: string;
  name: string;
  prompt: string;
  command: string;
  workspace_id?: string | null;
  permission: string;
  idle_secs: number;
  on_approval: string;
  last_run_at?: string | null;
  interval_secs?: number | null;
  next_run_at?: string | null;
};

/** An autopilot loop: an instruction the daemon re-sends to a console on
 * a trigger — interval, agent-went-idle, or PTY output match. */
export type LoopDef = {
  loop_id: string;
  board_id: string;
  /** agent id or "*" (all live agents on the board) */
  target: string;
  instruction: string;
  /** 'interval' | 'idle' | 'match' */
  trigger: string;
  interval_secs?: number | null;
  pattern?: string | null;
  enabled: boolean;
  last_fired_at?: string | null;
};

export type Handlers = {
  onControl: (msg: ServerMsg) => void;
  onPty: (agentId: string, bytes: Uint8Array) => void;
  onClose?: () => void;
};

export class CanvasClient {
  private ws: WebSocket;
  private handlers: Handlers;

  constructor(token: string, handlers: Handlers) {
    this.handlers = handlers;
    // Served by canvasd itself (LAN/phone) → ws on the same host; on the
    // vite dev port the daemon is the default localhost one.
    const daemon =
      new URLSearchParams(location.search).get("daemon") ??
      (location.port === "5174" ? "127.0.0.1:4242" : location.host);
    this.ws = new WebSocket(`ws://${daemon}/ws?token=${token}`);
    this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        this.handlers.onControl(JSON.parse(ev.data) as ServerMsg);
      } else {
        const buf = new Uint8Array(ev.data as ArrayBuffer);
        const len = buf[0];
        const id = new TextDecoder().decode(buf.subarray(1, 1 + len));
        this.handlers.onPty(id, buf.subarray(1 + len));
      }
    };
    this.ws.onclose = () => this.handlers.onClose?.();
  }

  private send(msg: object) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private sendBinary(agentId: string, bytes: Uint8Array) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const id = new TextEncoder().encode(agentId);
    const frame = new Uint8Array(1 + id.length + bytes.length);
    frame[0] = id.length;
    frame.set(id, 1);
    frame.set(bytes, 1 + id.length);
    this.ws.send(frame);
  }

  whenOpen(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((res) => this.ws.addEventListener("open", () => res(), { once: true }));
  }

  /** True once the socket is fully closed — a dead client must not block
   * connect(), or the board would be stuck offline forever. */
  isClosed(): boolean {
    return this.ws.readyState === WebSocket.CLOSED;
  }

  setAgentChain(workspaceId: string, chain: string[]) {
    this.send({ cmd: "set_agent_chain", workspace_id: workspaceId, chain });
  }

  spawnAgent(name: string, command: string, cwd = ".", workspaceId?: string, permission?: string, boardId?: string, accountId?: string, initialInput?: string) {
    this.send({ cmd: "spawn_agent", name, command, cwd, workspace_id: workspaceId ?? null, permission: permission ?? null, board_id: boardId ?? null, account_id: accountId ?? null, initial_input: initialInput ?? null });
  }

  studioDoc() {
    this.send({ cmd: "studio_doc" });
  }

  vaultList(dir: string) {
    this.send({ cmd: "vault_list", dir });
  }

  repoTree(dir: string) {
    this.send({ cmd: "repo_tree", dir });
  }

  repoRead(dir: string, path: string) {
    this.send({ cmd: "repo_read", dir, path });
  }

  repoWrite(dir: string, path: string, text: string, baseText: string) {
    this.send({ cmd: "repo_write", dir, path, text, base_text: baseText });
  }

  vaultRead(dir: string, path: string) {
    this.send({ cmd: "vault_read", dir, path });
  }

  vaultPeek(dir: string, path: string) {
    this.send({ cmd: "vault_peek", dir, path });
  }

  vaultAsset(dir: string, path: string) {
    this.send({ cmd: "vault_asset", dir, path });
  }

  vaultAppend(dir: string, path: string, text: string) {
    this.send({ cmd: "vault_append", dir, path, text });
  }

  vaultWrite(dir: string, path: string, text: string) {
    this.send({ cmd: "vault_write", dir, path, text });
  }

  vaultWriteAsset(dir: string, path: string, data: string) {
    this.send({ cmd: "vault_write_asset", dir, path, data });
  }

  vaultDelete(dir: string, path: string) {
    this.send({ cmd: "vault_delete", dir, path });
  }
  vaultRename(dir: string, path: string, newPath: string) {
    this.send({ cmd: "vault_rename", dir, path, new_path: newPath });
  }
  vaultGraph(dir: string) {
    this.send({ cmd: "vault_graph", dir });
  }
  vaultDiscover() {
    this.send({ cmd: "vault_discover" });
  }
  vaultRegister(dir: string) {
    this.send({ cmd: "vault_register", dir });
  }
  openObsidian(vaultDir: string, path: string) {
    const vault = vaultDir.replace(/\/+$/, "").split("/").pop() ?? "";
    const file = path.replace(/\.md$/, "");
    window.open(`obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`, "_blank", "noopener");
  }
  defaultVaultDir(): Promise<string | null> {
    return Promise.resolve(null);
  }

  vaultSearch(dir: string, query: string) {
    this.send({ cmd: "vault_search", dir, query });
  }

  gitPush(agentId: string) {
    this.send({ cmd: "git_push", agent_id: agentId });
  }

  artifactCreate(boardId: string | undefined, kind: string, title: string, path?: string, text?: string) {
    this.send({ cmd: "artifact_create", board_id: boardId, kind, title, path, text });
  }

  artifactDelete(artifactId: string) {
    this.send({ cmd: "artifact_delete", artifact_id: artifactId });
  }

  noteUpsert(noteId: string | null, boardId: string | undefined, col: string, text: string, pos?: number, due?: string) {
    this.send({ cmd: "note_upsert", note_id: noteId, board_id: boardId, col, text, pos, due });
  }

  noteDelete(noteId: string) {
    this.send({ cmd: "note_delete", note_id: noteId });
  }

  digest() {
    this.send({ cmd: "digest" });
  }

  memoryRead(nodeId: string) {
    this.send({ cmd: "memory_read", node_id: nodeId });
  }

  memoryWrite(nodeId: string, text: string) {
    this.send({ cmd: "memory_write", node_id: nodeId, text });
  }

  createAccount(cli: string, label: string, env?: string) {
    this.send({ cmd: "create_account", cli, label, env: env || null });
  }

  deleteAccount(accountId: string) {
    this.send({ cmd: "delete_account", account_id: accountId });
  }

  createWorkspace(name: string, repo: string, boardId?: string) {
    this.send({ cmd: "create_workspace", name, repo, board_id: boardId ?? null });
  }

  createBoard(name: string) {
    this.send({ cmd: "create_board", name });
  }

  moveToBoard(nodeId: string, boardId: string) {
    this.send({ cmd: "move_to_board", node_id: nodeId, board_id: boardId });
  }

  renameNode(nodeId: string, name: string) {
    this.send({ cmd: "rename_node", node_id: nodeId, name });
  }

  renameBoard(boardId: string, name: string) {
    this.send({ cmd: "rename_board", board_id: boardId, name });
  }

  deleteWorkspace(workspaceId: string) {
    this.send({ cmd: "delete_workspace", workspace_id: workspaceId });
  }

  deleteBoard(boardId: string) {
    this.send({ cmd: "delete_board", board_id: boardId });
  }

  deleteDelegation(edgeId: string) {
    this.send({ cmd: "delete_delegation", edge_id: edgeId });
  }

  diffDetail(agentId: string) {
    this.send({ cmd: "diff_detail", agent_id: agentId });
  }

  /** Raw keystrokes into the agent's PTY. */
  ptyInput(agentId: string, bytes: Uint8Array) {
    this.sendBinary(agentId, bytes);
  }

  resize(agentId: string, cols: number, rows: number) {
    this.send({ cmd: "pty_resize", agent_id: agentId, cols, rows });
  }

  /** The only way to kill: explicit destructive confirmation. */
  confirmDestructive(agentId: string, action: "kill" | "forget") {
    this.send({ cmd: "confirm_destructive", agent_id: agentId, action });
  }

  moveNode(agentId: string, x: number, y: number) {
    this.send({ cmd: "move_node", agent_id: agentId, x, y });
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
    this.send({ cmd: "create_automation", ...a });
  }

  runAutomation(automationId: string) {
    this.send({ cmd: "run_automation", automation_id: automationId });
  }

  deleteAutomation(automationId: string) {
    this.send({ cmd: "delete_automation", automation_id: automationId });
  }

  createLoop(l: {
    board_id: string;
    target: string;
    instruction: string;
    trigger: string;
    interval_secs?: number;
    pattern?: string;
  }) {
    this.send({ cmd: "create_loop", ...l });
  }

  deleteLoop(loopId: string) {
    this.send({ cmd: "delete_loop", loop_id: loopId });
  }

  runLoop(loopId: string) {
    this.send({ cmd: "run_loop", loop_id: loopId });
  }

  setLoopEnabled(loopId: string, enabled: boolean) {
    this.send({ cmd: "set_loop_enabled", loop_id: loopId, enabled });
  }

  pauseAll(boardId?: string) {
    this.send({ cmd: "pause_all", board_id: boardId ?? null });
  }

  resumeAll(boardId?: string) {
    this.send({ cmd: "resume_all", board_id: boardId ?? null });
  }

  /** Supervised-input gate: release the held payload to the PTY. */
  approveInput(agentId: string) {
    this.send({ cmd: "approve_input", agent_id: agentId });
  }

  /** Supervised-input gate: drop the held payload — agent never sees it. */
  denyInput(agentId: string) {
    this.send({ cmd: "deny_input", agent_id: agentId });
  }

  /** "Always allow" — move the agent up the permission ladder in place. */
  setPermission(agentId: string, permission: string) {
    this.send({ cmd: "set_permission", agent_id: agentId, permission });
  }

  delegate(from: string, name: string, command: string, task: string, cwd = ".", workspaceId?: string, permission?: string, accountId?: string, boardId?: string, initialInput?: string) {
    this.send({ cmd: "delegate", from, name, command, task, cwd, workspace_id: workspaceId ?? null, permission: permission ?? null, account_id: accountId ?? null, board_id: boardId ?? null, initial_input: initialInput ?? null });
  }

  /** Ask the daemon to replay an (exited) agent's saved transcript
   * through the normal PTY output channel. */
  transcript(agentId: string) {
    this.send({ cmd: "transcript", agent_id: agentId });
  }
}
