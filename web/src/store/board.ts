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
  /** Worktree branch (`canvas/<name>-<id>`) — the node's branch badge. */
  branch?: string;
  status: AgentStatus | "exited";
  workspace_id?: string | null;
};

export type LiveWorkspace = {
  id: string;
  name: string;
  repo: string;
};

export type LiveEdge = {
  id: string;
  from: string;
  to: string;
  task: string;
  result?: string;
  files?: number;
  state: "delegated" | "returned" | "failed";
};

import type { AutomationDef } from "../daemon/client";

type DaemonTransport = CanvasClient | TauriCanvasClient;

type BoardState = {
  connected: boolean;
  agents: Record<string, LiveAgent>;
  edges: Record<string, LiveEdge>;
  workspaces: Record<string, LiveWorkspace>;
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
  connect: (token: string) => void;
  spawn: (name: string, command: string, workspaceId?: string, permission?: string) => void;
  createWorkspace: (name: string, repo: string) => void;
  delegate: (from: string, name: string, command: string, task: string, permission?: string, position?: { x: number; y: number }) => void;
  kill: (agentId: string) => void;
  approveInput: (agentId: string) => void;
  denyInput: (agentId: string) => void;
  moveNode: (agentId: string, x: number, y: number) => void;
  attachPty: (agentId: string, cb: (bytes: Uint8Array) => void) => void;
  detachPty: (agentId: string) => void;
  sendInput: (agentId: string, bytes: Uint8Array) => void;
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
  edges: {},
  workspaces: {},
  positions: {},
  pendingPositions: {},
  approvals: {},
  termFont: 13,
  moveHistory: [],
  viewCmdN: 0,
  automations: {},
  attention: {},
  ptyListeners: {},

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
                },
              },
            });
            break;
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
                },
              ]),
            );
            const workspaces = Object.fromEntries(
              (msg.workspaces ?? []).map((w) => [
                w.workspace_id,
                { id: w.workspace_id, name: w.name, repo: w.repo },
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
                },
              ]),
            );
            const automations = Object.fromEntries(
              (msg.automations ?? []).map((a) => [a.id, a]),
            );
            set({
              agents,
              positions,
              edges,
              workspaces,
              approvals: msg.approvals ?? {},
              automations,
            });
            break;
          }
          case "error":
            console.error("[canvasd]", msg.message);
            break;
          default:
            break;
        }
      },
      onPty: (agentId: string, bytes: Uint8Array) => {
        get().ptyListeners[agentId]?.(bytes);
      },
      onClose: () => {
        client = null;
        set({ connected: false });
      },
    };
    // Inside Tauri there is no socket and no token — the app itself is the peer.
    client = isTauri() ? new TauriCanvasClient(handlers) : new CanvasClient(t, handlers);
    void client.whenOpen().then(() => set({ connected: true }));
  },

  spawn: (name, command, workspaceId, permission) =>
    client?.spawnAgent(name, command, ".", workspaceId, permission),

  createWorkspace: (name, repo) => client?.createWorkspace(name, repo),

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

  attachPty: (agentId, cb) =>
    set((s) => ({ ptyListeners: { ...s.ptyListeners, [agentId]: cb } })),

  detachPty: (agentId) =>
    set((s) => {
      const { [agentId]: _drop, ...rest } = s.ptyListeners;
      return { ptyListeners: rest };
    }),

  sendInput: (agentId, bytes) => client?.ptyInput(agentId, bytes),
}));
