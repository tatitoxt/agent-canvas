import { create } from "zustand";
import { CanvasClient, type ServerMsg } from "../daemon/client";
import { isTauri, TauriCanvasClient } from "../daemon/tauriClient";
import type { AgentStatus } from "../board/types";

export type LiveAgent = {
  id: string;
  name: string;
  command?: string;
  permission?: string;
  lastLine?: string;
  files?: number;
  /** Uncommitted file paths in the worktree (tooltip/detail list). */
  paths?: string[];
  /** Worktree branch (`canvas/<name>-<id>`) — the node's branch badge. */
  branch?: string;
  status: AgentStatus | "exited";
  workspace_id?: string | null;
  /** Canvas board this agent lives on (Deska "Spaces"). */
  board_id?: string | null;
  /** Label of the named CLI account this agent signs in as, if any. */
  account_label?: string | null;
  output_bytes?: number;
};

export type LiveWorkspace = {
  id: string;
  name: string;
  repo: string;
  board_id?: string | null;
};

export type LiveEdge = {
  id: string;
  from: string;
  to: string;
  task: string;
  result?: string;
  files?: number;
  state: "delegated" | "returned" | "failed";
  created_at?: string | null;
  resolved_at?: string | null;
};

import type { AutomationDef } from "../daemon/client";

type DaemonTransport = CanvasClient | TauriCanvasClient;

type BoardState = {
  connected: boolean;
  agents: Record<string, LiveAgent>;
  /** Board id → name (multiple canvases); "main" always exists. */
  boards: Record<string, string>;
  activeBoard: string;
  edges: Record<string, LiveEdge>;
  workspaces: Record<string, LiveWorkspace>;
  /** Registered named CLI accounts (id → account). */
  accounts: Record<string, { account_id: string; cli: string; label: string }>;
  /** node_id ("main" or a workspace id) → memory.md text. */
  memories: Record<string, string>;
  /** Last "lose nothing" digest markdown, when requested. */
  digest: string | null;
  /** Transient toast — latest info/error line shown bottom-right. */
  notice: string | null;
  /** Obsidian-style vault browser state. */
  vaultDir: string;
  vaultEntries: string[];
  vaultFile: { path: string; text: string } | null;
  /** Embedded web pages on the canvas: node id -> url, per board. */
  webNodes: Record<string, Record<string, string>>;
  /** Artifacts by id — deliverables agents produced. */
  artifacts: Record<string, import("../daemon/client").SnapshotArtifact>;
  /** Kanban notes by id (all boards; filtered by activeBoard in UI). */
  notes: Record<string, { note_id: string; board_id: string; col: string; text: string; pos: number; due?: string }>;
  /** Saved node positions — replayed from the daemon's layout table. */
  positions: Record<string, { x: number; y: number }>;
  /** Drop position for a delegation child, keyed by parent agent id —
   * applied when the delegation message names the child. */
  pendingPositions: Record<string, { x: number; y: number }>;
  /** agent_id → held command line awaiting operator approval (supervised). */
  approvals: Record<string, string>;
  /** Terminal font size — adjustable via the local quick-request router. */
  termFont: number;
  /** Positions displaced by the last manual moves — for local "undo". */
  moveHistory: Array<{ id: string; prev?: { x: number; y: number } }>;
  /** Bump counter telling the canvas to run fitView (local "fit" request). */
  viewCmdN: number;
  /** Saved automations (Deska-style guardrailed task runs). */
  automations: Record<string, AutomationDef>;
  /** agent_id → latest automation guardrail alert (hang / denied policy). */
  attention: Record<string, string>;
  ptyListeners: Record<string, (bytes: Uint8Array) => void>;
  /** Rolling PTY scrollback per agent (~64KB) — transcript shown when a
   * terminal opens, and rebuilt from the daemon's replay on reconnect. */
  ptyBuffers: Record<string, Uint8Array>;
  connect: (token: string) => void;
  setActiveBoard: (boardId: string) => void;
  createBoard: (name: string) => void;
  moveToBoard: (nodeId: string, boardId: string) => void;
  renameNode: (nodeId: string, name: string) => void;
  renameBoard: (boardId: string, name: string) => void;
  deleteBoard: (boardId: string) => void;
  deleteWorkspace: (workspaceId: string) => void;
  /** agent_id → latest fetched unified diff text. */
  diffTexts: Record<string, string>;
  requestDiff: (agentId: string) => void;
  spawn: (name: string, command: string, workspaceId?: string, permission?: string, accountId?: string) => void;
  createAccount: (cli: string, label: string) => void;
  deleteAccount: (accountId: string) => void;
  memoryRead: (nodeId: string) => void;
  memoryWrite: (nodeId: string, text: string) => void;
  digestNow: () => void;
  closeDigest: () => void;
  noteUpsert: (noteId: string | null, col: string, text: string, pos?: number, due?: string) => void;
  noteDelete: (noteId: string) => void;
  artifactCreate: (kind: string, title: string, path?: string, text?: string) => void;
  gitPush: (agentId: string) => void;
  notify: (text: string) => void;
  vaultList: (dir: string) => void;
  vaultRead: (path: string) => void;
  closeVaultFile: () => void;
  webNodeAdd: (url: string) => void;
  webNodeRemove: (id: string) => void;
  artifactDelete: (artifactId: string) => void;
  createWorkspace: (name: string, repo: string) => void;
  delegate: (from: string, name: string, command: string, task: string, permission?: string, position?: { x: number; y: number }) => void;
  kill: (agentId: string) => void;
  approveInput: (agentId: string) => void;
  denyInput: (agentId: string) => void;
  /** Dismiss one automation alert row (or every alert with id "*"). */
  dismissAlert: (agentId: string) => void;
  /** Clear returned delegation rows from the inbox. */
  clearReturned: () => void;
  moveNode: (agentId: string, x: number, y: number) => void;
  attachPty: (agentId: string, cb: (bytes: Uint8Array) => void) => void;
  ptyBuffer: (agentId: string) => Uint8Array | undefined;
  detachPty: (agentId: string) => void;
  sendInput: (agentId: string, bytes: Uint8Array) => void;
  /** Ask the daemon to replay an exited agent's saved transcript. */
  requestTranscript: (agentId: string) => void;
  bumpFont: (delta: number) => void;
  undoMove: () => boolean;
  requestView: () => void;
  clearDone: () => number;
  /** Local short-request router (Deska-style): runs instant commands
   * client-side — no agent spawn, no token spend. Returns feedback text. */
  quickRequest: (text: string) => string;
  createAutomation: (a: {
    name: string;
    prompt: string;
    command: string;
    workspace_id?: string;
    permission?: string;
    idle_secs?: number;
    on_approval?: string;
    interval_secs?: number;
  }) => void;
  runAutomation: (automationId: string) => void;
  deleteAutomation: (automationId: string) => void;
};

let client: DaemonTransport | null = null;

const TOKEN = (import.meta.env.VITE_CANVAS_TOKEN as string | undefined) ??
  new URLSearchParams(location.search).get("token") ??
  "";

export const useBoard = create<BoardState>((set, get) => ({
  connected: false,
  agents: {},
  boards: { main: "Main" },
  activeBoard: "main",
  edges: {},
  workspaces: {},
  accounts: {},
  memories: {},
  digest: null,
  notice: null,
  vaultDir: "",
  vaultEntries: [],
  vaultFile: null,
  webNodes: (() => {
    try { return JSON.parse(localStorage.getItem("cv-webnodes") ?? "{}"); } catch { return {}; }
  })(),
  notes: {},
  artifacts: {},
  positions: {},
  pendingPositions: {},
  approvals: {},
  termFont: 13,
  moveHistory: [],
  viewCmdN: 0,
  automations: {},
  attention: {},
  ptyListeners: {},
  ptyBuffers: {},

  connect: (token: string) => {
    const t = token || TOKEN;
    if (client || (!t && !isTauri())) return;
    const handlers = {
      onControl: (msg: ServerMsg) => {
        const { agents, edges } = get();
        switch (msg.type) {
          case "spawned":
            set({
              agents: {
                ...agents,
                [msg.agent_id]: {
                  id: msg.agent_id,
                  name: msg.name,
                  command: msg.command,
                  permission: msg.permission ?? "supervised",
                  status: "working",
                  workspace_id: msg.workspace_id ?? null,
                  board_id: msg.board_id ?? "main",
                },
              },
            });
            break;
          case "workspace_created":
            set({
              workspaces: {
                ...get().workspaces,
                [msg.workspace_id]: {
                  id: msg.workspace_id,
                  name: msg.name,
                  repo: msg.repo,
                  board_id: msg.board_id ?? "main",
                },
              },
            });
            break;
          case "workspace_deleted": {
            const { [msg.workspace_id]: _gone, ...rest } = get().workspaces;
            // Agents of the dead workspace are detached but stay on the board.
            const agents = { ...get().agents };
            for (const a of Object.values(agents)) {
              if (a.workspace_id === msg.workspace_id) {
                agents[a.id] = { ...a, workspace_id: null };
              }
            }
            set({ workspaces: rest, agents });
            break;
          }
          case "board_created":
            set({
              boards: { ...get().boards, [msg.board_id]: msg.name },
            });
            break;
          case "board_moved": {
            const a = get().agents[msg.node_id];
            const w = get().workspaces[msg.node_id];
            if (a) {
              set({
                agents: {
                  ...get().agents,
                  [msg.node_id]: { ...a, board_id: msg.board_id },
                },
              });
            } else if (w) {
              set({
                workspaces: {
                  ...get().workspaces,
                  [msg.node_id]: { ...w, board_id: msg.board_id },
                },
              });
            }
            break;
          }
          case "status":
            if (agents[msg.agent_id]) {
              set({
                agents: {
                  ...agents,
                  [msg.agent_id]: {
                    ...agents[msg.agent_id],
                    status: msg.status as LiveAgent["status"],
                  },
                },
              });
            }
            break;
          case "activity":
            if (agents[msg.agent_id]) {
              const attention = { ...get().attention };
              delete attention[msg.agent_id];
              set({
                agents: {
                  ...agents,
                  [msg.agent_id]: { ...agents[msg.agent_id], lastLine: msg.line },
                },
                attention,
              });
            }
            break;
          case "needs_attention":
            set({
              attention: { ...get().attention, [msg.agent_id]: msg.reason },
            });
            break;
          case "automation_saved":
            set({
              automations: {
                ...get().automations,
                [msg.automation.id]: msg.automation,
              },
            });
            break;
          case "automation_deleted": {
            const next = { ...get().automations };
            delete next[msg.automation_id];
            set({ automations: next });
            break;
          }
          case "diff":
            if (agents[msg.agent_id]) {
              set({
                agents: {
                  ...agents,
                  [msg.agent_id]: {
                    ...agents[msg.agent_id],
                    files: msg.files,
                    paths: msg.paths ?? agents[msg.agent_id].paths,
                    branch: msg.branch ?? agents[msg.agent_id].branch,
                  },
                },
              });
            }
            break;
          case "needs_approval":
            set({ approvals: { ...get().approvals, [msg.agent_id]: msg.line } });
            break;
          case "delegation": {
            const pending = get().pendingPositions[msg.from];
            if (pending) {
              const next = { ...get().pendingPositions };
              delete next[msg.from];
              set({ pendingPositions: next });
              get().moveNode(msg.to, pending.x, pending.y);
            }
            set({
              edges: {
                ...edges,
                [msg.edge_id]: {
                  id: msg.edge_id,
                  from: msg.from,
                  to: msg.to,
                  task: msg.task,
                  state: "delegated",
                },
              },
            });
            break;
          }
          case "result": {
            const edge = edges[msg.edge_id];
            if (edge) {
              set({
                edges: {
                  ...edges,
                  [msg.edge_id]: {
                    ...edge,
                    result: msg.summary,
                    files: msg.files,
                    state: "returned",
                  },
                },
              });
            }
            break;
          }
          case "snapshot": {
            const agents = Object.fromEntries(
              msg.agents.map((a) => [
                a.agent_id,
                {
                  id: a.agent_id,
                  name: a.name,
                  command: a.command,
                  permission: a.permission ?? "supervised",
                  status: a.status as LiveAgent["status"],
                  workspace_id: a.workspace_id ?? null,
                  board_id: a.board_id ?? "main",
                  account_label: a.account_label ?? null,
              output_bytes: a.output_bytes,
                },
              ]),
            );
            const accounts = Object.fromEntries(
              (msg.accounts ?? []).map((a) => [a.account_id, a]),
            );
            const artifacts = Object.fromEntries(
              (msg.artifacts ?? []).map((a) => [a.artifact_id, a]),
            );
            const notes = Object.fromEntries(
              (msg.notes ?? []).map((n) => [n.note_id, n]),
            );
            const workspaces = Object.fromEntries(
              (msg.workspaces ?? []).map((w) => [
                w.workspace_id,
                { id: w.workspace_id, name: w.name, repo: w.repo, board_id: w.board_id ?? "main" },
              ]),
            );
            const positions = Object.fromEntries(
              Object.entries(msg.layout).map(([id, [x, y]]) => [id, { x, y }]),
            );
            const edges = Object.fromEntries(
              (msg.delegations ?? []).map((d) => [
                d.edge_id,
                {
                  id: d.edge_id,
                  from: d.from,
                  to: d.to,
                  task: d.task,
                  result: d.result ?? undefined,
                  files: d.files,
                  state: d.state as LiveEdge["state"],
                  created_at: d.created_at,
                  resolved_at: d.resolved_at,
                },
              ]),
            );
            const automations = Object.fromEntries(
              (msg.automations ?? []).map((a) => [a.id, a]),
            );
            const boards = Object.fromEntries(
              (msg.boards ?? []).map((b) => [b.board_id, b.name]),
            );
            set({
              agents,
              positions,
              edges,
              workspaces,
              approvals: msg.approvals ?? {},
              automations,
              boards: { main: "Main", ...boards },
              accounts,
              notes,
              artifacts,
            });
            break;
          }
          case "vault_listing":
            set({ vaultEntries: msg.entries });
            break;
          case "vault_file":
            set({ vaultFile: { path: msg.path, text: msg.text } });
            break;
          case "git_pushed": {
            set({ notice: `pushed — ${msg.output || "done"}` });
            break;
          }
          case "artifact_created": {
            set((st) => ({ artifacts: { ...st.artifacts, [msg.artifact.artifact_id]: msg.artifact } }));
            break;
          }
          case "artifact_deleted": {
            const artifacts = { ...get().artifacts };
            delete artifacts[msg.artifact_id];
            set({ artifacts });
            break;
          }
          case "note_upserted": {
            set((st) => ({ notes: { ...st.notes, [msg.note.note_id]: msg.note } }));
            break;
          }
          case "note_deleted": {
            const notes = { ...get().notes };
            delete notes[msg.note_id];
            set({ notes });
            break;
          }
          case "session_digest":
            set({ digest: msg.text });
            break;
          case "memory": {
            set((st) => ({ memories: { ...st.memories, [msg.node_id]: msg.text } }));
            break;
          }
          case "account_created": {
            set((s) => ({
              accounts: { ...s.accounts, [msg.account_id]: { account_id: msg.account_id, cli: msg.cli, label: msg.label } },
            }));
            break;
          }
          case "account_deleted": {
            set((s) => {
              const accounts = { ...s.accounts };
              delete accounts[msg.account_id];
              return { accounts };
            });
            break;
          }
          case "error":
            set({ notice: `error — ${msg.message}` });
            console.error("[canvasd]", msg.message);
            break;
          default:
            break;
        }
      },
      onPty: (agentId: string, bytes: Uint8Array) => {
        const prev = get().ptyBuffers[agentId];
        const merged = new Uint8Array((prev?.length ?? 0) + bytes.length);
        if (prev) merged.set(prev, 0);
        merged.set(bytes, prev?.length ?? 0);
        const capped =
          merged.length > 65_536 ? merged.subarray(merged.length - 65_536) : merged;
        set({ ptyBuffers: { ...get().ptyBuffers, [agentId]: capped } });
        get().ptyListeners[agentId]?.(bytes);
      },
      onClose: () => {
        client = null;
        set({ connected: false });
        // Auto-reconnect: a daemon restart or a page sleep shouldn't
        // strand the board in offline mode until a manual click.
        setTimeout(() => {
          if (!client && !isTauri()) get().connect(t);
        }, 2_500);
      },
    };
    // Inside Tauri there is no socket and no token — the app itself is the peer.
    client = isTauri() ? new TauriCanvasClient(handlers) : new CanvasClient(t, handlers);
    void client.whenOpen().then(() => set({ connected: true }));
  },

  setActiveBoard: (boardId) => set({ activeBoard: boardId }),

  createBoard: (name) => client?.createBoard(name),

  moveToBoard: (nodeId, boardId) => client?.moveToBoard(nodeId, boardId),

  renameNode: (nodeId, name) => client?.renameNode(nodeId, name),
  renameBoard: (boardId, name) => client?.renameBoard(boardId, name),
  deleteBoard: (boardId) => client?.deleteBoard(boardId),
  deleteWorkspace: (workspaceId) => client?.deleteWorkspace(workspaceId),
  diffTexts: {},
  requestDiff: (agentId) => client?.diffDetail(agentId),

  spawn: (name, command, workspaceId, permission, accountId) =>
    client?.spawnAgent(name, command, ".", workspaceId, permission, get().activeBoard, accountId),

  createAccount: (cli, label) => client?.createAccount(cli, label),
  deleteAccount: (accountId) => client?.deleteAccount(accountId),
  memoryRead: (nodeId) => client?.memoryRead(nodeId),
  digestNow: () => client?.digest(),
  closeDigest: () => set({ digest: null }),
  noteUpsert: (noteId, col, text, pos, due) =>
    client?.noteUpsert(noteId, get().activeBoard ?? undefined, col, text, pos, due),
  noteDelete: (noteId) => client?.noteDelete(noteId),
  gitPush: (agentId) => client?.gitPush(agentId),
  notify: (text) => set({ notice: text }),
  vaultList: (dir) => {
    set({ vaultDir: dir });
    client?.vaultList(dir);
  },
  vaultRead: (path) => client?.vaultRead(get().vaultDir, path),
  closeVaultFile: () => set({ vaultFile: null }),
  webNodeAdd: (url) => {
    const board = get().activeBoard;
    const id = `web-${Math.random().toString(16).slice(2, 10)}`;
    set((st) => ({
      webNodes: { ...st.webNodes, [board]: { ...(st.webNodes[board] ?? {}), [id]: url } },
    }));
    const next = get().webNodes;
    localStorage.setItem("cv-webnodes", JSON.stringify(next));
    client?.moveNode(id, 200 + Math.random() * 300, 120 + Math.random() * 200);
  },
  webNodeRemove: (id) => {
    const board = get().activeBoard;
    set((st) => {
      const m = { ...(st.webNodes[board] ?? {}) };
      delete m[id];
      return { webNodes: { ...st.webNodes, [board]: m } };
    });
    localStorage.setItem("cv-webnodes", JSON.stringify(get().webNodes));
  },
  artifactCreate: (kind, title, path, text) =>
    client?.artifactCreate(get().activeBoard ?? undefined, kind, title, path, text),
  artifactDelete: (artifactId) => client?.artifactDelete(artifactId),
  memoryWrite: (nodeId, text) => {
    client?.memoryWrite(nodeId, text);
    set((st) => ({ memories: { ...st.memories, [nodeId]: text } }));
  },

  createWorkspace: (name, repo) => client?.createWorkspace(name, repo, get().activeBoard),

  delegate: (from, name, command, task, permission, position) => {
    if (position) {
      set((s) => ({ pendingPositions: { ...s.pendingPositions, [from]: position } }));
    }
    client?.delegate(from, name, command, task, ".", undefined, permission);
  },

  kill: (agentId) => client?.confirmDestructive(agentId, "kill"),

  approveInput: (agentId) => {
    client?.approveInput(agentId);
    const next = { ...get().approvals };
    delete next[agentId];
    set({ approvals: next });
  },

  denyInput: (agentId) => {
    client?.denyInput(agentId);
    const next = { ...get().approvals };
    delete next[agentId];
    set({ approvals: next });
  },

  dismissAlert: (agentId) => {
    const next = { ...get().attention };
    if (agentId === "*") {
      set({ attention: {} });
    } else {
      delete next[agentId];
      set({ attention: next });
    }
  },

  clearReturned: () => {
    const edges = Object.fromEntries(
      Object.entries(get().edges).filter(([, e]) => e.state !== "returned"),
    );
    set({ edges });
  },

  moveNode: (agentId, x, y) => {
    set((s) => ({
      positions: { ...s.positions, [agentId]: { x, y } },
      moveHistory: [...s.moveHistory.slice(-49), { id: agentId, prev: s.positions[agentId] }],
    }));
    client?.moveNode(agentId, x, y);
  },

  bumpFont: (delta) =>
    set((s) => ({ termFont: Math.min(22, Math.max(9, s.termFont + delta)) })),

  undoMove: () => {
    const { moveHistory, positions } = get();
    const last = moveHistory[moveHistory.length - 1];
    if (!last) return false;
    const next = { ...positions };
    if (last.prev) next[last.id] = last.prev;
    else delete next[last.id];
    if (last.prev) client?.moveNode(last.id, last.prev.x, last.prev.y);
    set({ positions: next, moveHistory: moveHistory.slice(0, -1) });
    return true;
  },

  requestView: () => set((s) => ({ viewCmdN: s.viewCmdN + 1 })),

  clearDone: () => {
    const { agents } = get();
    const next = { ...agents };
    let n = 0;
    for (const [id, a] of Object.entries(agents))
      if (a.status === "exited") {
        delete next[id];
        n++;
      }
    if (n) set({ agents: next });
    return n;
  },

  createAutomation: (a) => client?.createAutomation(a),
  runAutomation: (automationId) => client?.runAutomation(automationId),
  deleteAutomation: (automationId) => client?.deleteAutomation(automationId),

  quickRequest: (text) => {
    const t = text.trim().toLowerCase();
    const { bumpFont, undoMove, requestView, clearDone } = get();
    if (/bigger|larger|increase|mas grande/.test(t)) {
      bumpFont(1);
      return `terminal font ${get().termFont}px`;
    }
    if (/smaller|shrink|decrease|mas chica/.test(t)) {
      bumpFont(-1);
      return `terminal font ${get().termFont}px`;
    }
    if (/undo|deshacer/.test(t)) return undoMove() ? "undid last move" : "nothing to undo";
    if (/fit|reset view|zoom|overview/.test(t)) {
      requestView();
      return "fitted view";
    }
    if (/clear|clean|tidy/.test(t)) {
      const n = clearDone();
      return n ? `cleared ${n} finished agent${n === 1 ? "" : "s"}` : "nothing to clear";
    }
    return "try: bigger text · smaller text · undo · fit · clear done";
  },

  ptyBuffer: (agentId) => get().ptyBuffers[agentId],

  attachPty: (agentId, cb) =>
    set((s) => ({ ptyListeners: { ...s.ptyListeners, [agentId]: cb } })),

  detachPty: (agentId) =>
    set((s) => {
      const { [agentId]: _drop, ...rest } = s.ptyListeners;
      return { ptyListeners: rest };
    }),

  sendInput: (agentId, bytes) => client?.ptyInput(agentId, bytes),

  requestTranscript: (agentId) => client?.transcript(agentId),
}));
