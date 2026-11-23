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
};

export type ServerMsg =
  | { type: "spawned"; agent_id: string; name: string; command?: string; permission?: string; workspace_id?: string | null }
  | { type: "workspace_created"; workspace_id: string; name: string; repo: string }
  | { type: "status"; agent_id: string; status: string }
  | { type: "activity"; agent_id: string; line: string }
  | { type: "diff"; agent_id: string; files: number }
  | { type: "error"; agent_id: string | null; message: string }
  | { type: "delegation"; edge_id: string; from: string; to: string; task: string }
  | { type: "result"; edge_id: string; summary: string; files?: number }
  | {
      type: "snapshot";
      agents: SnapshotAgent[];
      delegations?: SnapshotDelegation[];
      workspaces?: SnapshotWorkspace[];
      layout: Record<string, [number, number]>;
    };

export type SnapshotWorkspace = {
  workspace_id: string;
  name: string;
  repo: string;
};

export type SnapshotDelegation = {
  edge_id: string;
  from: string;
  to: string;
  task: string;
  result?: string | null;
  files?: number;
  state: string;
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
    this.ws = new WebSocket(`ws://127.0.0.1:4242/ws?token=${token}`);
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

  spawnAgent(name: string, command: string, cwd = ".", workspaceId?: string, permission?: string) {
    this.send({ cmd: "spawn_agent", name, command, cwd, workspace_id: workspaceId ?? null, permission: permission ?? null });
  }

  createWorkspace(name: string, repo: string) {
    this.send({ cmd: "create_workspace", name, repo });
  }

  /** Raw keystrokes into the agent's PTY. */
  ptyInput(agentId: string, bytes: Uint8Array) {
    this.sendBinary(agentId, bytes);
  }

  resize(agentId: string, cols: number, rows: number) {
    this.send({ cmd: "pty_resize", agent_id: agentId, cols, rows });
  }

  /** The only way to kill: explicit destructive confirmation. */
  confirmDestructive(agentId: string, action: "kill") {
    this.send({ cmd: "confirm_destructive", agent_id: agentId, action });
  }

  moveNode(agentId: string, x: number, y: number) {
    this.send({ cmd: "move_node", agent_id: agentId, x, y });
  }

  delegate(from: string, name: string, command: string, task: string, cwd = ".", workspaceId?: string, permission?: string) {
    this.send({ cmd: "delegate", from, name, command, task, cwd, workspace_id: workspaceId ?? null, permission: permission ?? null });
  }
}
