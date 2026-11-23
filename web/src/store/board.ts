import { create } from "zustand";
import { CanvasClient, type ServerMsg } from "../daemon/client";
import type { AgentStatus } from "../board/types";

export type LiveAgent = {
  id: string;
  name: string;
  status: AgentStatus | "exited";
};

type BoardState = {
  connected: boolean;
  agents: Record<string, LiveAgent>;
  ptyListeners: Record<string, (bytes: Uint8Array) => void>;
  connect: (token: string) => void;
  spawn: (name: string, command: string) => void;
  kill: (agentId: string) => void;
  attachPty: (agentId: string, cb: (bytes: Uint8Array) => void) => void;
  detachPty: (agentId: string) => void;
  sendInput: (agentId: string, bytes: Uint8Array) => void;
};

let client: CanvasClient | null = null;

const TOKEN = (import.meta.env.VITE_CANVAS_TOKEN as string | undefined) ??
  new URLSearchParams(location.search).get("token") ??
  "";

export const useBoard = create<BoardState>((set, get) => ({
  connected: false,
  agents: {},
  ptyListeners: {},

  connect: (token: string) => {
    const t = token || TOKEN;
    if (!t || client) return;
    client = new CanvasClient(t, {
      onControl: (msg: ServerMsg) => {
        const { agents } = get();
        switch (msg.type) {
          case "spawned":
            set({
              agents: {
                ...agents,
                [msg.agent_id]: { id: msg.agent_id, name: msg.name, status: "working" },
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
          case "error":
            console.error("[canvasd]", msg.message);
            break;
          default:
            break;
        }
      },
      onPty: (agentId, bytes) => {
        get().ptyListeners[agentId]?.(bytes);
      },
      onClose: () => set({ connected: false }),
    });
    void client.whenOpen().then(() => set({ connected: true }));
  },

  spawn: (name, command) => client?.spawnAgent(name, command),

  kill: (agentId) => client?.confirmDestructive(agentId, "kill"),

  attachPty: (agentId, cb) =>
    set((s) => ({ ptyListeners: { ...s.ptyListeners, [agentId]: cb } })),

  detachPty: (agentId) =>
    set((s) => {
      const { [agentId]: _drop, ...rest } = s.ptyListeners;
      return { ptyListeners: rest };
    }),

  sendInput: (agentId, bytes) => client?.ptyInput(agentId, bytes),
}));
