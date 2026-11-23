import { create } from "zustand";
import { CanvasClient, type ServerMsg } from "../daemon/client";
import { isTauri, TauriCanvasClient } from "../daemon/tauriClient";
import type { AgentStatus } from "../board/types";

export type LiveAgent = {
  id: string;
  name: string;
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
  state: "delegated" | "returned" | "failed";
};

type DaemonTransport = CanvasClient | TauriCanvasClient;

type BoardState = {
  connected: boolean;
  agents: Record<string, LiveAgent>;
  edges: Record<string, LiveEdge>;
  workspaces: Record<string, LiveWorkspace>;
  /** Saved node positions — replayed from the daemon's layout table. */
  positions: Record<string, { x: number; y: number }>;
  ptyListeners: Record<string, (bytes: Uint8Array) => void>;
  connect: (token: string) => void;
  spawn: (name: string, command: string, workspaceId?: string) => void;
  createWorkspace: (name: string, repo: string) => void;
  delegate: (from: string, name: string, command: string, task: string) => void;
  kill: (agentId: string) => void;
  moveNode: (agentId: string, x: number, y: number) => void;
  attachPty: (agentId: string, cb: (bytes: Uint8Array) => void) => void;
  detachPty: (agentId: string) => void;
  sendInput: (agentId: string, bytes: Uint8Array) => void;
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
          case "delegation":
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
          case "result": {
            const edge = edges[msg.edge_id];
            if (edge) {
              set({
                edges: {
                  ...edges,
                  [msg.edge_id]: { ...edge, result: msg.summary, state: "returned" },
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
                  state: d.state as LiveEdge["state"],
                },
              ]),
            );
            set({ agents, positions, edges, workspaces });
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
      onClose: () => set({ connected: false }),
    };
    // Inside Tauri there is no socket and no token — the app itself is the peer.
    client = isTauri() ? new TauriCanvasClient(handlers) : new CanvasClient(t, handlers);
    void client.whenOpen().then(() => set({ connected: true }));
  },

  spawn: (name, command, workspaceId) =>
    client?.spawnAgent(name, command, ".", workspaceId),

  createWorkspace: (name, repo) => client?.createWorkspace(name, repo),

  delegate: (from, name, command, task) =>
    client?.delegate(from, name, command, task),

  kill: (agentId) => client?.confirmDestructive(agentId, "kill"),

  moveNode: (agentId, x, y) => {
    set((s) => ({ positions: { ...s.positions, [agentId]: { x, y } } }));
    client?.moveNode(agentId, x, y);
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
