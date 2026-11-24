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
  /** Path of the agent's git worktree on disk (`.canvas-worktrees/<id>`). */
  worktree?: string;
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

import type { AutomationDef, LoopDef } from "../daemon/client";

type DaemonTransport = CanvasClient | TauriCanvasClient;

const ANSI_RX =
  /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=>N_O]/g;

/** Read an agent's PTY ring for output appended after `before` was taken.
 * bash does not echo pasted input, so we cannot find "our text" — instead
 * byte-diff the ring against the pre-send snapshot and read from the first
 * differing byte. A tail signature fails here: the shell prompt repeats,
 * so any fixed signature also matches the NEW buffer's tail. */
function newOutput(
  buf: Uint8Array,
  before: Uint8Array | undefined,
  sent: string,
): string {
  let start = -1;
  if (before) {
    const n = Math.min(before.length, buf.length);
    let d = 0;
    while (d < n && buf[d] === before[d]) d++;
    if (d < n || buf.length > before.length) start = d;
  } else if (buf.length > 0) {
    start = 0;
  }
  if (start < 0 || buf.length <= start) return "";
  return new TextDecoder()
    .decode(buf.subarray(start))
    .replace(ANSI_RX, "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.endsWith("$") &&
        !l.endsWith("%") &&
        !l.endsWith("#") &&
        !/[❯›⟩»]\s*$/.test(l) &&
        !/^[\s─━═┄┈╌╍╴╶│┃┆┊╎╏┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬▏▎▍▌▋▊▉█▔▁_\-–—=~·•∙]+$/.test(l) &&
        !l.includes(sent),
    )
    .slice(0, 3)
    .join(" · ")
    .slice(0, 160);
}

/** Poll an agent's ring for a reply after writing `sent` to it; post
 * `← name: …` once output shows up (plus one settle pass for streaming). */
function watchReply(
  get: () => BoardState,
  post: (text: string) => void,
  agentId: string,
  name: string,
  before: Uint8Array | undefined,
  sent: string,
) {
  const collect = () => {
    const buf = get().ptyBuffers[agentId];
    return buf ? newOutput(buf, before, sent) : "";
  };
  const poll = (tries: number) => {
    const out = collect();
    if (out) {
      setTimeout(() => post(`← ${name}: ${collect() || out}`), 1500);
      return;
    }
    if (tries > 0) setTimeout(() => poll(tries - 1), 1500);
  };
  setTimeout(() => poll(4), 1500);
}

/** Resolve "terminal N" (card index) or a name/command substring to an
 * agent on a given board. Returns the agent plus its display label. */
function resolveAgent(
  agents: LiveAgent[],
  q: string,
): { agent: LiveAgent; label: string } | undefined {
  const m = q.match(/^terminal\s+(\d+)$/);
  if (m) {
    const a = agents[parseInt(m[1], 10) - 1];
    return a ? { agent: a, label: `Terminal ${m[1]}` } : undefined;
  }
  const a = agents.find(
    (x) =>
      x.name.toLowerCase().includes(q) ||
      (x.command ?? "").toLowerCase().includes(q),
  );
  return a ? { agent: a, label: a.name } : undefined;
}

type ThreadLine = { role: "you" | "thread"; text: string };
const THREAD_KEY = "cv-thread-log";

function loadThreadLog(): ThreadLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(THREAD_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function logLine(log: ThreadLine[], role: ThreadLine["role"], text: string): ThreadLine[] {
  const next = [...log.slice(-60), { role, text }];
  try {
    localStorage.setItem(THREAD_KEY, JSON.stringify(next));
  } catch {
    /* storage full — keep it in memory */
  }
  return next;
}

type BoardState = {
  connected: boolean;
  agents: Record<string, LiveAgent>;
  /** Board id → name (multiple canvases); "main" always exists. */
  boards: Record<string, string>;
  activeBoard: string;
  edges: Record<string, LiveEdge>;
  workspaces: Record<string, LiveWorkspace>;
  /** The board repo's origin (https) — powers the GitHub shortcuts. */
  repoUrl: string | null;
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
  /** Studio dossier markdown (Studios: repo → material). */
  studioDoc: string | null;
  /** Embedded web pages on the canvas: node id -> url, per board. */
  webNodes: Record<string, Record<string, string>>;
  /** UI theme — swaps the seed tokens; glass derives via color-mix. */
  theme: string;
  setTheme: (t: string) => void;
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
  /** Autopilot loops — an instruction re-sent to consoles on a trigger. */
  loops: Record<string, LoopDef>;
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
  spawn: (name: string, command: string, workspaceId?: string, permission?: string, accountId?: string, initialInput?: string) => void;
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
  /** Live markdown nodes — vault files pinned on the board, re-polled
   * so an agent editing the file shows up live on the card. */
  mdNodes: Record<string, Record<string, string>>;
  mdContents: Record<string, string>;
  mdNodeAdd: (path: string) => void;
  mdNodeRemove: (id: string) => void;
  studioDocNow: () => void;
  closeStudioDoc: () => void;
  artifactDelete: (artifactId: string) => void;
  createWorkspace: (name: string, repo: string) => void;
  delegate: (from: string, name: string, command: string, task: string, permission?: string, position?: { x: number; y: number }, boardId?: string) => void;
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
  resizePty: (agentId: string, cols: number, rows: number) => void;
  /** Ask the daemon to replay an exited agent's saved transcript. */
  requestTranscript: (agentId: string) => void;
  bumpFont: (delta: number) => void;
  undoMove: () => boolean;
  requestView: () => void;
  clearDone: () => number;
  /** Local short-request router (Deska-style): runs instant commands
   * client-side — no agent spawn, no token spend. Returns feedback text. */
  quickRequest: (text: string) => string;
  /** THREAD — the board-commander chat log + intent runner. */
  threadLog: { role: "you" | "thread"; text: string }[];
  threadSend: (text: string) => void;
  navRequest: { key: string; n: number } | null;
  requestNav: (key: string) => void;
  /** Deska's "Show Panel Summaries" — hides each card's last line +
   * inline mini-terminal preview for a quieter board. */
  panelSummaries: boolean;
  togglePanelSummaries: () => void;
  /** Whether the spawn chooser is open (summoned by the orchestrator's
   * + or the rail's New Task — there is no permanent spawn button). */
  spawnOpen: boolean;
  setSpawnOpen: (v: boolean) => void;
  focusSpawn: () => void;
  /** Deska's "Gather loose windows into groups" — pulls every unwired,
   * unparented agent card into a tight grid and reframes the view. */
  gatherLoose: () => void;
  /** Frame a board rect as a "Group N" region; returns its label. */
  frameNodes: (x: number, y: number, w: number, h: number) => string;
  /** Hide panels and menus — every chrome element (rails, topbar, spawn
   * bubble) collapses to a single restore button. */
  chromeHidden: boolean;
  toggleChrome: () => void;
  /** Bump counter → zoom the canvas in (1) or out (-1). */
  zoomN: { dir: number; n: number };
  requestZoom: (dir: number) => void;
  /** Ask the board to open a terminal panel for an agent (Panels menu). */
  termRequest: { id: string; name: string; n: number } | null;
  requestTerm: (id: string, name: string) => void;
  /** Ask the canvas to frame one node (workspace tile, agent card). */
  focusNode: { id: string; n: number } | null;
  requestFocus: (id: string) => void;
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
  createLoop: (l: {
    board_id: string;
    target: string;
    instruction: string;
    trigger: string;
    interval_secs?: number;
    pattern?: string;
  }) => void;
  deleteLoop: (loopId: string) => void;
  setLoopEnabled: (loopId: string, enabled: boolean) => void;
  pauseAll: (boardId?: string) => void;
  resumeAll: (boardId?: string) => void;
  /** Symvibe's saveable layout presets — board id → preset name →
   * roster with each member's name/command/position. localStorage. */
  presets: Record<string, Record<string, { agents: { name: string; command: string; x: number; y: number }[] }>>;
  savePreset: (name: string) => void;
  applyPreset: (name: string) => void;
  deletePreset: (name: string) => void;
  /** Whiteboard shapes (Symvibe's shapes tool) — board id → shape id → def. */
  shapes: Record<string, Record<string, import("../board/types").ShapeDef>>;
  addShape: (kind: import("../board/types").ShapeKind) => void;
  moveShape: (id: string, x: number, y: number) => void;
  updateShape: (id: string, patch: Partial<import("../board/types").ShapeDef>) => void;
  deleteShape: (id: string) => void;
  /** Symvibe-style orchestrator cards: a board node wired to consoles with
   * cables; its composer broadcasts the command to every wired PTY. */
  orchestrators: Record<string, { name: string; board: string; wired: string[] }>;
  /** Orchestrator id currently in Connect mode (pick agents to wire). */
  wiringFrom: string | null;
  spawnOrchestrator: () => void;
  setWiring: (orchId: string | null) => void;
  toggleWire: (orchId: string, agentId: string) => void;
  commandAgents: (orchId: string, text: string) => void;
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
  repoUrl: null,
  accounts: {},
  memories: {},
  digest: null,
  notice: null,
  vaultDir: "",
  vaultEntries: [],
  vaultFile: null,
  studioDoc: null,
  theme: localStorage.getItem("cv-theme") ?? "obsidian",
  setTheme: (t) => {
    localStorage.setItem("cv-theme", t);
    document.documentElement.dataset.theme = t;
    set({ theme: t });
  },
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
  loops: {},
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
          case "loop_saved":
            set({
              loops: { ...get().loops, [msg.l.loop_id]: msg.l },
            });
            break;
          case "loop_deleted": {
            const next = { ...get().loops };
            delete next[msg.loop_id];
            set({ loops: next });
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
                  worktree: a.worktree || undefined,
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
            const loops = Object.fromEntries(
              (msg.loops ?? []).map((l) => [l.loop_id, l]),
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
              repoUrl: msg.repo_url ?? null,
              automations,
              loops,
              boards: { main: "Main", ...boards },
              accounts,
              notes,
              artifacts,
            });
            break;
          }
          case "studio_doc_md":
            set({ studioDoc: msg.text });
            break;
          case "vault_listing":
            set({ vaultEntries: msg.entries });
            break;
          case "vault_file":
            set({
              vaultFile: { path: msg.path, text: msg.text },
              mdContents: { ...get().mdContents, [msg.path]: msg.text },
            });
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

  spawn: (name, command, workspaceId, permission, accountId, initialInput) =>
    client?.spawnAgent(name, command, ".", workspaceId, permission, get().activeBoard, accountId, initialInput),

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
  studioDocNow: () => client?.studioDoc(),
  closeStudioDoc: () => set({ studioDoc: null }),
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

  mdNodes: (() => {
    try { return JSON.parse(localStorage.getItem("cv-mdnodes") ?? "{}"); } catch { return {}; }
  })(),
  mdContents: {},
  mdNodeAdd: (path) => {
    const board = get().activeBoard;
    const id = `md-${Math.random().toString(16).slice(2, 10)}`;
    const next = { ...get().mdNodes, [board]: { ...(get().mdNodes[board] ?? {}), [id]: path } };
    localStorage.setItem("cv-mdnodes", JSON.stringify(next));
    set({ mdNodes: next });
    client?.moveNode(id, 300 + Math.random() * 200, 140 + Math.random() * 160);
    client?.vaultRead(get().vaultDir, path);
  },
  mdNodeRemove: (id) => {
    const board = get().activeBoard;
    const m = { ...(get().mdNodes[board] ?? {}) };
    delete m[id];
    const next = { ...get().mdNodes, [board]: m };
    localStorage.setItem("cv-mdnodes", JSON.stringify(next));
    set({ mdNodes: next });
  },
  artifactCreate: (kind, title, path, text) =>
    client?.artifactCreate(get().activeBoard ?? undefined, kind, title, path, text),
  artifactDelete: (artifactId) => client?.artifactDelete(artifactId),
  memoryWrite: (nodeId, text) => {
    client?.memoryWrite(nodeId, text);
    set((st) => ({ memories: { ...st.memories, [nodeId]: text } }));
  },

  createWorkspace: (name, repo) => client?.createWorkspace(name, repo, get().activeBoard),

  delegate: (from, name, command, task, permission, position, boardId) => {
    if (position) {
      set((s) => ({ pendingPositions: { ...s.pendingPositions, [from]: position } }));
    }
    client?.delegate(from, name, command, task, ".", undefined, permission, undefined, boardId);
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
  createLoop: (l) => client?.createLoop(l),
  deleteLoop: (loopId) => client?.deleteLoop(loopId),
  setLoopEnabled: (loopId, enabled) => client?.setLoopEnabled(loopId, enabled),
  pauseAll: (boardId) => client?.pauseAll(boardId),
  resumeAll: (boardId) => client?.resumeAll(boardId),

  presets: (() => {
    try { return JSON.parse(localStorage.getItem("cv-presets") ?? "{}"); } catch { return {}; }
  })(),

  savePreset: (name) => {
    const { activeBoard, positions, agents, presets } = get();
    const roster = Object.values(agents)
      .filter((a) => a.board_id === activeBoard)
      .map((a) => ({
        name: a.name,
        command: a.command ?? "",
        x: positions[a.id]?.x ?? 200,
        y: positions[a.id]?.y ?? 120,
      }));
    const boardPresets = { ...(presets[activeBoard] ?? {}) };
    boardPresets[name] = { agents: roster };
    const next = { ...presets, [activeBoard]: boardPresets };
    localStorage.setItem("cv-presets", JSON.stringify(next));
    set({ presets: next, notice: `preset "${name}" saved` });
  },

  applyPreset: (name) => {
    const { activeBoard, presets } = get();
    const preset = presets[activeBoard]?.[name];
    if (!preset) return;
    const reposition = () => {
      for (const a of Object.values(get().agents)) {
        if (a.board_id !== activeBoard) continue;
        const r = preset.agents.find((m) => m.name === a.name);
        if (!r) continue;
        set((s) => ({ positions: { ...s.positions, [a.id]: { x: r.x, y: r.y } } }));
        client?.moveNode(a.id, r.x, r.y);
      }
    };
    const live = Object.values(get().agents).filter((a) => a.board_id === activeBoard);
    const missing = preset.agents.filter((r) => !live.some((a) => a.name === r.name));
    for (const m of missing) get().spawn(m.name, m.command);
    reposition();
    if (missing.length) setTimeout(reposition, 2500); // once spawned ids land
    set({ notice: `preset "${name}" applied${missing.length ? ` (+${missing.length} spawned)` : ""}` });
  },

  deletePreset: (name) => {
    const { activeBoard, presets } = get();
    const boardPresets = { ...(presets[activeBoard] ?? {}) };
    delete boardPresets[name];
    const next = { ...presets, [activeBoard]: boardPresets };
    localStorage.setItem("cv-presets", JSON.stringify(next));
    set({ presets: next });
  },

  shapes: (() => {
    try { return JSON.parse(localStorage.getItem("cv-shapes") ?? "{}"); } catch { return {}; }
  })(),

  addShape: (kind) => {
    const { activeBoard, shapes } = get();
    const id = `shape-${Math.random().toString(36).slice(2, 10)}`;
    const def = {
      id,
      kind,
      x: 300 + Math.random() * 200,
      y: 200 + Math.random() * 140,
      w: kind === "sticky" ? 170 : 190,
      h: kind === "sticky" ? 150 : 120,
      color: kind === "sticky" ? "#e0c04a" : "#e8e6e3",
      text: "",
    };
    const next = { ...shapes, [activeBoard]: { ...(shapes[activeBoard] ?? {}), [id]: def } };
    localStorage.setItem("cv-shapes", JSON.stringify(next));
    set({ shapes: next });
  },

  moveShape: (id, x, y) => {
    const { activeBoard, shapes } = get();
    const s = shapes[activeBoard]?.[id];
    if (!s) return;
    const next = { ...shapes, [activeBoard]: { ...shapes[activeBoard], [id]: { ...s, x, y } } };
    localStorage.setItem("cv-shapes", JSON.stringify(next));
    set({ shapes: next });
  },

  updateShape: (id, patch) => {
    const { activeBoard, shapes } = get();
    const s = shapes[activeBoard]?.[id];
    if (!s) return;
    const next = { ...shapes, [activeBoard]: { ...shapes[activeBoard], [id]: { ...s, ...patch } } };
    localStorage.setItem("cv-shapes", JSON.stringify(next));
    set({ shapes: next });
  },

  deleteShape: (id) => {
    const { activeBoard, shapes } = get();
    const boardShapes = { ...(shapes[activeBoard] ?? {}) };
    delete boardShapes[id];
    const next = { ...shapes, [activeBoard]: boardShapes };
    localStorage.setItem("cv-shapes", JSON.stringify(next));
    set({ shapes: next });
  },

  orchestrators: (() => {
    try {
      return JSON.parse(localStorage.getItem("canvas:orchestrators") ?? "{}");
    } catch {
      return {};
    }
  })(),
  wiringFrom: null,

  spawnOrchestrator: () => {
    const id = `orch-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const orchestrators = {
      ...get().orchestrators,
      [id]: { name: "Orchestrator", board: get().activeBoard, wired: [] as string[] },
    };
    try {
      localStorage.setItem("canvas:orchestrators", JSON.stringify(orchestrators));
    } catch { /* private mode — wiring lives in memory only */ }
    set({ orchestrators });
    get().moveNode(id, 420, 80);
  },

  setWiring: (orchId) => set({ wiringFrom: orchId }),

  toggleWire: (orchId, agentId) => {
    const all = get().orchestrators;
    const cur = all[orchId];
    if (!cur) return;
    const wired = cur.wired.includes(agentId)
      ? cur.wired.filter((x) => x !== agentId)
      : [...cur.wired, agentId];
    const orchestrators = { ...all, [orchId]: { ...cur, wired } };
    try {
      localStorage.setItem("canvas:orchestrators", JSON.stringify(orchestrators));
    } catch { /* see spawnOrchestrator */ }
    set({ orchestrators });
  },

  // The composer writes the command straight into each wired console's
  // PTY — like speaking to each terminal at once (Symvibe's "Command N").
  // It also understands "spawn two codex / three reviewers": every spawn
  // is a delegation edge from the orchestrator, so the new agent lands
  // already wired (the cable IS the delegation).
  commandAgents: (orchId, text) => {
    const cur = get().orchestrators[orchId];
    if (!cur || !text.trim()) return;
    const WORDN: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const m = text.trim().match(/^(?:spawn|deploy)\s+(?:(?:(\d+)|(one|two|three|four|five|six))\s+)?([\w-]+?)(?:\s+(?:agents?|consoles?|terminals?))?$/i);
    if (m) {
      const n = m[1] ? parseInt(m[1], 10) : m[2] ? WORDN[m[2].toLowerCase()] : 1;
      const word = m[3].toLowerCase().replace(/s$/, "");
      const KNOWN = new Set([
        "claude", "claude-code", "codex", "gemini", "gemini-cli", "bash", "aider",
        "cursor-agent", "cursor", "opencode", "amp", "droid", "goose", "kilocode",
        "qwen", "hermes", "kimi", "vibe", "pi", "antigravity", "terminal",
      ]);
      const cli = KNOWN.has(word) ? (word === "terminal" ? "bash" : word) : "claude";
      const role = KNOWN.has(word) ? cli : word;
      for (let i = 0; i < Math.min(Math.max(n, 1), 8); i++) {
        const nm = n > 1 ? `${role}-${i + 1}` : role;
        get().delegate(orchId, nm, cli, `You are ${role} ${i + 1} on the team — await the next message.`, undefined, undefined, cur.board);
      }
      return;
    }
    const payload = new TextEncoder().encode(`${text.trim()}\r`);
    // Broadcast to wired consoles + every agent this orchestrator spawned.
    const targets = new Set(cur.wired);
    for (const e of Object.values(get().edges))
      if (e.from === orchId) targets.add(e.to);
    const snaps = new Map<string, Uint8Array | undefined>();
    for (const aid of targets) {
      snaps.set(aid, get().ptyBuffers[aid]);
      get().sendInput(aid, payload);
    }
    // Replies land in the Dex thread — the orchestrator has no log of its own.
    const post = (r: string) =>
      set((s) => ({ threadLog: logLine(s.threadLog, "thread", r) }));
    for (const [aid, before] of snaps) {
      const agent = get().agents[aid];
      if (agent) watchReply(get, post, aid, agent.name, before, text.trim());
    }
  },

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

  threadLog: loadThreadLog(),
  navRequest: null,
  requestNav: (key) => set((s) => ({ navRequest: { key, n: (s.navRequest?.n ?? 0) + 1 } })),
  panelSummaries: true,
  togglePanelSummaries: () => set((s) => ({ panelSummaries: !s.panelSummaries })),
  spawnOpen: false,
  setSpawnOpen: (v) => set({ spawnOpen: v }),
  focusSpawn: () => set({ spawnOpen: true }),
  gatherLoose: () => {
    const { agents, edges, positions, activeBoard } = get();
    const wired = new Set(Object.values(edges).flatMap((e) => [e.from, e.to]));
    const loose = Object.values(agents).filter(
      (a) =>
        (a.board_id ?? "main") === activeBoard &&
        a.status !== "exited" &&
        !a.workspace_id &&
        !wired.has(a.id),
    );
    if (!loose.length) {
      get().notify("gather — no loose windows");
      return;
    }
    const x0 = Math.min(...loose.map((a) => positions[a.id]?.x ?? 0));
    const y0 = Math.min(...loose.map((a) => positions[a.id]?.y ?? 0));
    const cols = Math.ceil(Math.sqrt(loose.length));
    loose.forEach((a, i) =>
      get().moveNode(a.id, x0 + (i % cols) * 500, y0 + Math.floor(i / cols) * 250),
    );
    const rows = Math.ceil(loose.length / cols);
    const n = get().frameNodes(
      x0 - 26, y0 - 46, cols * 500 + 12, rows * 250 + 56,
    );
    get().notify(`gathered ${loose.length} loose window${loose.length === 1 ? "" : "s"} into ${n}`);
    get().requestView();
  },
  /** Drop a translucent "Group N" rect behind a region of the board —
   * shared by gatherLoose and the selection pill. Returns the label. */
  frameNodes: (x, y, w, h) => {
    const { activeBoard, shapes } = get();
    const n = Object.keys(shapes[activeBoard] ?? {}).filter(
      (k) => shapes[activeBoard][k].text?.startsWith("Group")).length + 1;
    const id = `shape-${Math.random().toString(36).slice(2, 10)}`;
    const def = { id, kind: "rect" as const, x, y, w, h, color: "#5f7fd9", text: `Group ${n}` };
    const next = { ...shapes, [activeBoard]: { ...(shapes[activeBoard] ?? {}), [id]: def } };
    localStorage.setItem("cv-shapes", JSON.stringify(next));
    set({ shapes: next });
    return `Group ${n}`;
  },
  chromeHidden: false,
  toggleChrome: () => set((s) => ({ chromeHidden: !s.chromeHidden })),
  zoomN: { dir: 0, n: 0 },
  requestZoom: (dir) => set((s) => ({ zoomN: { dir, n: s.zoomN.n + 1 } })),
  termRequest: null,
  requestTerm: (id, name) =>
    set((s) => ({ termRequest: { id, name, n: (s.termRequest?.n ?? 0) + 1 } })),
  focusNode: null,
  requestFocus: (id) =>
    set((s) => ({ focusNode: { id, n: (s.focusNode?.n ?? 0) + 1 } })),

  /** Symvibe's THREAD — the built-in board commander. Deterministic
   * intent parsing; falls back to quickRequest for local commands. */
  threadSend: (text) => {
    const t = text.trim();
    if (!t) return;
    set((s) => ({ threadLog: logLine(s.threadLog, "you", t) }));
    const reply = (r: string) =>
      set((s) => ({ threadLog: logLine(s.threadLog, "thread", r) }));
    const low = t.toLowerCase();
    // "@<agent name> <message>" — type the message straight into that
    // agent's PTY (command the board without touching terminals). Names
    // have spaces ("Terminal 1"), so match the longest name prefix.
    if (t.startsWith("@")) {
      const rest = t.slice(1);
      const boardAgents = Object.values(get().agents).filter(
        (a) => (a.board_id ?? "main") === get().activeBoard,
      );
      // Cards display "Terminal N" — N is the index in this same ordering —
      // so "@Terminal 4 …" addresses the 4th agent, not a name match.
      // "@all / @everyone / @* <msg>" — broadcast to every live agent and
      // collect each reply into the thread.
      const all = rest.match(/^(?:all|everyone|\*)\s+(.*)$/is);
      if (all) {
        const msg = all[1].trim();
        const live = boardAgents.filter((a) => a.status !== "exited");
        if (!msg) reply(`@all needs a message`);
        else if (!live.length) reply("no live agents on this board");
        else {
          const payload = new TextEncoder().encode(msg + "\n");
          const snaps = new Map<string, Uint8Array | undefined>();
          for (const a of live) {
            snaps.set(a.id, get().ptyBuffers[a.id]);
            get().sendInput(a.id, payload);
          }
          reply(`→ all ${live.length} agents: ${msg.slice(0, 60)}`);
          live.forEach((a, i) => {
            const name = `Terminal ${boardAgents.indexOf(a) + 1}`;
            const before = snaps.get(a.id);
            setTimeout(
              () => watchReply(get, reply, a.id, name, before, msg),
              i * 200,
            );
          });
        }
        return;
      }
      const tm = rest.match(/^terminal\s+(\d+)\s+(.*)$/is);
      let target: (typeof boardAgents)[number] | undefined;
      let label = "";
      let labelLen = 0;
      if (tm) {
        target = boardAgents[parseInt(tm[1], 10) - 1];
        label = `Terminal ${tm[1]}`;
        labelLen = rest.indexOf(tm[2]);
      } else {
        const hit = [...boardAgents]
          .sort((a, b) => b.name.length - a.name.length)
          .find((a) => rest.toLowerCase().startsWith(a.name.toLowerCase() + " "));
        if (hit) {
          target = hit;
          label = hit.name;
          labelLen = hit.name.length;
        }
      }
      if (!target) {
        reply(`no agent matches "${rest.split(/\s+/)[0]}…" on this board`);
      } else if (target.status === "exited") {
        reply(`${label || target.name} already exited`);
      } else {
        const msg = rest.slice(labelLen).trim();
        if (!msg) reply(`@${label || target.name} needs a message`);
        else {
          const id = target.id;
          const name = label || target.name;
          const before = get().ptyBuffers[id];
          get().sendInput(id, new TextEncoder().encode(msg + "\n"));
          reply(`→ ${name}: ${msg.slice(0, 60)}`);
          watchReply(get, reply, id, name, before, msg);
        }
      }
      return;
    }
    const WORDN: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const sm = low.match(/^(?:spawn|deploy)\s+(?:(?:(\d+)|(one|two|three|four|five|six))\s+)?([\w-]+?)(?:\s+(?:agents?|consoles?|terminals?))?$/);
    if (sm) {
      const n = sm[1] ? parseInt(sm[1], 10) : sm[2] ? WORDN[sm[2]] : 1;
      const cli = sm[3].replace(/s$/, "");
      for (let i = 0; i < Math.min(Math.max(n, 1), 8); i++) {
        get().spawn(n > 1 ? `${cli}-${i + 1}` : cli, cli);
      }
      reply(`spawned ${Math.min(Math.max(n, 1), 8)} × ${cli}`);
      return;
    }
    const km = low.match(/^(?:kill|stop|close)\s+(.+)$/);
    if (km && !/^all\b/.test(km[1])) {
      const q = km[1].trim();
      const boardAgents = Object.values(get().agents).filter(
        (a) => (a.board_id ?? "main") === get().activeBoard,
      );
      const hit = resolveAgent(boardAgents, q);
      if (!hit) reply(`no agent matches "${q}"`);
      else {
        get().kill(hit.agent.id);
        reply(`killed ${hit.label}`);
      }
      return;
    }
    const am = low.match(/^(approve|allow|deny|reject)\s*(.*)$/);
    if (am) {
      const deny = am[1] === "deny" || am[1] === "reject";
      const q = am[2].trim();
      const pending = Object.keys(get().approvals);
      if (!pending.length) {
        reply("nothing waiting for approval");
        return;
      }
      const boardAgents = Object.values(get().agents).filter(
        (a) => (a.board_id ?? "main") === get().activeBoard,
      );
      // No arg → the single pending approval (error if ambiguous).
      const hit = q
        ? resolveAgent(boardAgents, q)
        : pending.length === 1
          ? { agent: get().agents[pending[0]], label: get().agents[pending[0]]?.name ?? "?" }
          : undefined;
      if (!hit?.agent) {
        reply(q ? `no agent matches "${q}"` : `${pending.length} approvals pending — name one`);
        return;
      }
      if (!get().approvals[hit.agent.id]) {
        reply(`${hit.label} has nothing pending`);
        return;
      }
      const line = get().approvals[hit.agent.id];
      if (deny) get().denyInput(hit.agent.id);
      else get().approveInput(hit.agent.id);
      reply(`${deny ? "denied" : "approved"} ${hit.label}: ${line}`);
      return;
    }
    if (/^kill all/.test(low)) {
      const board = get().activeBoard;
      const ids = Object.values(get().agents).filter((a) => a.board_id === board).map((a) => a.id);
      for (const id of ids) get().kill(id);
      reply(`killed ${ids.length} agent${ids.length === 1 ? "" : "s"}`);
      return;
    }
    if (/^pause/.test(low)) {
      get().pauseAll(get().activeBoard);
      reply("paused every agent on this board");
      return;
    }
    if (/^resume/.test(low)) {
      get().resumeAll(get().activeBoard);
      reply("resumed every agent");
      return;
    }
    const pm = low.match(/^(?:apply|use|load) preset\s+(.+)$/);
    if (pm) {
      const presets = get().presets[get().activeBoard] ?? {};
      const hit = Object.keys(presets).find((k) => k.toLowerCase() === pm[1].trim());
      if (hit) {
        get().applyPreset(hit);
        reply(`applied preset "${hit}"`);
      } else {
        reply(`no preset "${pm[1].trim()}" on this board`);
      }
      return;
    }
    const sp = low.match(/^save preset\s+(.+)$/);
    if (sp) {
      get().savePreset(sp[1].trim());
      reply(`saved preset "${sp[1].trim()}"`);
      return;
    }
    const PANELS = ["inbox", "automations", "loops", "presets", "history", "accounts", "memory", "notes", "artifacts", "vault", "skills", "settings", "canvas"];
    const om = low.match(/^(?:open|show|go to)\s+([\w\s]+?)$/);
    if (om) {
      const hit = PANELS.find((p) => om[1].trim().startsWith(p));
      if (hit) {
        get().requestNav(hit);
        reply(`opened ${hit}`);
        return;
      }
    }
    if (/whole board|fit view|zoom out|overview/.test(low)) {
      get().requestView();
      reply("fitted the whole board");
      return;
    }
    if (/^(?:status|how are we|report|board state)/.test(low)) {
      const as = Object.values(get().agents).filter((a) => (a.board_id ?? "main") === get().activeBoard);
      if (!as.length) { reply("no agents on this board — 'spawn <cli>' to start"); return; }
      const by = new Map<string, number>();
      for (const a of as) by.set(a.status, (by.get(a.status) ?? 0) + 1);
      reply(`${as.length} agent${as.length === 1 ? "" : "s"}: ` +
        [...by].map(([k, v]) => `${v} ${k}`).join(", "));
      return;
    }
    const fm = low.match(/^(?:focus|find|go to|show)\s+(?:agent|terminal)?\s*(.+)$/);
    if (fm) {
      const q = fm[1].trim();
      const hit = Object.values(get().agents).find((a) =>
        a.name.toLowerCase().includes(q) || (a.command ?? "").toLowerCase().includes(q));
      if (hit) {
        get().requestFocus(hit.id);
        reply(`focusing ${hit.name}`);
      } else {
        reply(`no agent matches "${q}"`);
      }
      return;
    }
    const ck =
      low.match(/^(?:check|peek|inspect|last(?:\s+line)?)\s+(?:on\s+|of\s+)?(.+)$/) ??
      low.match(/^what(?:'s| is)\s+(.+?)\s+doing\s*\??$/);
    if (ck) {
      const q = ck[1].replace(/[?.\s]+$/, "").trim();
      const boardAgents = Object.values(get().agents).filter(
        (a) => (a.board_id ?? "main") === get().activeBoard,
      );
      const ctm = q.match(/^terminal\s+(\d+)$/);
      const target = ctm
        ? boardAgents[parseInt(ctm[1], 10) - 1]
        : boardAgents.find(
            (a) =>
              a.name.toLowerCase().includes(q) ||
              (a.command ?? "").toLowerCase().includes(q),
          );
      if (!target) {
        reply(`no agent matches "${q}"`);
      } else {
        const label = ctm ? `Terminal ${ctm[1]}` : target.name;
        const buf = get().ptyBuffers[target.id];
        const line = buf
          ? new TextDecoder()
              .decode(buf)
              .replace(ANSI_RX, "")
              .replace(/\r/g, "\n")
              .split("\n")
              .map((l) => l.trim())
              .filter(
                (l) => l && !l.endsWith("$") && !l.endsWith("%") && !l.endsWith("#"),
              )
              .pop()
          : "";
        reply(line ? `${label}: ${line.slice(0, 160)}` : `${label}: no output yet`);
      }
      return;
    }
    if (/^(?:help|commands|what can you do)\s*\??$/.test(low)) {
      reply(
        "I speak: @Terminal N <msg> · @all <msg> · check Terminal N · " +
          "spawn <cli> · kill Terminal N · kill all · pause/resume · " +
          "apply/save preset <n> · open <panel> · focus <name> · " +
          "gather · hide chrome · status · summary",
      );
      return;
    }
    if (/^gather/.test(low)) {
      get().gatherLoose();
      reply("gathered the loose windows into a group");
      return;
    }
    if (/^hide (?:chrome|panels|menus|ui)/.test(low)) {
      get().toggleChrome();
      reply("chrome hidden — the eye button brings it back");
      return;
    }
    const st = low.match(/^(?:spawn|deploy)\s+([\w-]+)\s+(?:to|with task|task)\s+(.+)$/);
    if (st) {
      get().spawn(st[1], st[1], undefined, undefined, undefined, st[2]);
      reply(`spawned ${st[1]} with task: "${st[2].slice(0, 60)}"`);
      return;
    }
    if (/summari|digest|recap/.test(low)) {
      get().studioDocNow();
      reply("built the board dossier");
      return;
    }
    const r = get().quickRequest(t);
    reply(r.startsWith("try:") ? `can't parse that — ${r}` : r);
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
  resizePty: (agentId, cols, rows) => client?.resize(agentId, cols, rows),

  requestTranscript: (agentId) => client?.transcript(agentId),
}));

// Dev-only handle for console debugging — never shipped to Tauri prod usage.
if (import.meta.env.DEV) {
  (window as unknown as { useBoard?: typeof useBoard }).useBoard = useBoard;
}
