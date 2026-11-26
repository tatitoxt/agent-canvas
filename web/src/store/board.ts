import { create } from "zustand";
import { CanvasClient, type ServerMsg } from "../daemon/client";
import { isTauri, TauriCanvasClient } from "../daemon/tauriClient";
import type { AgentStatus } from "../board/types";
import { PANEL_META } from "../components/panelMeta";
import { replayedPtyBytes } from "../board/ptyAccounting";
import { resetScreen } from "../board/ptyScreen";
import { initialNodes } from "../board/mockData";
import { planGatherLayout, type GatherRect } from "./gatherLayout";

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
  /** Present in the connect snapshot — a pre-existing (restored) session. */
  restored?: boolean;
  output_bytes?: number;
  /** Client-side first-seen time — drives the elapsed chip on live agents. */
  seenAt?: number;
};

/** OS-level notification when the tab isn't focused (agent awaiting input).
 * Click focuses the window AND the agent's card when focusId is given. */
export function sysNotify(title: string, body: string, focusId?: string) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (!document.hidden) return; // looking at the board already
    const n = new Notification(title, { body, icon: "/canvas-mark.png", tag: `${title}:${body}` });
    n.onclick = () => {
      window.focus();
      if (focusId) useBoard.getState().requestFocus(focusId);
      n.close();
    };
  } catch { /* unsupported context */ }
}

export type LiveWorkspace = {
  id: string;
  name: string;
  repo: string;
  board_id?: string | null;
  /** Ordered CLI fallback chain; absent = daemon auto-detected default. */
  agent_chain?: string[] | null;
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

type CanvasPoint = { x: number; y: number };
type CanvasRect = { x: number; y: number; w: number; h: number };

/** Place new agents in the visible canvas, preferring open space near its center. */
export function getAgentSpawnPositions(
  count: number,
  viewport: { left: number; top: number; right: number; bottom: number } | null,
  occupied: CanvasRect[],
  size = { w: 460, h: 260 },
  origin?: CanvasPoint | null,
): CanvasPoint[] {
  const cols = Math.max(1, Math.floor((viewport ? viewport.right - viewport.left - 24 : 1120) / (size.w + 28)));
  const stepX = size.w + 28;
  const stepY = size.h + 28;
  const area = viewport ?? { left: 0, top: 0, right: cols * stepX, bottom: 3 * stepY };
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
  const center = origin
    ? { x: clamp(origin.x, area.left + 12, area.right - size.w - 12), y: clamp(origin.y, area.top + 12, area.bottom - size.h - 12) }
    : {
        x: clamp((area.left + area.right - size.w) / 2, area.left + 12, area.right - size.w - 12),
        y: clamp((area.top + area.bottom - size.h) / 2, area.top + 12, area.bottom - size.h - 12),
      };
  const xSlots: number[] = [];
  const ySlots: number[] = [];
  for (let x = area.left + 12; x + size.w <= area.right - 12; x += stepX) xSlots.push(x);
  for (let y = area.top + 12; y + size.h <= area.bottom - 12; y += stepY) ySlots.push(y);
  const candidates = xSlots.flatMap((x) => ySlots.map((y) => ({ x, y })))
    .sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y));
  const selected: CanvasPoint[] = [];
  const fits = (p: CanvasPoint) => {
    const overlapsExisting = occupied.some((r) => p.x < r.x + r.w + 18 && p.x + size.w + 18 > r.x && p.y < r.y + r.h + 18 && p.y + size.h + 18 > r.y);
    const overlapsSelected = selected.some((r) => p.x < r.x + size.w + 18 && p.x + size.w + 18 > r.x && p.y < r.y + size.h + 18 && p.y + size.h + 18 > r.y);
    return !overlapsExisting && !overlapsSelected;
  };
  for (const p of candidates) {
    if (selected.length >= count) break;
    if (fits(p)) selected.push(p);
  }
  // If the visible canvas is full, preserve non-overlap in a tidy continuation
  // just below it. The visible cells are always returned first.
  for (let i = 0; selected.length < count; i++) {
    const p = { x: area.left + 12 + (i % cols) * stepX, y: area.bottom + 32 + Math.floor(i / cols) * stepY };
    if (fits(p)) selected.push(p);
  }
  return selected;
}

/** Poll an agent's ring for a reply after writing `sent` to it; post
 * `← name: …` once output shows up (plus one settle pass for streaming). */
function watchReply(
  get: () => BoardState,
  post: (text: string, agentId: string) => void,
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
      setTimeout(() => post(`← ${name}: ${collect() || out}`, agentId), 1500);
      return;
    }
    if (tries > 0) setTimeout(() => poll(tries - 1), 1500);
  };
  setTimeout(() => poll(4), 1500);
}

/* --- per-account usage metering -----------------------------------------
 * Local-first ledger: live PTY bytes attributed to the agent's account
 * bucket ("cli|label", "default" when unsigned), kept in localStorage
 * with a bucket per ISO week. Session bytes are in-memory only. */

/** Usage bucket key for an agent. Named accounts are namespaced so a
 * label literally called "default" can't merge with the unsigned
 * machine sign-in. */
export function acctKey(cli: string | undefined, label: string | null | undefined): string {
  return `${cli || "?"}|${label ? `acct:${label}` : "default"}`;
}

/** Display form of a usage key: "claude — @pro", "codex — default". */
export function acctLabel(key: string): string {
  const [cli, label] = key.split("|");
  return `${cli} — ${label.startsWith("acct:") ? `@${label.slice(5)}` : "default sign-in"}`;
}

/** Usage key for a live agent: bound agents roll up under their account's
 * `<cli>|acct:<label>` bucket (so account caps apply); unsigned agents
 * bucket by the CLI binary their command invokes — first token, basename. */
export function agentAcctKey(
  a: { command?: string; account_label?: string | null },
  accounts: { cli: string; label: string }[],
): string {
  const bin = cliBin(a.command);
  if (a.account_label) {
    // The label alone is ambiguous across CLIs ("pro" on claude and codex)
    // — prefer the account whose cli is the binary this command runs.
    const acct =
      accounts.find((x) => x.label === a.account_label && x.cli === bin) ??
      accounts.find((x) => x.label === a.account_label);
    if (acct) return acctKey(acct.cli, a.account_label);
  }
  return acctKey(bin, a.account_label);
}

/** First token of a command line as a basename, honoring a leading quote —
 * `"/opt/my tools/claude" --flag` → `claude`, `claude --flag` → `claude`. */
function cliBin(command?: string): string {
  const c = (command ?? "").trim();
  const m = c.match(/^["']([^"']+)["']/) ?? c.match(/^\S+/);
  return (m?.[1] ?? m?.[0] ?? "?").split("/").pop() || "?";
}

/** Monday (YYYY-MM-DD, local time) of the ISO week containing `d`. */
function isoWeek(d = new Date()): string {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

/** Weekly-cap thresholds (%) that fire a one-time toast per key per week. */
export const WEEK_MILESTONES = [15, 30, 50, 75];
/** Cap used when the user hasn't set one: 256 MB of weekly output. */
export const DEFAULT_WEEK_CAP_KB = 256 * 1024;

export type AcctLedger = {
  week: string;
  bytes: Record<string, number>;
  /** key → bitmask of milestones already toasted this week. */
  fired: Record<string, number>;
  /** key → weekly cap in KB (unset → DEFAULT_WEEK_CAP_KB). */
  caps: Record<string, number>;
};

const ACCT_LEDGER_KEY = "cv-acct-usage-v1";

function loadLedger(): AcctLedger {
  const blank: AcctLedger = { week: isoWeek(), bytes: {}, fired: {}, caps: {} };
  try {
    const raw = localStorage.getItem(ACCT_LEDGER_KEY);
    if (!raw) return blank;
    const l = { ...blank, ...(JSON.parse(raw) as AcctLedger) };
    l.caps ??= {};
    if (l.week !== isoWeek()) {
      l.week = isoWeek();
      l.bytes = {};
      l.fired = {};
    }
    return l;
  } catch {
    return blank;
  }
}

let ledgerFlushAt = 0;
function saveLedger(l: AcctLedger, force = false) {
  const now = Date.now();
  if (!force && now - ledgerFlushAt < 1500) return;
  ledgerFlushAt = now;
  try {
    localStorage.setItem(ACCT_LEDGER_KEY, JSON.stringify(l));
  } catch {
    /* storage full or private mode — metering stays in-memory */
  }
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

/** spawn name → account the user picked — `Spawned` carries no account
 * fields, so the agent card + usage bucket get the label optimistically
 * until the next snapshot makes it authoritative. */
const pendingAccts = new Map<string, string>();

type ThreadLine = { role: "you" | "thread"; text: string; agentId?: string };
const THREAD_KEY = "cv-thread-log";

function loadThreadLog(): ThreadLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(THREAD_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function logLine(
  log: ThreadLine[],
  role: ThreadLine["role"],
  text: string,
  agentId?: string,
): ThreadLine[] {
  const next = [...log.slice(-60), { role, text, agentId }];
  try {
    localStorage.setItem(THREAD_KEY, JSON.stringify(next));
  } catch {
    /* storage full — keep it in memory */
  }
  return next;
}

/* --- automation guardrails (Deska model) ----------------------------------
 * Global policy for automated runs, persisted per client in localStorage.
 * An automation can opt out via `guardrailOverrides[id] = true` — its own
 * saved fields then win over the global picks. */

export type Guardrails = {
  /** How long an automation waits on an operator answer. */
  waitForAnswer: "15m" | "1h" | "4h" | "forever";
  /** What happens when the wait times out. */
  onNoAnswer: "safest" | "stop" | "proceed";
  /** Policy for commands the policy gate rejects. */
  onNotAllowed: "ask" | "deny";
  /** Silence threshold before the unresponsive action runs. */
  unresponsiveAfter: "15m" | "30m" | "1h";
  /** What happens to a hung run. */
  unresponsiveAction: "takeover" | "stop";
  /** Two automations due at once. */
  onRunCollision: "queue" | "skip";
  /** A scheduled run was due while the machine slept. */
  onComputerOff: "run-once" | "skip";
};

const DEFAULT_GUARDRAILS: Guardrails = {
  waitForAnswer: "1h",
  onNoAnswer: "safest",
  onNotAllowed: "ask",
  unresponsiveAfter: "30m",
  unresponsiveAction: "stop",
  onRunCollision: "queue",
  onComputerOff: "run-once",
};

const GUARDRAILS_KEY = "cv-guardrails";

function loadGuardrails(): { guardrails: Guardrails; overrides: Record<string, boolean> } {
  try {
    const v = JSON.parse(localStorage.getItem(GUARDRAILS_KEY) ?? "{}");
    return {
      guardrails: { ...DEFAULT_GUARDRAILS, ...(v.guardrails ?? {}) },
      overrides: v.overrides ?? {},
    };
  } catch {
    return { guardrails: { ...DEFAULT_GUARDRAILS }, overrides: {} };
  }
}

function saveGuardrails(guardrails: Guardrails, overrides: Record<string, boolean>) {
  try {
    localStorage.setItem(GUARDRAILS_KEY, JSON.stringify({ guardrails, overrides }));
  } catch {
    /* storage full — settings stay in memory */
  }
}

/** The 4-level permission ladder with its one-line descriptions — shown in
 * every picker that chooses a level (spawn bar, delegate, automations). */
export const PERMISSION_LEVELS = [
  { id: "supervised", label: "Supervised", hint: "approve every command + edit" },
  { id: "auto_accept", label: "Auto accept edits", hint: "edits apply silently, commands still ask" },
  { id: "auto", label: "Auto", hint: "agent decides, you review at the end" },
  { id: "full", label: "Full access", hint: "no prompts" },
] as const;

type BoardState = {
  connected: boolean;
  agents: Record<string, LiveAgent>;
  /** Latest terminal activity line per agent. Kept outside `agents` so a busy
   * terminal does not rewrite every agent object — and with it every canvas node. */
  activityLines: Record<string, string>;
  /** Board id → name (multiple canvases); "main" always exists. */
  boards: Record<string, string>;
  activeBoard: string;
  edges: Record<string, LiveEdge>;
  workspaces: Record<string, LiveWorkspace>;
  /** The board repo's origin (https) — powers the GitHub shortcuts. */
  repoUrl: string | null;
  cliIdentities: Record<string, { account?: string | null; model?: string | null; source?: string | null }>;
  /** Registered named CLI accounts (id → account). */
  accounts: Record<string, { account_id: string; cli: string; label: string }>;
  /** PTY bytes produced per usage key since this client connected — the
   * UsagePanel's "session" column. */
  sessionUse: Record<string, number>;
  /** Weekly usage ledger persisted in localStorage (see AcctLedger). */
  acctLedger: AcctLedger;
  /** Meter PTY output into the session + weekly buckets for the
   * agent's account; fires a toast at each weekly-cap threshold. */
  meterOutput: (agentId: string, n: number) => void;
  /** Ingest one PTY packet: fan out to live terminals immediately, batch the
   * rolling transcript mirror for React state. */
  receivePty: (agentId: string, bytes: Uint8Array) => void;
  /** Set a usage key's weekly cap in KB (null resets to the default). */
  setAcctCap: (key: string, kb: number | null) => void;
  /** node_id ("main" or a workspace id) → memory.md text. */
  memories: Record<string, string>;
  /** Last "lose nothing" digest markdown, when requested. */
  digest: string | null;
  /** Transient toast — latest info/error line shown bottom-right. */
  notice: string | null;
  notices: { id: number; text: string }[];
  /** Obsidian-style vault browser state. */
  vaultDir: string;
  vaultEntries: string[];
  repoEntries: string[];
  repoFile: { path: string; text: string } | null;
  repoFiles: Record<string, { dir: string; path: string; text: string }>;
  repoRequestDir: string;
  repoRequestPath: string;
  vaultFile: { path: string; text: string } | null;
  /** Latest vault full-text search hits. */
  vaultHits: { path: string; line: number; text: string }[];
  /** Obsidian vaults discovered on this machine (obsidian.json + markers). */
  vaultKnown: { name: string; path: string }[];
  /** Studio dossier markdown (Studios: repo → material). */
  studioDoc: string | null;
  /** Embedded web pages on the canvas: node id -> url, per board. */
  webNodes: Record<string, Record<string, string>>;
  /** Per-page canvas window dimensions, keyed by board and web node id. */
  webNodeSizes: Record<string, { w: number; h: number }>;
  resizeWebNode: (id: string, w: number, h: number, persist?: boolean, boardId?: string, pos?: { x: number; y: number }) => void;
  /** UI theme — swaps the seed tokens; glass derives via color-mix. */
  theme: string;
  setTheme: (t: string) => void;
  /** Artifacts by id — deliverables agents produced. */
  artifacts: Record<string, import("../daemon/client").SnapshotArtifact>;
  /** Kanban notes by id (all boards; filtered by activeBoard in UI). */
  notes: Record<string, { note_id: string; board_id: string; col: string; text: string; pos: number; due?: string }>;
  /** Saved node positions — replayed from the daemon's layout table. */
  positions: Record<string, { x: number; y: number }>;
  /** Per-agent size overrides for cards resized on the canvas. */
  agentSizes: Record<string, { w: number; h?: number }>;
  /** React Flow is the source of transient geometry while a resize gesture is active. */
  resizingAgents: Record<string, boolean>;
  markAgentResizing: (id: string, resizing: boolean) => void;
  resizeAgentCard: (id: string, w: number, h?: number, persist?: boolean, pos?: { x: number; y: number }) => void;
  /** Workspace frame dimensions are local UI state, keyed by workspace ID. */
  workspaceSizes: Record<string, { w: number; h: number }>;
  resizeWorkspace: (id: string, w: number, h: number, pos?: { x: number; y: number }) => void;
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
  /** `null` marks the beginning of a daemon scrollback replay after reconnect. */
  ptyListeners: Record<string, Set<(bytes: Uint8Array | null) => void>>;
  /** Rolling PTY scrollback per agent (~64KB) — transcript shown when a
   * terminal opens, and rebuilt from the daemon's replay on reconnect. */
  ptyBuffers: Record<string, Uint8Array>;
  /** Last known PTY size per agent (daemon default 80×24). */
  ptySize: Record<string, { cols: number; rows: number }>;
  connect: (token: string) => void;
  setActiveBoard: (boardId: string) => void;
  createBoard: (name: string) => void;
  /** Pending client-side board duplication — consumed by board_created. */
  pendingBoardCopy: { src: string } | null;
  duplicateBoard: () => void;
  moveToBoard: (nodeId: string, boardId: string) => void;
  renameNode: (nodeId: string, name: string) => void;
  renameBoard: (boardId: string, name: string) => void;
  deleteBoard: (boardId: string) => void;
  deleteEdge: (edgeId: string) => void;
  deleteWorkspace: (workspaceId: string) => void;
  /** agent_id → latest fetched unified diff text. */
  diffTexts: Record<string, string>;
  requestDiff: (agentId: string) => void;
  spawn: (name: string, command: string, workspaceId?: string, permission?: string, accountId?: string, initialInput?: string) => void;
  createAccount: (cli: string, label: string, env?: string) => void;
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
  dismissNotice: (id: number) => void;
  vaultList: (dir: string) => void;
  repoTree: (dir: string) => void;
  /** Directory the repo explorer opens to — set by per-agent file buttons. */
  explorerDir: string | null;
  openExplorer: (dir?: string) => void;
  repoRead: (dir: string, path: string) => void;
  repoWrite: (dir: string, path: string, text: string, baseText: string) => void;
  vaultRead: (path: string) => void;
  vaultPeek: (path: string) => void;
  vaultAsset: (path: string) => void;
  vaultSearch: (query: string) => void;
  vaultAppend: (path: string, text: string) => void;
  vaultWrite: (path: string, text: string) => void;
  vaultWriteAsset: (path: string, data: string, dir?: string) => void;
  vaultDelete: (path: string) => void;
  vaultRename: (path: string, newPath: string) => void;
  vaultGraphReq: () => void;
  vaultGraph: { nodes: string[]; edges: [string, string][] } | null;
  vaultDiscover: () => void;
  vaultRegister: (dir: string) => void;
  openObsidian: (path: string) => Promise<void>;
  closeVaultFile: () => void;
  webNodeAdd: (url: string) => void;
  webNodeRemove: (id: string) => void;
  /** Live markdown nodes — vault files pinned on the board, re-polled
   * so an agent editing the file shows up live on the card. */
  mdNodes: Record<string, Record<string, string>>;
  /** Per-note canvas card dimensions, keyed by Markdown node ID. */
  mdNodeSizes: Record<string, { w: number; h: number }>;
  resizeMdNode: (id: string, w: number, h: number, persist?: boolean, boardId?: string, pos?: { x: number; y: number }) => void;
  mdContents: Record<string, string>;
  /** Binary vault assets (images) as data URLs — filled by vault_asset. */
  vaultAssets: Record<string, string>;
  mdNodeAdd: (path: string, anchor?: string, at?: { x: number; y: number }) => void;
  mdNodeRemove: (id: string) => void;
  /** Tool panels living ON the canvas as nodes (Deska "Add to board") —
   * each renders the live panel UI inside a card: movable, resizable,
   * closable. Keyed per board; node id is `panel-<key>`. */
  panelNodes: Record<string, Record<string, { panel: string; x: number; y: number; w: number; h: number; collapsed?: boolean; expandH?: number; locked?: boolean; maximized?: boolean; prevRect?: { x: number; y: number; w: number; h: number } }>>;
  openPanelNode: (panel: string, pos?: { x: number; y: number }, size?: { w: number; h: number }) => void;
  closePanelNode: (id: string) => void;
  movePanelNode: (id: string, x: number, y: number) => void;
  resizePanelNode: (id: string, w: number, h: number, pos?: { x: number; y: number }) => void;
  collapsePanelNode: (id: string) => void;
  maximizePanelNode: (id: string, viewRect?: { x: number; y: number; w: number; h: number }) => void;
  /** Live terminals living ON the canvas as cards — `term-<agentId>` per
   * board. Popped out of the bottom drawer; movable/resizable/closable. */
  termNodes: Record<string, Record<string, { x: number; y: number; w: number; h: number; collapsed?: boolean; expandH?: number; locked?: boolean; maximized?: boolean; prevRect?: { x: number; y: number; w: number; h: number } }>>;
  /** Clone a panel card beside it (Deska Split Right/Down). */
  splitPanelCard: (id: string, dir: "right" | "down") => void;
  /** Deska card ops: z-order and position lock for canvas cards. */
  cardZ: Record<string, number>;
  toggleCardLock: (id: string) => void;
  bringCardToFront: (id: string) => void;
  sendCardToBack: (id: string) => void;
  /** Close every panel + term card on the active board. */
  closeAllCards: () => void;
  /** Set before spawning when the new agent should pop out as a term card
   * at this flow position (right-click "New terminal"). Consumed once. */
  pendingTermPos: { x: number; y: number } | null;
  setPendingTermPos: (p: { x: number; y: number } | null) => void;
  /** Same trick for the spawn chooser: right-click "New agent…" plants the
   * spawned card where the click landed. Consumed once. */
  /** Visible canvas rect in flow coords — synced from App's viewport so
   * position-dependent actions (pop-out, spawn) can clamp into view. */
  viewportRect: { left: number; top: number; right: number; bottom: number } | null;
  pendingSpawnPos: { x: number; y: number } | null;
  setPendingSpawnPos: (p: { x: number; y: number } | null) => void;
  pendingSpawnPositions: Record<string, { x: number; y: number }>;
  setSpawnPositionForName: (name: string, pos: { x: number; y: number }) => void;
  setAgentChain: (workspaceId: string, chain: string[]) => void;
  openTermNode: (agentId: string, pos?: { x: number; y: number }) => void;
  closeTermNode: (id: string) => void;
  moveTermNode: (id: string, x: number, y: number) => void;
  /** Move any client-side card (term-/panel-/shape-/md-/web-/orch-) to another board. */
  moveCardToBoard: (id: string, boardId: string) => void;
  resizeTermNode: (id: string, w: number, h: number, pos?: { x: number; y: number }) => void;
  collapseTermNode: (id: string) => void;
  maximizeTermNode: (id: string, viewRect?: { x: number; y: number; w: number; h: number }) => void;
  studioDocNow: () => void;
  closeStudioDoc: () => void;
  artifactDelete: (artifactId: string) => void;
  createWorkspace: (name: string, repo: string) => void;
  delegate: (from: string, name: string, command: string, task: string, permission?: string, position?: { x: number; y: number }, boardId?: string) => void;
  kill: (agentId: string) => void;
  /** Hand off a finished agent's work: spawn a same-CLI successor whose first
   * input is a brief (who it replaces, branch/files it left, tail of output). */
  handoff: (agentId: string, cli?: string) => void;
  approveInput: (agentId: string) => void;
  denyInput: (agentId: string) => void;
  /** Approve the held input AND lift the agent to "auto" so later
   * commands stop asking (Deska "always allow"). */
  approveAlways: (agentId: string) => void;
  setPermission: (agentId: string, permission: string) => void;
  /** Dismiss one automation alert row (or every alert with id "*"). */
  dismissAlert: (agentId: string) => void;
  /** Clear returned delegation rows from the inbox. */
  clearReturned: () => void;
  moveNode: (agentId: string, x: number, y: number, recordHistory?: boolean) => void;
  attachPty: (agentId: string, cb: (bytes: Uint8Array | null) => void) => void;
  ptyBuffer: (agentId: string) => Uint8Array | undefined;
  detachPty: (agentId: string, cb?: (bytes: Uint8Array | null) => void) => void;
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
  threadLog: ThreadLine[];
  threadSend: (text: string) => void;
  navRequest: { key: string; n: number } | null;
  edgeDetail: string | null;
  setEdgeDetail: (id: string | null) => void;
  /** Open counts the GitHub panels last fetched — shown as live facts in the Library rail. */
  ghCounts: { prs?: number; issues?: number };
  requestNav: (key: string) => void;
  /** Deska's "Show Panel Summaries" — hides each card's last line +
   * inline mini-terminal preview for a quieter board. */
  panelSummaries: boolean;
  togglePanelSummaries: () => void;
  /** Alignment snap mode — when on, a dropped card magnetically aligns
   * to another card's edge/center within a few px. Invisible (no guide
   * lines) and deliberately weak. Off by default: drags land exactly
   * where the pointer lets go. */
  snapAlign: boolean;
  toggleSnapAlign: () => void;
  /** Whether the spawn chooser is open (summoned by the orchestrator's
   * + or the rail's New Task — there is no permanent spawn button). */
  spawnOpen: boolean;
  setSpawnOpen: (v: boolean) => void;
  focusSpawn: () => void;
  /** Deska's "Gather loose windows into groups" — pulls every unwired,
   * unparented agent card into a tight grid and reframes the view. */
  gatherLoose: () => void;
  /** Snapshot of the last gather for undo — positions before the moves
   * plus the frame it created. */
  lastGather: { board: string; items: { id: string; kind: "agent" | "panel" | "term" | "md" | "web"; x: number; y: number }[]; frameId: string } | null;
  /** Cards currently flying because gather/undo moved them — the canvas adds
   * a temporary transform-transition class only to these nodes. */
  gatherMotion: { ids: string[]; token: number } | null;
  /** Group frames fading out before they are removed (undo gather). */
  leavingShapes: Record<string, true>;
  undoGather: () => void;
  /** Frame a board rect as a "Group N" region; returns its label. */
  frameNodes: (x: number, y: number, w: number, h: number) => string;
  /** Hide panels and menus — every chrome element (rails, topbar, spawn
   * bubble) collapses to a single restore button. */
  chromeHidden: boolean;
  toggleChrome: () => void;
  /** Bump counter → zoom the canvas in (1) or out (-1). */
  zoomN: { dir: number; n: number };
  /** Live canvas zoom percent (synced from the viewport) — the % readout. */
  zoomPct: number;
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
  /** Global automation guardrails + per-automation override flags. */
  guardrails: Guardrails;
  guardrailOverrides: Record<string, boolean>;
  setGuardrails: (patch: Partial<Guardrails>) => void;
  setGuardrailOverride: (automationId: string, on: boolean) => void;
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
  runLoop: (loopId: string) => void;
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
  /** Pin arbitrary content onto the canvas as a card (Deska's "Open in canvas"). */
  pinCard: (title: string, body: string, color?: string, anchor?: string, pos?: { x: number; y: number }) => void;
  /** nodeId -> panel key the card was pinned from (dashed anchor cable). */
  anchors: Record<string, Record<string, string>>;
  moveShape: (id: string, x: number, y: number) => void;
  updateShape: (id: string, patch: Partial<import("../board/types").ShapeDef>, persist?: boolean) => void;
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
let pendingActivity: Record<string, string> = {};
let activityFlush: ReturnType<typeof setTimeout> | null = null;

// PTY bytes are high-frequency input events, not UI state. Interactive
// terminals receive every chunk synchronously through ptyListeners; the
// zustand mirror used by previews/search/replays is flushed a few times per
// second so one burst does not translate into one React render per packet.
const PTY_STATE_FLUSH_MS = 150;
const pendingPtyChunks = new Map<string, Uint8Array[]>();
let ptyStateFlush: ReturnType<typeof setTimeout> | null = null;

function mergedPtyBytes(prev: Uint8Array | undefined, chunks: Uint8Array[]): Uint8Array {
  const pendingLength = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const merged = new Uint8Array((prev?.length ?? 0) + pendingLength);
  let offset = 0;
  if (prev) {
    merged.set(prev, 0);
    offset = prev.length;
  }
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged.length > 65_536 ? merged.subarray(merged.length - 65_536) : merged;
}

function flushPendingPtyState(get: () => BoardState, apply: (patch: Partial<BoardState>) => void) {
  if (ptyStateFlush) {
    clearTimeout(ptyStateFlush);
    ptyStateFlush = null;
  }
  if (pendingPtyChunks.size === 0) return;
  const ptyBuffers = { ...get().ptyBuffers };
  for (const [agentId, chunks] of pendingPtyChunks) {
    ptyBuffers[agentId] = mergedPtyBytes(ptyBuffers[agentId], chunks);
  }
  pendingPtyChunks.clear();
  apply({ ptyBuffers });
}

// Metering needs byte-accurate totals, not byte-accurate React state. Fold
// packets into a half-second ledger flush and keep transcript-replay skips in
// module memory (they are internal accounting state; nothing renders them).
const METER_FLUSH_MS = 500;
let pendingSessionUse: Record<string, number> = {};
let meterFlush: ReturnType<typeof setTimeout> | null = null;
const ptySkipBytes = new Map<string, number>();

const TOKEN = (import.meta.env.VITE_CANVAS_TOKEN as string | undefined) ??
  new URLSearchParams(location.search).get("token") ??
  "";

export const useBoard = create<BoardState>((set, get) => ({
  connected: false,
  agents: {},
  activityLines: {},
  boards: { main: "Main" },
  activeBoard: "main",
  edges: {},
  workspaces: {},
  repoUrl: null,
  cliIdentities: {},
  accounts: {},
  memories: {},
  digest: null,
  notice: null,
  notices: [],
  vaultDir: "",
  vaultEntries: [],
  repoEntries: [],
  repoFile: null,
  repoFiles: {},
  vaultFile: null,
  vaultHits: [],
  vaultKnown: [],
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
  webNodeSizes: (() => {
    try { return JSON.parse(localStorage.getItem("cv-webnodesizes") ?? "{}"); } catch { return {}; }
  })(),
  resizeWebNode: (id, w, h, persist = true, boardId = get().activeBoard, pos) => {
    const next = { ...get().webNodeSizes, [`${boardId}:${id}`]: { w: Math.max(320, w), h: Math.max(220, h) } };
    if (persist) localStorage.setItem("cv-webnodesizes", JSON.stringify(next));
    set({ webNodeSizes: next, ...(pos ? { positions: { ...get().positions, [id]: pos } } : {}) });
    if (persist && pos) client?.moveNode(id, pos.x, pos.y);
  },
  notes: {},
  artifacts: {},
  positions: {},
  agentSizes: (() => {
    try { return JSON.parse(localStorage.getItem("cv-agentsizes") ?? "{}"); } catch { return {}; }
  })(),
  resizingAgents: {},
  markAgentResizing: (id, resizing) => set((s) => {
    if (resizing) return { resizingAgents: { ...s.resizingAgents, [id]: true } };
    const next = { ...s.resizingAgents };
    delete next[id];
    return { resizingAgents: next };
  }),
  resizeAgentCard: (id, w, h, persist = true, pos) => {
    const next = { ...get().agentSizes, [id]: { w, h } };
    if (persist) localStorage.setItem("cv-agentsizes", JSON.stringify(next));
    set({ agentSizes: next, ...(pos ? { positions: { ...get().positions, [id]: pos } } : {}) });
    if (persist && pos) client?.moveNode(id, pos.x, pos.y);
  },
  workspaceSizes: (() => {
    try { return JSON.parse(localStorage.getItem("cv-workspacesizes") ?? "{}"); } catch { return {}; }
  })(),
  resizeWorkspace: (id, w, h, pos) => {
    const next = { ...get().workspaceSizes, [id]: { w: Math.max(520, w), h: Math.max(320, h) } };
    localStorage.setItem("cv-workspacesizes", JSON.stringify(next));
    set({ workspaceSizes: next, ...(pos ? { positions: { ...get().positions, [id]: pos } } : {}) });
    if (pos) client?.moveNode(id, pos.x, pos.y);
  },
  pendingPositions: {},
  approvals: {},
  termFont: (() => {
    const saved = Number(localStorage.getItem("cv-term-font"));
    return Number.isFinite(saved) && saved >= 9 && saved <= 22 ? saved : 13;
  })(),
  moveHistory: [],
  viewCmdN: 0,
  automations: {},
  loops: {},
  guardrails: loadGuardrails().guardrails,
  guardrailOverrides: loadGuardrails().overrides,
  attention: {},
  ptyListeners: {},
  ptyBuffers: {},
  ptySize: {},
  sessionUse: {},
  acctLedger: loadLedger(),

  connect: (token: string) => {
    const t = token || TOKEN;
    // A client whose socket already closed is dead weight — drop it so a
    // manual "connect" click (or the auto-reconnect timer) can retry.
    if (client && client.isClosed()) client = null;
    if (client || (!t && !isTauri())) return;
    const handlers = {
      onControl: (msg: ServerMsg) => {
        const { agents, edges } = get();
        switch (msg.type) {
          case "spawned": {
            // Chain fallback replacements arrive with "(fallback: cli)" in
            // the name — surface the substitution so a silent CLI swap never
            // goes unnoticed.
            if (msg.fallback_from) {
              const actual = (msg.command ?? "").split(/\s+/)[0];
              get().notify(`fallback: ${msg.fallback_from} failed at launch — spawned as ${actual}`);
            }
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
                  seenAt: Date.now(),
                  account_label: pendingAccts.get(msg.name) ?? null,
                  worktree: msg.worktree ?? undefined,
                },
              },
            });
            // A spawn that was asked for a canvas terminal card (right-click
            // "New terminal") pops out at the remembered spot.
            const pend = get().pendingTermPos;
            if (pend) {
              set({ pendingTermPos: null });
              get().openTermNode(msg.agent_id, pend);
            }
            const pSpawn = get().pendingSpawnPos;
            if (pSpawn) {
              set({ pendingSpawnPos: null });
              get().moveNode(msg.agent_id, pSpawn.x, pSpawn.y);
            }
            const namedSpawn = get().pendingSpawnPositions[msg.name];
            if (namedSpawn) {
              const pendingSpawnPositions = { ...get().pendingSpawnPositions };
              delete pendingSpawnPositions[msg.name];
              set({ pendingSpawnPositions });
              get().moveNode(msg.agent_id, namedSpawn.x, namedSpawn.y);
            }
            break;
          }
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
          case "board_created": {
            set({
              boards: { ...get().boards, [msg.board_id]: msg.name },
            });
            // duplicateBoard queued a client-side copy: clone the source
            // board's shapes/notes/panels/web cards into the new board.
            const dup = get().pendingBoardCopy;
            if (dup) {
              set({ pendingBoardCopy: null });
              const src = dup.src;
              const dst = msg.board_id;
              const clone = <T,>(all: Record<string, Record<string, T>>, key: string) => {
                const next = { ...all, [dst]: { ...(all[dst] ?? {}), ...(all[src] ?? {}) } };
                localStorage.setItem(key, JSON.stringify(next));
                return next;
              };
              const shapes = clone(get().shapes, "cv-shapes");
              const mdNodes = clone(get().mdNodes, "cv-mdnodes");
              const mdNodeSizes = { ...get().mdNodeSizes };
              for (const id of Object.keys(mdNodes[dst] ?? {})) {
                const size = mdNodeSizes[`${src}:${id}`] ?? mdNodeSizes[id];
                if (size) mdNodeSizes[`${dst}:${id}`] = { ...size };
              }
              localStorage.setItem("cv-mdnodesizes", JSON.stringify(mdNodeSizes));
              const panelNodes = clone(get().panelNodes, "cv-panelnodes");
              const webNodes = clone(get().webNodes, "cv-webnodes");
              // positions is a flat id → {x,y} map: copy the entries for the
              // cards we just cloned so they land in the same spots.
              const positions = { ...get().positions };
              for (const id of [
                ...Object.keys(shapes[dst] ?? {}),
                ...Object.keys(mdNodes[dst] ?? {}),
                ...Object.keys(panelNodes[dst] ?? {}),
                ...Object.keys(webNodes[dst] ?? {}),
              ]) {
                if (positions[id]) positions[id] = { ...positions[id] };
              }
              set({ shapes, mdNodes, mdNodeSizes, panelNodes, webNodes, positions });
              get().setActiveBoard(dst);
              get().notify(`board duplicated — cards copied (agents stay on ${get().boards[src] ?? src})`);
            }
            break;
          }
          case "node_renamed": {
            const a = get().agents[msg.node_id];
            const w = get().workspaces[msg.node_id];
            if (a) {
              set({ agents: { ...get().agents, [msg.node_id]: { ...a, name: msg.name } } });
            } else if (w) {
              set({ workspaces: { ...get().workspaces, [msg.node_id]: { ...w, name: msg.name } } });
            }
            break;
          }
          case "board_renamed":
            set({ boards: { ...get().boards, [msg.board_id]: msg.name } });
            break;
          case "board_deleted": {
            const boards = { ...get().boards };
            delete boards[msg.board_id];
            const patch: Partial<BoardState> = { boards };
            if (get().activeBoard === msg.board_id) patch.activeBoard = "main";
            set(patch);
            break;
          }
          case "diff_detail":
            set({ diffTexts: { ...get().diffTexts, [msg.agent_id]: msg.diff } });
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
              // Coalesce bursts — a busy agent can emit a line every few ms;
              // one store write per 400ms keeps the board fluid.
              pendingActivity[msg.agent_id] = msg.line;
              if (!activityFlush) {
                activityFlush = setTimeout(() => {
                  activityFlush = null;
                  const batch = pendingActivity;
                  pendingActivity = {};
                  const curLines = get().activityLines;
                  let linesChanged = false;
                  const activityLines = { ...curLines };
                  let attentionChanged = false;
                  const attention = { ...get().attention };
                  for (const [aid, line] of Object.entries(batch)) {
                    if (!get().agents[aid]) continue;
                    if (activityLines[aid] !== line) {
                      activityLines[aid] = line;
                      linesChanged = true;
                    }
                    if (attention[aid]) {
                      delete attention[aid];
                      attentionChanged = true;
                    }
                  }
                  const patch: Partial<BoardState> = {};
                  if (linesChanged) patch.activityLines = activityLines;
                  if (attentionChanged) patch.attention = attention;
                  if (Object.keys(patch).length > 0) set(patch);
                }, 400);
              }
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
          case "needs_approval": {
            set({ approvals: { ...get().approvals, [msg.agent_id]: msg.line } });
            const name = get().agents[msg.agent_id]?.name ?? msg.agent_id;
            sysNotify(`${name} needs approval`, msg.line, msg.agent_id);
            break;
          }
          case "permission_changed": {
            const a = get().agents;
            if (a[msg.agent_id]) {
              set({ agents: { ...a, [msg.agent_id]: { ...a[msg.agent_id], permission: msg.permission } } });
            }
            break;
          }
          case "delegation_removed": {
            set((st) => {
              const edges = { ...st.edges };
              delete edges[msg.edge_id];
              return { edges, edgeDetail: st.edgeDetail === msg.edge_id ? null : st.edgeDetail };
            });
            break;
          }
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
              const to = get().agents[edge.to]?.name ?? edge.to;
              sysNotify(`${to} returned`, msg.summary ?? "delegation done", edge.to);
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
          case "delegation_failed": {
            const edge = edges[msg.edge_id];
            if (edge) {
              set({
                edges: {
                  ...edges,
                  [msg.edge_id]: { ...edge, state: "failed" },
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
                  restored: true,
                  files: a.files ?? 0,
                  paths: a.paths ?? [],
                  branch: a.branch ?? undefined,
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
                { id: w.workspace_id, name: w.name, repo: w.repo, board_id: w.board_id ?? "main", agent_chain: w.agent_chain ?? null },
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
            // Drop canvas terminal cards whose agent no longer exists
            // (killed server-side) — a card would show a dead shell.
            const termNodes = { ...get().termNodes };
            let tnTouched = false;
            for (const [boardId, m] of Object.entries(termNodes)) {
              for (const id of Object.keys(m)) {
                if (id.startsWith("term-") && !agents[id.slice(5)]) {
                  const c = { ...m };
                  delete c[id];
                  termNodes[boardId] = c;
                  tnTouched = true;
                }
              }
            }
            if (tnTouched) localStorage.setItem("cv-termnodes", JSON.stringify(termNodes));
            // A reconnect replays each live PTY's rolling tail. Clear that
            // session's old xterm and preview first so the replay rebuilds
            // them once instead of appending duplicate history. Exited-agent
            // transcripts are requested separately when their view mounts.
            const ptyBuffers = { ...get().ptyBuffers };
            ptySkipBytes.clear();
            for (const a of msg.agents) {
              ptySkipBytes.set(a.agent_id, replayedPtyBytes(a.output_bytes));
              if (a.status === "exited") continue;
              pendingPtyChunks.delete(a.agent_id);
              delete ptyBuffers[a.agent_id];
              resetScreen(a.agent_id);
              get().ptyListeners[a.agent_id]?.forEach((cb) => cb(null));
            }
            set({
              agents,
              ptyBuffers,
              positions,
              edges,
              workspaces,
              approvals: msg.approvals ?? {},
              repoUrl: msg.repo_url ?? null,
              cliIdentities: msg.cli_identities ?? {},
              automations,
              loops,
              boards: { main: "Main", ...boards },
              accounts,
              notes,
              artifacts,
              ...(tnTouched ? { termNodes } : {}),
            });
            // Deep link: ?board=<id> opens straight into that board once
            // the snapshot has landed (name or id both accepted).
            const want = new URLSearchParams(location.search).get("board");
            if (want) {
              const all = { main: "Main", ...boards };
              const hit =
                Object.keys(all).find((id) => id === want) ??
                Object.entries(all).find(([, n]) => n.toLowerCase() === want.toLowerCase())?.[0];
              if (hit && hit !== get().activeBoard) set({ activeBoard: hit });
            }
            break;
          }
          case "studio_doc_md":
            set({ studioDoc: msg.text });
            break;
          case "vault_listing":
            set({ vaultEntries: msg.entries });
            break;
          case "repo_listing":
            // Ignore late replies from a previous repo after the user has
            // switched the Explorer. Otherwise stale files can appear under
            // the newly selected workspace.
            if (msg.dir === get().repoRequestDir) set({ repoEntries: msg.entries });
            break;
          case "repo_file":
            set((s) => ({ repoFiles: { ...s.repoFiles, [`${msg.dir}\u0000${msg.path}`]: { dir: msg.dir, path: msg.path, text: msg.text } } }));
            if (msg.dir === get().repoRequestDir && msg.path === get().repoRequestPath) {
              set({ repoFile: { path: msg.path, text: msg.text } });
            }
            break;
          case "vault_hits":
            set({ vaultHits: msg.hits });
            break;
          case "vault_graph":
            set({ vaultGraph: { nodes: msg.nodes, edges: msg.edges } });
            break;
          case "vault_discovered":
            set({ vaultKnown: msg.vaults });
            break;
          case "vault_file":
            set({
              vaultFile: { path: msg.path, text: msg.text },
              mdContents: { ...get().mdContents, [msg.path]: msg.text },
            });
            break;
          case "vault_peeked":
            set({ mdContents: { ...get().mdContents, [msg.path]: msg.text } });
            break;
          case "vault_asset_data":
            set({ vaultAssets: { ...get().vaultAssets, [msg.path]: `data:${msg.mime};base64,${msg.data}` } });
            break;
          case "git_pushed": {
            get().notify(`pushed — ${msg.output || "done"}`);
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
              accounts: { ...s.accounts, [msg.account_id]: { account_id: msg.account_id, cli: msg.cli, label: msg.label, env: msg.env ?? null } },
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
            get().notify(`error — ${msg.message}`);
            console.error("[canvasd]", msg.message);
            break;
          default:
            break;
        }
      },
      onPty: (agentId: string, bytes: Uint8Array) => {
        get().receivePty(agentId, bytes);
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
    void client.whenOpen().then(() => {
      set({ connected: true });
      // Re-mount the saved vault after (re)connect — a vaultList() sent
      // before the socket opens would be silently dropped.
      const dir = get().vaultDir || (() => {
        try { return localStorage.getItem("cv-vault-dir") ?? ""; } catch { return ""; }
      })();
      if (dir) {
        get().vaultList(dir);
      } else {
        // First run on Tauri: auto-mount the user's real vault
        // (~/Documents/Orkelya-Memory when it exists).
        void client?.defaultVaultDir?.().then((d) => {
          if (d && !get().vaultDir) get().vaultList(d);
        });
      }
      // Offer the vaults the real Obsidian install already registered.
      client?.vaultDiscover();
    });
  },

  setActiveBoard: (boardId) => {
    set({ activeBoard: boardId });
    try {
      const u = new URL(location.href);
      u.searchParams.set("board", boardId);
      history.replaceState(null, "", u);
    } catch { /* file:// or odd embeds */ }
  },

  createBoard: (name) => {
    if (!client) { get().notify("daemon offline"); return; }
    client.createBoard(name);
  },

  pendingBoardCopy: null,
  duplicateBoard: () => {
    if (!client) { get().notify("daemon offline"); return; }
    const src = get().activeBoard;
    set({ pendingBoardCopy: { src } });
    client.createBoard(`${get().boards[src] ?? src} copy`);
  },

  moveToBoard: (nodeId, boardId) => {
    if (!client) { get().notify("daemon offline"); return; }
    client.moveToBoard(nodeId, boardId);
  },

  renameNode: (nodeId, name) => {
    if (!client) { get().notify("daemon offline"); return; }
    client.renameNode(nodeId, name);
  },
  renameBoard: (boardId, name) => {
    if (!client) { get().notify("daemon offline"); return; }
    client.renameBoard(boardId, name);
  },
  deleteBoard: (boardId) => client?.deleteBoard(boardId),
  deleteEdge: (edgeId) => client?.deleteDelegation(edgeId),
  deleteWorkspace: (workspaceId) => client?.deleteWorkspace(workspaceId),
  diffTexts: {},
  requestDiff: (agentId) => client?.diffDetail(agentId),

  spawn: (name, command, workspaceId, permission, accountId, initialInput) => {
    if (!client) {
      get().notify("daemon offline — can't spawn; reconnect and try again");
      return;
    }
    const acct = accountId ? get().accounts[accountId] : null;
    if (acct) pendingAccts.set(name, acct.label);
    else pendingAccts.delete(name);
    client.spawnAgent(name, command, ".", workspaceId, permission, get().activeBoard, accountId, initialInput);
  },

  createAccount: (cli, label, env) => client?.createAccount(cli, label, env),
  deleteAccount: (accountId) => client?.deleteAccount(accountId),

  receivePty: (agentId, bytes) => {
    const chunks = pendingPtyChunks.get(agentId) ?? [];
    chunks.push(bytes);
    pendingPtyChunks.set(agentId, chunks);
    if (!ptyStateFlush) {
      ptyStateFlush = setTimeout(() => {
        ptyStateFlush = null;
        flushPendingPtyState(get, (patch) => set(patch));
      }, PTY_STATE_FLUSH_MS);
    }
    get().ptyListeners[agentId]?.forEach((cb) => cb(bytes));
    get().meterOutput(agentId, bytes.length);
  },

  meterOutput: (agentId, n) => {
    const a = get().agents[agentId];
    // Exited agents only emit transcript replays — not new work.
    if (!a || a.status === "exited" || n <= 0) return;
    // (Re)connect replays each running agent's scrollback through onPty
    // before live bytes — skip up to its transcript size so history
    // doesn't double-count toward usage.
    const skip = ptySkipBytes.get(agentId) ?? 0;
    if (skip > 0) {
      const rest = Math.max(0, n - skip);
      ptySkipBytes.set(agentId, Math.max(0, skip - n));
      if (rest === 0) return;
      n = rest;
    }
    const key = agentAcctKey(a, Object.values(get().accounts));
    pendingSessionUse[key] = (pendingSessionUse[key] ?? 0) + n;
    if (meterFlush) return;
    meterFlush = setTimeout(() => {
      meterFlush = null;
      const pending = pendingSessionUse;
      pendingSessionUse = {};
      const ledger = get().acctLedger;
      // Roll the bucket when the ISO week changed under a running session.
      const l = ledger.week === isoWeek() ? ledger : { ...ledger, week: isoWeek(), bytes: {}, fired: {} };
      const bytes = { ...l.bytes };
      const fired = { ...l.fired };
      const sessionUse = { ...get().sessionUse };
      const notifications: string[] = [];
      for (const [usageKey, count] of Object.entries(pending)) {
        const weekBytes = (bytes[usageKey] ?? 0) + count;
        bytes[usageKey] = weekBytes;
        sessionUse[usageKey] = (sessionUse[usageKey] ?? 0) + count;
        const capKb = l.caps[usageKey] ?? DEFAULT_WEEK_CAP_KB;
        const pct = (weekBytes / 1024 / capKb) * 100;
        // Fire the highest unmet milestone and mark everything below it too —
        // a burst that jumps 15%→60% toasts "50%" once, not four times.
        let mask = fired[usageKey] ?? 0;
        for (let i = WEEK_MILESTONES.length - 1; i >= 0; i--) {
          if (pct >= WEEK_MILESTONES[i] && !(mask & (1 << i))) {
            mask |= (2 << i) - 1; // this milestone and every one below it
            fired[usageKey] = mask;
            notifications.push(`${acctLabel(usageKey)} hit ${WEEK_MILESTONES[i]}% of the week`);
            break;
          }
        }
      }
      const next: AcctLedger = { ...l, bytes, fired };
      saveLedger(next);
      set({ acctLedger: next, sessionUse });
      notifications.forEach((text) => get().notify(text));
    }, METER_FLUSH_MS);
  },
  setAcctCap: (key, kb) => {
    const l = { ...get().acctLedger, caps: { ...get().acctLedger.caps } };
    if (kb == null || !(kb > 0)) delete l.caps[key];
    else l.caps[key] = Math.round(kb);
    saveLedger(l, true);
    set({ acctLedger: l });
  },
  memoryRead: (nodeId) => client?.memoryRead(nodeId),
  digestNow: () => client?.digest(),
  closeDigest: () => set({ digest: null }),
  noteUpsert: (noteId, col, text, pos, due) =>
    client?.noteUpsert(noteId, get().activeBoard ?? undefined, col, text, pos, due),
  noteDelete: (noteId) => client?.noteDelete(noteId),
  gitPush: (agentId) => {
    if (!client) { get().notify("daemon offline"); return; }
    client.gitPush(agentId);
  },
  notify: (text) =>
    set((s) => ({
      notice: text,
      notices: text
        ? [...s.notices, { id: (s.notices[s.notices.length - 1]?.id ?? 0) + 1, text }].slice(-4)
        : s.notices,
    })),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  vaultList: (dir) => {
    set({ vaultDir: dir });
    try { localStorage.setItem("cv-vault-dir", dir); } catch { /* noop */ }
    client?.vaultList(dir);
  },
  explorerDir: null,
  repoRequestDir: "",
  repoRequestPath: "",
  openExplorer: (dir) => {
    if (dir) set({ explorerDir: dir });
    const board = get().activeBoard;
    const exists = get().panelNodes[board]?.["panel-explorer"];
    if (exists) get().requestFocus("panel-explorer");
    else get().openPanelNode("explorer");
  },
  repoTree: (dir) => {
    set({ repoRequestDir: dir, repoRequestPath: "", repoEntries: [], repoFile: null });
    client?.repoTree(dir);
  },
  repoRead: (dir, path) => {
    set({ repoRequestDir: dir, repoRequestPath: path, repoFile: null });
    client?.repoRead(dir, path);
  },
  repoWrite: (dir, path, text, baseText) => {
    set({ notice: null });
    client?.repoWrite(dir, path, text, baseText);
  },
  vaultRead: (path) => client?.vaultRead(get().vaultDir, path),
  vaultPeek: (path) => client?.vaultPeek(get().vaultDir, path),
  vaultAsset: (path) => client?.vaultAsset(get().vaultDir, path),
  vaultAppend: (path, text) => client?.vaultAppend(get().vaultDir, path, text),
  vaultWrite: (path, text) => client?.vaultWrite(get().vaultDir, path, text),
  vaultWriteAsset: (path, data, dir) => {
    const d = dir ?? get().vaultDir;
    if (!d) return; // no vault open — never let the daemon write into its cwd
    client?.vaultWriteAsset(d, path, data);
  },
  vaultDelete: (path) => client?.vaultDelete(get().vaultDir, path),
  vaultRename: (path, newPath) => client?.vaultRename(get().vaultDir, path, newPath),
  vaultGraphReq: () => client?.vaultGraph(get().vaultDir),
  vaultGraph: null,
  vaultSearch: (query) => client?.vaultSearch(get().vaultDir, query),
  vaultDiscover: () => client?.vaultDiscover(),
  vaultRegister: (dir) => client?.vaultRegister(dir),
  openObsidian: async (path) => {
    const vaultDir = get().vaultDir;
    if (!client || !vaultDir) {
      get().notify("Open a vault before launching Obsidian.");
      return;
    }
    try {
      await client.openObsidian(vaultDir, path);
      get().notify("Opened the note in Obsidian.");
    } catch (error) {
      get().notify(error instanceof Error ? error.message : String(error));
    }
  },
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
    client?.moveNode(id, 300 + Math.random() * 200, 140 + Math.random() * 160);
    get().requestFocus(id);
  },
  webNodeRemove: (id) => {
    const board = get().activeBoard;
    set((st) => {
      const m = { ...(st.webNodes[board] ?? {}) };
      delete m[id];
      return { webNodes: { ...st.webNodes, [board]: m } };
    });
    localStorage.setItem("cv-webnodes", JSON.stringify(get().webNodes));
    const sizeKey = `${board}:${id}`;
    const sizes = { ...get().webNodeSizes };
    delete sizes[sizeKey];
    localStorage.setItem("cv-webnodesizes", JSON.stringify(sizes));
    set({ webNodeSizes: sizes });
  },

  mdNodes: (() => {
    try { return JSON.parse(localStorage.getItem("cv-mdnodes") ?? "{}"); } catch { return {}; }
  })(),
  mdNodeSizes: (() => {
    try { return JSON.parse(localStorage.getItem("cv-mdnodesizes") ?? "{}"); } catch { return {}; }
  })(),
  resizeMdNode: (id, w, h, persist = true, boardId = get().activeBoard, pos) => {
    const next = { ...get().mdNodeSizes, [`${boardId}:${id}`]: { w: Math.max(260, w), h: Math.max(180, h) } };
    if (persist) localStorage.setItem("cv-mdnodesizes", JSON.stringify(next));
    set({ mdNodeSizes: next, ...(pos ? { positions: { ...get().positions, [id]: pos } } : {}) });
    if (persist && pos) client?.moveNode(id, pos.x, pos.y);
  },
  panelNodes: (() => {
    try { return JSON.parse(localStorage.getItem("cv-panelnodes") ?? "{}"); } catch { return {}; }
  })(),
  openPanelNode: (panel, pos, size) => {
    const board = get().activeBoard;
    const id = `panel-${panel}`;
    const existing = get().panelNodes[board]?.[id];
    if (existing) { get().requestFocus(id); return; }
    const meta = PANEL_META[panel];
    const def = size ?? { w: meta?.w ?? 340, h: meta?.h ?? 440 };
    const m = { ...(get().panelNodes[board] ?? {}), [id]: { panel, x: pos?.x ?? 380 + Math.random() * 120, y: pos?.y ?? 140 + Math.random() * 80, ...def } };
    const next = { ...get().panelNodes, [board]: m };
    localStorage.setItem("cv-panelnodes", JSON.stringify(next));
    set({ panelNodes: next });
    get().bringCardToFront(id);
  },
  closePanelNode: (id) => {
    const board = get().activeBoard;
    const m = { ...(get().panelNodes[board] ?? {}) };
    delete m[id];
    const next = { ...get().panelNodes, [board]: m };
    localStorage.setItem("cv-panelnodes", JSON.stringify(next));
    set({ panelNodes: next });
  },
  movePanelNode: (id, x, y) => {
    const board = get().activeBoard;
    const n = get().panelNodes[board]?.[id];
    if (!n) return;
    const next = { ...get().panelNodes, [board]: { ...get().panelNodes[board], [id]: { ...n, x, y } } };
    localStorage.setItem("cv-panelnodes", JSON.stringify(next));
    set({ panelNodes: next });
  },
  resizePanelNode: (id, w, h, pos) => {
    const board = get().activeBoard;
    const n = get().panelNodes[board]?.[id];
    if (!n) return;
    // PANEL_META minimums are a hard floor — a card smaller than its content
    // minimum renders a broken, unusable panel.
    const meta = PANEL_META[n.panel];
    const cw = Math.max(w, meta?.minW ?? 0);
    const ch = Math.max(h, meta?.minH ?? 0);
    const next = { ...get().panelNodes, [board]: { ...get().panelNodes[board], [id]: { ...n, ...(pos ?? {}), w: cw, h: ch } } };
    localStorage.setItem("cv-panelnodes", JSON.stringify(next));
    set({ panelNodes: next });
  },
  collapsePanelNode: (id) => {
    const board = get().activeBoard;
    const n = get().panelNodes[board]?.[id];
    if (!n) return;
    // Collapse to the title bar, remembering the expanded height to restore.
    const m = n.collapsed
      ? { ...n, collapsed: false, h: n.expandH ?? n.h }
      : { ...n, collapsed: true, expandH: n.h, h: 34 };
    const next = { ...get().panelNodes, [board]: { ...get().panelNodes[board], [id]: m } };
    localStorage.setItem("cv-panelnodes", JSON.stringify(next));
    set({ panelNodes: next });
  },
  maximizePanelNode: (id, viewRect) => {
    const board = get().activeBoard;
    const n = get().panelNodes[board]?.[id];
    if (!n) return;
    // Deska's maximize: fill the viewport; click again and the card goes
    // back to exactly the rect it floated at before.
    const m = n.maximized
      ? { ...n, maximized: false, ...(n.prevRect ?? {}) }
      : {
          ...n,
          maximized: true,
          collapsed: false,
          // Restore to the expanded height — a collapsed card stores only
          // its 34px title bar in h, the real height lives in expandH.
          prevRect: { x: n.x, y: n.y, w: n.w, h: n.collapsed ? n.expandH ?? n.h : n.h },
          ...(viewRect ?? {}),
        };
    const next = { ...get().panelNodes, [board]: { ...get().panelNodes[board], [id]: m } };
    localStorage.setItem("cv-panelnodes", JSON.stringify(next));
    set({ panelNodes: next });
  },
  termNodes: (() => {
    try { return JSON.parse(localStorage.getItem("cv-termnodes") ?? "{}"); } catch { return {}; }
  })(),
  pendingTermPos: null,
  setPendingTermPos: (p) => set({ pendingTermPos: p }),
  viewportRect: null,
  lastGather: null,
  gatherMotion: null,
  leavingShapes: {},
  pendingSpawnPos: null,
  setPendingSpawnPos: (p) => set({ pendingSpawnPos: p }),
  pendingSpawnPositions: {},
  setSpawnPositionForName: (name, pos) => set((s) => ({ pendingSpawnPositions: { ...s.pendingSpawnPositions, [name]: pos } })),
  setAgentChain: (workspaceId, chain) => {
    const ws = get().workspaces[workspaceId];
    if (!ws) return;
    set({ workspaces: { ...get().workspaces, [workspaceId]: { ...ws, agent_chain: chain } } });
    client?.setAgentChain(workspaceId, chain);
  },
  openTermNode: (agentId, pos) => {
    const board = get().activeBoard;
    const id = `term-${agentId}`;
    const existing = get().termNodes[board]?.[id];
    if (existing) { get().requestFocus(id); return; }
    // Default spot: just right of the agent's own card so the popped-out
    // terminal lands next to what it belongs to.
    const ap = get().positions[agentId];
    let fx = pos?.x ?? (ap ? ap.x + 360 : 420 + Math.random() * 140);
    let fy = pos?.y ?? (ap ? ap.y : 160 + Math.random() * 90);
    // Pop-out must stay visible: an agent parked near the right edge would
    // otherwise push its 560px terminal card offscreen. Flip left of the
    // card first, then clamp into the visible rect.
    const vp = get().viewportRect;
    if (vp && !pos) {
      if (fx + 560 > vp.right - 16 && ap) fx = ap.x - 560 - 24;
      fx = Math.min(Math.max(fx, vp.left + 16), Math.max(vp.left + 16, vp.right - 560 - 16));
      fy = Math.min(Math.max(fy, vp.top + 16), Math.max(vp.top + 16, vp.bottom - 320 - 16));
    }
    const m = { ...(get().termNodes[board] ?? {}), [id]: { x: fx, y: fy, w: 560, h: 320 } };
    const next = { ...get().termNodes, [board]: m };
    localStorage.setItem("cv-termnodes", JSON.stringify(next));
    set({ termNodes: next });
    get().bringCardToFront(id);
  },
  closeTermNode: (id) => {
    const board = get().activeBoard;
    const m = { ...(get().termNodes[board] ?? {}) };
    delete m[id];
    const next = { ...get().termNodes, [board]: m };
    localStorage.setItem("cv-termnodes", JSON.stringify(next));
    set({ termNodes: next });
  },
  moveTermNode: (id, x, y) => {
    const board = get().activeBoard;
    const n = get().termNodes[board]?.[id];
    if (!n) return;
    const next = { ...get().termNodes, [board]: { ...get().termNodes[board], [id]: { ...n, x, y } } };
    localStorage.setItem("cv-termnodes", JSON.stringify(next));
    set({ termNodes: next });
  },
  resizeTermNode: (id, w, h, pos) => {
    const board = get().activeBoard;
    const n = get().termNodes[board]?.[id];
    if (!n) return;
    const next = { ...get().termNodes, [board]: { ...get().termNodes[board], [id]: { ...n, ...(pos ?? {}), w, h } } };
    localStorage.setItem("cv-termnodes", JSON.stringify(next));
    set({ termNodes: next });
  },
  collapseTermNode: (id) => {
    const board = get().activeBoard;
    const n = get().termNodes[board]?.[id];
    if (!n) return;
    const m = n.collapsed
      ? { ...n, collapsed: false, h: n.expandH ?? n.h }
      : { ...n, collapsed: true, expandH: n.h, h: 34 };
    const next = { ...get().termNodes, [board]: { ...get().termNodes[board], [id]: m } };
    localStorage.setItem("cv-termnodes", JSON.stringify(next));
    set({ termNodes: next });
  },
  maximizeTermNode: (id, viewRect) => {
    const board = get().activeBoard;
    const n = get().termNodes[board]?.[id];
    if (!n) return;
    const m = n.maximized
      ? { ...n, maximized: false, ...(n.prevRect ?? {}) }
      : {
          ...n,
          maximized: true,
          collapsed: false,
          prevRect: { x: n.x, y: n.y, w: n.w, h: n.collapsed ? n.expandH ?? n.h : n.h },
          ...(viewRect ?? {}),
        };
    const next = { ...get().termNodes, [board]: { ...get().termNodes[board], [id]: m } };
    localStorage.setItem("cv-termnodes", JSON.stringify(next));
    set({ termNodes: next });
  },
  splitPanelCard: (id, dir) => {
    const board = get().activeBoard;
    const n = get().panelNodes[board]?.[id];
    if (!n) return;
    let i = 2;
    let newId = `${id}-${i}`;
    while (get().panelNodes[board]?.[newId]) newId = `${id}-${++i}`;
    const off = dir === "right" ? { x: n.x + n.w + 16, y: n.y } : { x: n.x, y: n.y + n.h + 16 };
    // Never clone the maximize bookkeeping: two cards sharing one
    // prevRect would restore onto the exact same spot.
    const { maximized: _mx, prevRect: _pr, ...rest } = n;
    const m = { ...(get().panelNodes[board] ?? {}), [newId]: { ...rest, ...off } };
    const next = { ...get().panelNodes, [board]: m };
    localStorage.setItem("cv-panelnodes", JSON.stringify(next));
    set({ panelNodes: next });
    get().requestFocus(newId);
  },
  cardZ: (() => {
    try { return JSON.parse(localStorage.getItem("cv-cardz") ?? "{}"); } catch { return {}; }
  })(),
  toggleCardLock: (id) => {
    const board = get().activeBoard;
    const map = id.startsWith("panel-") ? "panelNodes" : id.startsWith("term-") ? "termNodes" : null;
    if (!map) return;
    const n = (get() as never as Record<string, Record<string, Record<string, { locked?: boolean }>>>)[map][board]?.[id];
    if (!n) return;
    const next = { ...(get() as never as Record<string, Record<string, Record<string, { locked?: boolean }>>>)[map],
      [board]: { ...(get() as never as Record<string, Record<string, Record<string, { locked?: boolean }>>>)[map][board], [id]: { ...n, locked: !n.locked } } };
    localStorage.setItem(`cv-${map === "panelNodes" ? "panelnodes" : "termnodes"}`, JSON.stringify(next));
    set({ [map]: next } as Partial<BoardState>);
    get().notify(n.locked ? "card unlocked" : "card locked in place");
  },
  bringCardToFront: (id) => {
    const z = Math.max(0, ...Object.values(get().cardZ)) + 1;
    const next = { ...get().cardZ, [id]: z };
    localStorage.setItem("cv-cardz", JSON.stringify(next));
    set({ cardZ: next });
  },
  sendCardToBack: (id) => {
    const z = Math.min(0, ...Object.values(get().cardZ)) - 1;
    const next = { ...get().cardZ, [id]: z };
    localStorage.setItem("cv-cardz", JSON.stringify(next));
    set({ cardZ: next });
  },
  closeAllCards: () => {
    const board = get().activeBoard;
    const m = { ...get().panelNodes, [board]: {} };
    const tm = { ...get().termNodes, [board]: {} };
    localStorage.setItem("cv-panelnodes", JSON.stringify(m));
    localStorage.setItem("cv-termnodes", JSON.stringify(tm));
    set({ panelNodes: m, termNodes: tm });
  },
  /** Move a client-side card (term- / panel- / shape- / md- / web- / orch-)
   * to another board: relocate its entry in the per-board map and switch
   * to that board so the drop is visible. */
  moveCardToBoard: (id, boardId) => {
    const board = get().activeBoard;
    const move = <T,>(all: Record<string, Record<string, T>>, key: string) => {
      const item = all[board]?.[id];
      if (!item) return all;
      const src = { ...(all[board] ?? {}) };
      delete src[id];
      // Singleton cards (panels, terms) may already exist on the destination
      // board with their own carefully-arranged layout — dropping a second
      // copy must not clobber it. Keep the destination card; the source
      // copy simply closes.
      const dst = all[boardId]?.[id]
        ? (all[boardId] ?? {})
        : { ...(all[boardId] ?? {}), [id]: item };
      const next = { ...all, [board]: src, [boardId]: dst };
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    };
    const prefix = id.slice(0, id.indexOf("-") + 1);
    if (prefix === "term-") set({ termNodes: move(get().termNodes, "cv-termnodes") });
    else if (prefix === "panel-") set({ panelNodes: move(get().panelNodes, "cv-panelnodes") });
    else if (prefix === "shape-") set({ shapes: move(get().shapes, "cv-shapes") });
    else if (prefix === "md-") set({ mdNodes: move(get().mdNodes, "cv-mdnodes") });
    else if (prefix === "web-") set({ webNodes: move(get().webNodes, "cv-webnodes") });
    else if (prefix === "orch-") {
      const orch = get().orchestrators[id];
      if (!orch) return;
      const orchestrators = { ...get().orchestrators, [id]: { ...orch, board: boardId } };
      localStorage.setItem("canvas:orchestrators", JSON.stringify(orchestrators));
      set({ orchestrators });
    }
    else return;
    get().setActiveBoard(boardId);
    get().requestFocus(id);
  },
  mdContents: {},
  vaultAssets: {},
  anchors: (() => {
    try { return JSON.parse(localStorage.getItem("cv-anchors") ?? "{}"); } catch { return {}; }
  })(),
  mdNodeAdd: (path, anchor, at) => {
    const board = get().activeBoard;
    const existing = Object.entries(get().mdNodes[board] ?? {}).find(([, notePath]) => notePath === path)?.[0];
    if (existing) {
      get().requestFocus(existing);
      return;
    }
    const id = `md-${Math.random().toString(16).slice(2, 10)}`;
    const next = { ...get().mdNodes, [board]: { ...(get().mdNodes[board] ?? {}), [id]: path } };
    localStorage.setItem("cv-mdnodes", JSON.stringify(next));
    if (anchor) {
      const a = { ...get().anchors, [board]: { ...(get().anchors[board] ?? {}), [id]: anchor } };
      localStorage.setItem("cv-anchors", JSON.stringify(a));
      set({ anchors: a });
    }
    set({ mdNodes: next });
    client?.moveNode(id, at?.x ?? 300 + Math.random() * 200, at?.y ?? 140 + Math.random() * 160);
    client?.vaultRead(get().vaultDir, path);
    // Pinning a note is an explicit user action — the card must surface
    // above the board instead of landing underneath existing agent cards,
    // same as panel/term cards already do.
    get().bringCardToFront(id);
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

  kill: (agentId) => {
    if (!client) { get().notify("daemon offline"); return; }
    client.confirmDestructive(agentId, "kill");
  },

  handoff: (agentId, cli) => {
    const a = get().agents[agentId];
    if (!a) return;
    const buf = get().ptyBuffers[agentId];
    const tail = buf
      ? new TextDecoder()
          .decode(buf)
          .replace(ANSI_RX, "")
          .replace(/\r/g, "\n")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(-25)
          .join("\n")
          .slice(-2800)
      : "";
    const cmd = (cli ?? a.command ?? "codex").toLowerCase();
    const name = `${a.name.replace(/-next(-\d+)?$/, "")}-next`;
    const brief = [
      `HANDOFF — you are continuing the work of ${a.name} (${a.command ?? "?"}, ended ${a.status}).`,
      a.branch ? `It left a worktree on branch ${a.branch}.` : "",
      a.paths?.length ? `Files it touched: ${a.paths.slice(0, 8).join(", ")}.` : "",
      tail ? `Its last output:\n${tail}` : "",
      "Pick up where it stopped — check the worktree state first, then continue.",
    ]
      .filter(Boolean)
      .join("\n");
    // The handoff IS a delegation: wire the edge predecessor → successor and
    // type the brief once the CLI boots.
    client?.delegate(agentId, name, cmd, `handoff from ${a.name}`, ".", a.workspace_id ?? undefined, a.permission, undefined, undefined, brief);
    get().notify(`handoff: ${a.name} → ${name}`);
  },

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

  approveAlways: (agentId) => {
    client?.approveInput(agentId);
    client?.setPermission(agentId, "auto");
    const next = { ...get().approvals };
    delete next[agentId];
    const agents = { ...get().agents };
    if (agents[agentId]) agents[agentId] = { ...agents[agentId], permission: "auto" };
    set({ approvals: next, agents });
  },

  setPermission: (agentId, permission) => client?.setPermission(agentId, permission),

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

  moveNode: (agentId, x, y, recordHistory = true) => {
    set((s) => ({
      positions: { ...s.positions, [agentId]: { x, y } },
      // Gather/undo reposition many cards as one atomic operation; only a
      // deliberate manual move belongs in Cmd+Z card-move history.
      ...(recordHistory ? { moveHistory: [...s.moveHistory.slice(-49), { id: agentId, prev: s.positions[agentId] }] } : {}),
    }));
    client?.moveNode(agentId, x, y);
  },

  bumpFont: (delta) => {
    const termFont = Math.min(22, Math.max(9, get().termFont + Math.trunc(delta)));
    localStorage.setItem("cv-term-font", String(termFont));
    set({ termFont });
  },

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
        // Forget daemon-side too — otherwise the next snapshot resurrects
        // every dead agent the client just forgot.
        client?.confirmDestructive(id, "forget");
        delete next[id];
        n++;
      }
    if (n) {
      // Their canvas terminal cards go too — the PTY is gone.
      const board = get().activeBoard;
      const tn = { ...(get().termNodes[board] ?? {}) };
      let touched = false;
      for (const id of Object.keys(tn)) {
        if (id.startsWith("term-") && !next[id.slice(5)]) {
          delete tn[id];
          touched = true;
        }
      }
      if (touched) {
        const tAll = { ...get().termNodes, [board]: tn };
        localStorage.setItem("cv-termnodes", JSON.stringify(tAll));
        set({ agents: next, termNodes: tAll });
      } else {
        set({ agents: next });
      }
    }
    return n;
  },

  createAutomation: (a) => client?.createAutomation(a),
  runAutomation: (automationId) => client?.runAutomation(automationId),
  deleteAutomation: (automationId) => client?.deleteAutomation(automationId),
  setGuardrails: (patch) => {
    const g = { ...get().guardrails, ...patch };
    saveGuardrails(g, get().guardrailOverrides);
    set({ guardrails: g });
  },
  setGuardrailOverride: (automationId, on) => {
    const o = { ...get().guardrailOverrides };
    if (on) o[automationId] = true;
    else delete o[automationId];
    saveGuardrails(get().guardrails, o);
    set({ guardrailOverrides: o });
  },
  createLoop: (l) => client?.createLoop(l),
  deleteLoop: (loopId) => client?.deleteLoop(loopId),
  setLoopEnabled: (loopId, enabled) => client?.setLoopEnabled(loopId, enabled),
  runLoop: (loopId) => client?.runLoop(loopId),
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
    get().notify(`preset "${name}" applied${missing.length ? ` (+${missing.length} spawned)` : ""}`);
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
    try {
      const raw = JSON.parse(localStorage.getItem("cv-shapes") ?? "{}");
      // migrate old pinned stickies to glass pin cards — first pins were
      // stickies with an anchor, the very first had the "card-" id prefix
      for (const board of Object.values(raw)) {
        for (const [id, sh] of Object.entries(board as Record<string, { kind: string; anchor?: string; title?: string; text: string; color: string; group?: boolean }>)) {
          // Frames created before the structural-region treatment did not
          // carry the marker; their generated labels make the intent clear.
          if (sh.kind === "rect" && /^Group \d+$/.test(sh.text ?? "")) sh.group = true;
          if (sh.kind === "sticky" && (sh.anchor || id.startsWith("card-"))) {
            sh.kind = "pin";
            const lines = sh.text.split("\n");
            sh.title = sh.title ?? lines[0]?.slice(0, 60) ?? "pinned";
            sh.text = lines.slice(lines[1]?.trim() === "" ? 2 : 1).join("\n");
            sh.color = "#f5a524";
          }
        }
      }
      return raw;
    } catch { return {}; }
  })(),

  addShape: (kind) => {
    const { activeBoard, shapes, viewportRect } = get();
    const id = `shape-${Math.random().toString(36).slice(2, 10)}`;
    const w = kind === "sticky" ? 170 : 190;
    const h = kind === "sticky" ? 150 : 120;
    const x = viewportRect
      ? Math.max(viewportRect.left, Math.min((viewportRect.left + viewportRect.right - w) / 2, viewportRect.right - w))
      : 300 + Math.random() * 200;
    const y = viewportRect
      ? Math.max(viewportRect.top, Math.min((viewportRect.top + viewportRect.bottom - h) / 2, viewportRect.bottom - h))
      : 200 + Math.random() * 140;
    const def = {
      id,
      kind,
      x,
      y,
      w,
      h,
      color: kind === "sticky" ? "#e0c04a" : "#e8e6e3",
      text: "",
    };
    const next = { ...shapes, [activeBoard]: { ...(shapes[activeBoard] ?? {}), [id]: def } };
    localStorage.setItem("cv-shapes", JSON.stringify(next));
    set({ shapes: next });
  },

  pinCard: (title, body, color, anchor, pos) => {
    const { activeBoard, shapes } = get();
    const id = `card-${Math.random().toString(36).slice(2, 10)}`;
    const def = {
      id,
      kind: "pin" as const,
      x: pos?.x ?? 320 + Math.random() * 240,
      y: pos?.y ?? 220 + Math.random() * 160,
      w: 380,
      h: 240,
      color: color ?? "#f5a524",
      title,
      text: body ?? "",
      anchor,
    };
    const next = { ...shapes, [activeBoard]: { ...(shapes[activeBoard] ?? {}), [id]: def } };
    localStorage.setItem("cv-shapes", JSON.stringify(next));
    if (anchor) {
      const a = { ...get().anchors, [activeBoard]: { ...(get().anchors[activeBoard] ?? {}), [id]: anchor } };
      localStorage.setItem("cv-anchors", JSON.stringify(a));
      set({ shapes: next, anchors: a });
    } else {
      set({ shapes: next });
    }
    // A pin is an explicit "put this in front of me" action — surface the
    // card above whatever is already on the board, same as panel/term cards.
    get().bringCardToFront(id);
  },

  moveShape: (id, x, y) => {
    const { activeBoard, shapes } = get();
    const s = shapes[activeBoard]?.[id];
    if (!s) return;
    const next = { ...shapes, [activeBoard]: { ...shapes[activeBoard], [id]: { ...s, x, y } } };
    localStorage.setItem("cv-shapes", JSON.stringify(next));
    set({ shapes: next });
  },

  updateShape: (id, patch, persist = true) => {
    const { activeBoard, shapes } = get();
    const s = shapes[activeBoard]?.[id];
    if (!s) return;
    const next = { ...shapes, [activeBoard]: { ...shapes[activeBoard], [id]: { ...s, ...patch } } };
    if (persist) localStorage.setItem("cv-shapes", JSON.stringify(next));
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
    const post = (r: string, aid?: string) =>
      set((s) => ({ threadLog: logLine(s.threadLog, "thread", r, aid) }));
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
    if (/undo (gather|grouping|tidy)/.test(t)) {
      get().undoGather();
      return "gather undone";
    }
    if (/undo|deshacer/.test(t)) {
      if (get().lastGather) {
        get().undoGather();
        return "gather undone";
      }
      return undoMove() ? "undid last move" : "nothing to undo";
    }
    if (/fit|reset view|zoom|overview/.test(t)) {
      requestView();
      return "fitted view";
    }
    if (/close terminals?|cerrar terms?/.test(t)) {
      const board = get().activeBoard;
      const n = Object.keys(get().termNodes[board] ?? {}).length;
      const tm = { ...get().termNodes, [board]: {} };
      localStorage.setItem("cv-termnodes", JSON.stringify(tm));
      set({ termNodes: tm });
      return n ? `closed ${n} terminal card${n === 1 ? "" : "s"}` : "no terminal cards open";
    }
    if (/close panels|close cards|cerrar/.test(t)) {
      const board = get().activeBoard;
      const m = { ...get().panelNodes, [board]: {} };
      const tm = { ...get().termNodes, [board]: {} };
      localStorage.setItem("cv-panelnodes", JSON.stringify(m));
      localStorage.setItem("cv-termnodes", JSON.stringify(tm));
      set({ panelNodes: m, termNodes: tm });
      return "closed all panels";
    }
    if (/tidy|gather/.test(t)) {
      get().gatherLoose();
      return "gathered loose windows";
    }
    if (/clear|clean/.test(t)) {
      const n = clearDone();
      return n ? `cleared ${n} finished agent${n === 1 ? "" : "s"}` : "nothing to clear";
    }
    if (/^(new |spawn |open )?terminal/.test(t)) {
      get().setPendingTermPos({ x: 240 + Math.random() * 560, y: 120 + Math.random() * 240 });
      get().spawn("terminal", "bash");
      return "spawning a terminal";
    }
    if (/^(new |spawn |open )?agent/.test(t)) {
      get().setSpawnOpen(true);
      return "opening the agent spawner";
    }
    const panelAlias: Record<string, string> = {
      inbox: "inbox", notifications: "inbox",
      automations: "automations", automation: "automations",
      loops: "loops", loop: "loops",
      presets: "presets", preset: "presets",
      thread: "thread",
      accounts: "accounts", account: "accounts",
      juice: "usage", usage: "usage",
      memory: "memory",
      "pull requests": "prs", prs: "prs", pr: "prs",
      issues: "issues", issue: "issues",
      "dex tickets": "tickets", tickets: "tickets", ticket: "tickets", notes: "notes",
      "mission map": "usage",
      artifacts: "artifacts", artifact: "artifacts",
      obsidian: "vault", vault: "vault", files: "vault",
      settings: "settings", setting: "settings",
      skills: "skills", skill: "skills",
      tasks: "history", history: "history",
    };
    const pm = t.match(/^(?:open |show )?(.+)$/);
    if (pm && panelAlias[pm[1]]) {
      get().openPanelNode(panelAlias[pm[1]]);
      return `opened ${pm[1]}`;
    }
    return "try: open <panel> · new agent · new terminal · bigger text · smaller text · undo · fit · gather · close panels · clear done";
  },

  threadLog: loadThreadLog(),
  navRequest: null,
  ghCounts: {},
  requestNav: (key) => set((s) => ({ navRequest: { key, n: (s.navRequest?.n ?? 0) + 1 } })),
  edgeDetail: null,
  setEdgeDetail: (id) => set({ edgeDetail: id }),
  panelSummaries: localStorage.getItem("cv-panel-summaries") !== "false",
  togglePanelSummaries: () => {
    const panelSummaries = !get().panelSummaries;
    localStorage.setItem("cv-panel-summaries", String(panelSummaries));
    set({ panelSummaries });
    get().notify(get().panelSummaries ? "card summaries on" : "card summaries off");
  },
  snapAlign: localStorage.getItem("cv-snap-align") === "true",
  toggleSnapAlign: () => {
    const snapAlign = !get().snapAlign;
    localStorage.setItem("cv-snap-align", String(snapAlign));
    set({ snapAlign });
    get().notify(snapAlign ? "alignment snap on — cards magnetically align when dropped close" : "alignment snap off — free drag");
  },
  spawnOpen: false,
  setSpawnOpen: (v) => set(v ? { spawnOpen: v } : { spawnOpen: v, pendingSpawnPos: null }),
  focusSpawn: () => set({ spawnOpen: true }),
  gatherLoose: () => {
    const {
      agents,
      edges,
      positions,
      agentSizes,
      activeBoard,
      shapes,
      panelNodes,
      termNodes,
      mdNodes,
      webNodes,
      viewportRect,
      connected,
      workspaces,
      workspaceSizes,
      orchestrators,
    } = get();
    const wired = new Set(Object.values(edges).flatMap((e) => [e.from, e.to]));
    // A card is "loose" when its center isn't already inside a group frame.
    const rects = Object.values(shapes[activeBoard] ?? {}).filter(
      (s) => s.kind === "rect" && s.w != null && s.h != null,
    );
    const inside = (x: number, y: number) =>
      rects.some((r) => x >= r.x && x <= r.x + r.w! && y >= r.y && y <= r.y + r.h!);
    const loose: Array<{ id: string; x: number; y: number; w: number; h: number; move: (id: string, x: number, y: number) => void }> = [];

    // React Flow scales the viewport with a CSS transform, so offsetWidth/
    // offsetHeight remain untransformed flow units. Measuring the live node
    // is the difference between a tight terminal grid and huge phantom gaps
    // (agent cards are auto-height; 240px was only a rough guess).
    const measureNode = (id: string, fallbackW: number, fallbackH: number) => {
      if (typeof document === "undefined") return { w: fallbackW, h: fallbackH };
      const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
      const xy = el?.style.transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
      return {
        x: xy ? Number(xy[1]) : undefined,
        y: xy ? Number(xy[2]) : undefined,
        w: el?.offsetWidth && el.offsetWidth > 40 ? el.offsetWidth : fallbackW,
        h: el?.offsetHeight && el.offsetHeight > 24 ? el.offsetHeight : fallbackH,
      };
    };

    // Agents never dragged have no positions entry — snapshot the same
    // visible fallback layout used by the canvas instead of an offscreen grid.
    const boardAgents = Object.values(agents).filter((a) => (a.board_id ?? "main") === activeBoard);
    const fallbackPos = new Map<string, { x: number; y: number }>();
    const looseAgents = boardAgents.filter((a) => !a.workspace_id);
    const explicitLoose = looseAgents.filter((a) => positions[a.id]);
    const missingLoose = looseAgents.filter((a) => !positions[a.id]);
    const fallbackLoose = getAgentSpawnPositions(
      missingLoose.length,
      viewportRect,
      explicitLoose.map((a) => ({ ...positions[a.id], w: agentSizes[a.id]?.w ?? 460, h: agentSizes[a.id]?.h ?? 260 })),
    );
    const fallbackById = new Map(missingLoose.map((a, index) => [a.id, fallbackLoose[index]]));
    // Workspace children use positions RELATIVE to their parent. Replicate
    // the canvas's per-workspace fallback stack; absolute conversion happens
    // below when those stationary cards become obstacles.
    const workspaceOffsets = new Map<string, number>();
    for (const a of boardAgents) {
      if (positions[a.id]) {
        fallbackPos.set(a.id, positions[a.id]);
      } else if (a.workspace_id) {
        const offset = workspaceOffsets.get(a.workspace_id) ?? 0;
        workspaceOffsets.set(a.workspace_id, offset + 1);
        fallbackPos.set(a.id, { x: 24, y: 64 + offset * 284 });
      } else {
        fallbackPos.set(a.id, fallbackById.get(a.id) ?? { x: 24, y: 64 });
      }
    }

    for (const a of boardAgents) {
      const p = positions[a.id] ?? fallbackPos.get(a.id);
      if (!p || a.status === "exited" || a.workspace_id || wired.has(a.id)) continue;
      const size = agentSizes[a.id];
      const measured = measureNode(a.id, size?.w ?? 460, size?.h ?? 220);
      const cx = p.x + measured.w / 2;
      const cy = p.y + measured.h / 2;
      if (!inside(cx, cy)) {
        loose.push({ id: a.id, x: p.x, y: p.y, w: measured.w, h: measured.h, move: (id, x, y) => get().moveNode(id, x, y, false) });
      }
    }
    for (const [id, n] of Object.entries(panelNodes[activeBoard] ?? {})) {
      // Position lock and maximize are explicit user states. Gather respects
      // them; the card remains in place and becomes an obstacle for the layout.
      if (!n.locked && !n.maximized && !inside(n.x + (n.w ?? 320) / 2, n.y + (n.h ?? 420) / 2))
        loose.push({ id, x: n.x, y: n.y, w: n.w ?? 320, h: n.h ?? 420, move: (i, x, y) => get().movePanelNode(i, x, y) });
    }
    for (const [id, n] of Object.entries(termNodes[activeBoard] ?? {})) {
      if (!n.locked && !n.maximized && !inside(n.x + (n.w ?? 560) / 2, n.y + (n.h ?? 320) / 2))
        loose.push({ id, x: n.x, y: n.y, w: n.w ?? 560, h: n.h ?? 320, move: (i, x, y) => get().moveTermNode(i, x, y) });
    }
    for (const [id] of Object.entries(mdNodes[activeBoard] ?? {})) {
      const p = positions[id] ?? { x: 640, y: 160 };
      const measured = measureNode(id, 340, 260);
      if (!inside(p.x + measured.w / 2, p.y + measured.h / 2))
        loose.push({ id, ...p, w: measured.w, h: measured.h, move: (i, x, y) => get().moveNode(i, x, y, false) });
    }
    for (const [id] of Object.entries(webNodes[activeBoard] ?? {})) {
      const p = positions[id] ?? { x: 600, y: 120 };
      const measured = measureNode(id, 520, 360);
      if (!inside(p.x + measured.w / 2, p.y + measured.h / 2))
        loose.push({ id, ...p, w: measured.w, h: measured.h, move: (i, x, y) => get().moveNode(i, x, y, false) });
    }
    if (!loose.length) {
      get().notify("gather — no loose windows");
      return;
    }

    // Snapshot every loose position before moving a single card — undo
    // grouping puts them all back (Deska "put windows back").
    const snapshotItems = loose.map((l) => ({
      id: l.id,
      kind: (l.id.startsWith("panel-") ? "panel" : l.id.startsWith("term-") ? "term" : l.id.startsWith("md-") ? "md" : l.id.startsWith("web-") ? "web" : "agent") as "agent" | "panel" | "term" | "md" | "web",
      x: l.x,
      y: l.y,
    }));

    // Stationary content is sacred: group frames, workspaces, wired/parented
    // agents, orchestrators, locked cards and already-grouped cards all shape
    // the placement search. The old gather only avoided other shape rects,
    // so a fresh frame could swallow an entire workspace visually.
    const looseIds = new Set(loose.map((l) => l.id));
    const obstacles: GatherRect[] = [];
    const addObstacle = (x: number, y: number, w: number, h: number) => {
      if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) obstacles.push({ x, y, w, h });
    };
    for (const s of Object.values(shapes[activeBoard] ?? {})) addObstacle(s.x, s.y, s.w, s.h);
    for (const w of Object.values(workspaces)) {
      if ((w.board_id ?? "main") !== activeBoard) continue;
      const p = positions[w.id] ?? { x: 60, y: 60 };
      const sz = workspaceSizes[w.id] ?? { w: 900, h: 540 };
      addObstacle(p.x, p.y, sz.w, sz.h);
    }
    // Demo mode renders fixture workspaces outside the store. Treat those
    // visible fixtures as obstacles too; otherwise gather passes its offline
    // visual smoke test geometrically while visibly swallowing the mock board.
    if (!connected && Object.keys(agents).length === 0) {
      for (const n of initialNodes) {
        if (n.parentId) continue; // parent fixtures already cover their children
        const fallbackW = n.type === "workspace" ? 900 : n.type === "orchestrator" ? 292 : 460;
        const fallbackH = n.type === "workspace" ? 540 : n.type === "orchestrator" ? 190 : 220;
        const styleW = typeof n.style?.width === "number" ? n.style.width : undefined;
        const styleH = typeof n.style?.height === "number" ? n.style.height : undefined;
        const measured = measureNode(n.id, styleW ?? fallbackW, styleH ?? fallbackH);
        addObstacle(measured.x ?? n.position.x, measured.y ?? n.position.y, measured.w, measured.h);
      }
    }
    for (const a of boardAgents) {
      if (looseIds.has(a.id)) continue;
      const rel = positions[a.id] ?? fallbackPos.get(a.id) ?? { x: 24, y: 64 };
      const ws = a.workspace_id ? workspaces[a.workspace_id] : undefined;
      const base = ws ? (positions[ws.id] ?? { x: 60, y: 60 }) : { x: 0, y: 0 };
      const size = agentSizes[a.id];
      const measured = measureNode(a.id, size?.w ?? 460, size?.h ?? 220);
      addObstacle(base.x + rel.x, base.y + rel.y, measured.w, measured.h);
    }
    for (const [id, o] of Object.entries(orchestrators)) {
      if (o.board !== activeBoard) continue;
      const p = positions[id] ?? { x: 420, y: 80 };
      const measured = measureNode(id, 292, 190);
      addObstacle(p.x, p.y, measured.w, measured.h);
    }
    for (const [id, n] of Object.entries(panelNodes[activeBoard] ?? {})) {
      if (!looseIds.has(id)) addObstacle(n.x, n.y, n.w ?? 320, n.h ?? 420);
    }
    for (const [id, n] of Object.entries(termNodes[activeBoard] ?? {})) {
      if (!looseIds.has(id)) addObstacle(n.x, n.y, n.w ?? 560, n.h ?? 320);
    }
    for (const [id] of Object.entries(mdNodes[activeBoard] ?? {})) {
      if (looseIds.has(id)) continue;
      const p = positions[id] ?? { x: 640, y: 160 };
      const measured = measureNode(id, 340, 260);
      addObstacle(p.x, p.y, measured.w, measured.h);
    }
    for (const [id] of Object.entries(webNodes[activeBoard] ?? {})) {
      if (looseIds.has(id)) continue;
      const p = positions[id] ?? { x: 600, y: 120 };
      const measured = measureNode(id, 520, 360);
      addObstacle(p.x, p.y, measured.w, measured.h);
    }

    // viewportRect is in flow units, but rails/topbar/dock occupy SCREEN px.
    // Recover the zoom from the viewport width and convert those margins so
    // the group never slides underneath floating chrome at low zoom (or wastes
    // excessive space at high zoom).
    const zoomGuess = viewportRect && typeof window !== "undefined"
      ? Math.min(2, Math.max(0.2, window.innerWidth / Math.max(1, viewportRect.right - viewportRect.left)))
      : 1;
    const px = (screenPx: number) => screenPx / zoomGuess;
    const plan = planGatherLayout(loose, viewportRect, obstacles, {
      left: px(64),
      top: px(84),
      right: px(56),
      bottom: px(76),
    });
    if (!plan) {
      get().notify("gather — no loose windows");
      return;
    }

    const token = Date.now() + Math.random();
    set({ gatherMotion: { ids: loose.map((l) => l.id), token } });
    const movers = new Map(loose.map((l) => [l.id, l.move]));
    for (const p of plan.placements) movers.get(p.id)?.(p.id, p.x, p.y);

    // The frame needs its id for undo — frameNodes returns the label, so
    // capture the newest frame id from the shapes map right after.
    const beforeIds = new Set(Object.keys(get().shapes[activeBoard] ?? {}));
    const n = get().frameNodes(plan.frame.x, plan.frame.y, plan.frame.w, plan.frame.h);
    const frameId = Object.keys(get().shapes[activeBoard] ?? {}).find((k) => !beforeIds.has(k)) ?? "";
    set({ lastGather: { board: activeBoard, items: snapshotItems, frameId } });
    get().notify(`gathered ${loose.length} window${loose.length === 1 ? "" : "s"} into ${n}`);

    // Choreography: windows and camera travel together. The focus effect's
    // first retry naturally starts a frame after the node mount, so the region
    // materializes for one beat before the camera settles on it.
    if (frameId) get().requestFocus(frameId);
    setTimeout(() => {
      if (get().gatherMotion?.token === token) set({ gatherMotion: null });
    }, 330);
  },
  undoGather: () => {
    const g = get().lastGather;
    if (!g) {
      get().notify("nothing to undo — no recent gather");
      return;
    }
    // The movers write to the ACTIVE board — jump back to the board the
    // gather happened on so positions land where the cards actually are.
    // If that board was deleted there is nothing to restore into: drop
    // the snapshot instead of resurrecting a board the user closed.
    if (!get().boards[g.board]) {
      set({ lastGather: null });
      get().notify("gather undo expired — that board is gone");
      return;
    }
    if (get().activeBoard !== g.board) get().setActiveBoard(g.board);
    const token = Date.now() + Math.random();
    set({ gatherMotion: { ids: g.items.map((item) => item.id), token } });
    for (const item of g.items) {
      if (item.kind === "panel") get().movePanelNode(item.id, item.x, item.y);
      else if (item.kind === "term") get().moveTermNode(item.id, item.x, item.y);
      else get().moveNode(item.id, item.x, item.y, false);
    }
    // Let the outgoing region dissolve while the windows fly back; deleting
    // it in the same frame made undo feel like a hard cut.
    if (g.frameId) {
      set((s) => ({ leavingShapes: { ...s.leavingShapes, [g.frameId]: true } }));
      setTimeout(() => {
        const boardShapes = { ...(get().shapes[g.board] ?? {}) };
        delete boardShapes[g.frameId];
        const next = { ...get().shapes, [g.board]: boardShapes };
        localStorage.setItem("cv-shapes", JSON.stringify(next));
        set((s) => {
          const leavingShapes = { ...s.leavingShapes };
          delete leavingShapes[g.frameId];
          return { shapes: next, leavingShapes };
        });
      }, 180);
    }
    set({ lastGather: null });
    get().notify("gather undone — windows back where they were");
    // Join the reverse flight immediately. App-level fitView ignores the
    // dissolving frame, so the camera can follow the windows home instead of
    // waiting for the region to vanish and missing half the motion.
    setTimeout(() => get().requestView(), 20);
    setTimeout(() => {
      if (get().gatherMotion?.token === token) set({ gatherMotion: null });
    }, 330);
  },
  /** Drop a translucent "Group N" rect behind a region of the board —
   * shared by gatherLoose and the selection pill. Returns the label. */
  frameNodes: (x, y, w, h) => {
    const { activeBoard, shapes } = get();
    const n = Object.keys(shapes[activeBoard] ?? {}).filter(
      (k) => shapes[activeBoard][k].text?.startsWith("Group")).length + 1;
    const id = `shape-${Math.random().toString(36).slice(2, 10)}`;
    const def = { id, kind: "rect" as const, x, y, w, h, color: "#e8b25a", text: `Group ${n}`, group: true };
    const next = { ...shapes, [activeBoard]: { ...(shapes[activeBoard] ?? {}), [id]: def } };
    localStorage.setItem("cv-shapes", JSON.stringify(next));
    set({ shapes: next });
    return `Group ${n}`;
  },
  chromeHidden: false,
  toggleChrome: () => set((s) => ({ chromeHidden: !s.chromeHidden })),
  zoomN: { dir: 0, n: 0 },
  zoomPct: 100,
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
    const reply = (r: string, aid?: string) =>
      set((s) => ({ threadLog: logLine(s.threadLog, "thread", r, aid) }));
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
    if (/^close (?:all )?(?:panels|cards|tools)/.test(low)) {
      const board = get().activeBoard;
      const m = { ...get().panelNodes, [board]: {} };
      const tm = { ...get().termNodes, [board]: {} };
      localStorage.setItem("cv-panelnodes", JSON.stringify(m));
      localStorage.setItem("cv-termnodes", JSON.stringify(tm));
      set({ panelNodes: m, termNodes: tm });
      reply("closed all cards");
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
    const PANELS = ["inbox", "automations", "loops", "presets", "history", "accounts", "memory", "notes", "artifacts", "vault", "skills", "settings", "canvas", "usage"];
    const om = low.match(/^(?:open|show|go to)\s+([\w\s]+?)$/);
    if (om) {
      const hit = PANELS.find((p) => om[1].trim().startsWith(p)) ??
        (om[1].trim().startsWith("juice") ? "usage" : undefined);
      if (hit) {
        get().requestNav(hit);
        reply(`opened ${hit}`);
        return;
      }
    }
    const pdfm = low.match(/^(?:pdf|export\s+pdf)\s+(.+)$/);
    if (pdfm) {
      const q = pdfm[1].replace(/[?.\s]+$/, "").trim();
      void import("../lib/boardDocs").then(({ buildDoc, buildAskDoc }) =>
        import("../lib/pdf").then(({ downloadPdf }) => {
          const kinds = ["overview", "onboarding", "architecture"] as const;
          const k = kinds.find((x) => q.toLowerCase().includes(x));
          const { title, md } = k ? buildDoc(k) : buildAskDoc(q);
          downloadPdf(title, md);
          get().artifactCreate("pdf", `PDF — ${title}`, undefined, md);
          reply(`exported "PDF — ${title}" → Downloads + Artifacts`);
        }),
      );
      return;
    }
    const parm = low.match(/^parallel\s+(\d+)\s+(\w+)\s+(.+)$/);
    if (parm) {
      const n = Math.min(parseInt(parm[1], 10), 4);
      const cmd = parm[2];
      const task = parm[3];
      for (let i = 0; i < n; i++) {
        get().spawn(
          `${cmd}-p${i + 1}`,
          cmd,
          undefined,
          undefined,
          undefined,
          `You are worker ${i + 1} of ${n} on a parallel task — each worker has its own worktree, work independently.\n\n${task}`,
        );
      }
      reply(`spawned ${n} ${cmd} workers on "${task.slice(0, 60)}" — each in its own worktree`);
      return;
    }
    const hoff = low.match(/^handoff\s+(.+?)(?:\s+to\s+(\w+))?\s*$/);
    if (hoff) {
      const q = hoff[1].replace(/[?.\s]+$/, "").trim();
      const boardAgents = Object.values(get().agents).filter(
        (a) => (a.board_id ?? "main") === get().activeBoard,
      );
      const tm = q.match(/^terminal\s+(\d+)$/);
      const hit = tm
        ? boardAgents[parseInt(tm[1], 10) - 1]
        : boardAgents.find(
            (a) =>
              a.name.toLowerCase().includes(q) ||
              (a.command ?? "").toLowerCase() === q,
          );
      if (!hit) {
        reply(`no agent matches "${q}"`);
      } else {
        get().handoff(hit.id, hoff[2]);
        reply(`handed off ${hit.name} → ${hit.name.replace(/-next(-\d+)?$/, "")}-next (${hoff[2] ?? hit.command ?? "same cli"})`);
      }
      return;
    }
    const pm2 = low.match(/^(?:permission|perm)\s+(.+?)\s+(supervised|auto[-_ ]?accept|auto|full)$/);
    if (pm2) {
      const q = pm2[1].replace(/[?.\s]+$/, "").trim();
      const lvl = pm2[2].replace(/[- ]/g, "_");
      const boardAgents = Object.values(get().agents).filter(
        (a) => (a.board_id ?? "main") === get().activeBoard,
      );
      const tm = q.match(/^terminal\s+(\d+)$/);
      const hit = tm
        ? boardAgents[parseInt(tm[1], 10) - 1]
        : boardAgents.find(
            (a) =>
              a.name.toLowerCase().includes(q) ||
              (a.command ?? "").toLowerCase() === q,
          );
      if (!hit) {
        reply(`no agent matches "${q}"`);
      } else {
        get().setPermission(hit.id, lvl);
        reply(`${hit.name} → ${lvl}`);
      }
      return;
    }
    const shm = low.match(/^(?:share|publish)\s+(.+)$/);
    if (shm) {
      const q = shm[1].replace(/[?.\s]+$/, "").trim();
      const hit = Object.values(get().artifacts).find(
        (a) => a.title.toLowerCase().includes(q),
      );
      if (!hit?.text) {
        reply(`no artifact "${q}" with contents`);
        return;
      }
      void import("../lib/share").then(async ({ shareArtifactPdf }) => {
        const url = await shareArtifactPdf(hit.title.replace(/^PDF — /, ""), hit.text ?? "");
        if (url) {
          void navigator.clipboard.writeText(url).catch(() => {});
          reply(`published "${hit.title}" → ${url} (copied — live while the app runs)`);
        } else {
          reply("share needs the daemon on :4242");
        }
      });
      return;
    }
    const ob = low.match(/^obsidian\s+(.+)$/);
    if (ob) {
      const text = t.replace(/^obsidian\s+/i, "").trim();
      const dir = get().vaultDir;
      if (!dir) {
        reply("no vault connected — open Explorer/Obsidian and pick your vault dir first");
        return;
      }
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      if (/^(?:summary|recap|status|digest)$/.test(text.toLowerCase())) {
        const agents = Object.values(get().agents);
        const lines = [
          `## ${stamp} — board recap`,
          ...agents.map(
            (a) => `- ${a.name} · ${a.command ?? "?"} · ${a.status}`,
          ),
          ...(Object.values(get().notes ?? {}).length
            ? ["", "### open notes", ...Object.values(get().notes ?? {}).map(
                (n) => `- [${n.col}] ${n.text}`,
              )]
            : []),
        ];
        get().vaultAppend("canvas-dex.md", lines.join("\n"));
        reply("recap written to Obsidian → canvas-dex.md");
        return;
      }
      get().vaultAppend("canvas-dex.md", `- ${stamp} — ${text}`);
      reply("logged to Obsidian → canvas-dex.md");
      return;
    }
    const nm = low.match(/^(?:note|todo|task)\s*[:=-]?\s*(.+)$/);
    if (nm && !/^(?:new\s)/.test(low)) {
      const text = t.replace(/^(?:note|todo|task)\s*[:=-]?\s*/i, "").trim();
      get().noteUpsert(null, "todo", text);
      reply(`noted: ${text.slice(0, 80)}`);
      return;
    }
    const nb = low.match(/^new\s+(?:board|space)\s+(.+)$/);
    if (nb) {
      const name = nb[1].replace(/[?.\s]+$/, "").trim();
      get().createBoard(name);
      reply(`created space "${name}"`);
      return;
    }
    const rm = low.match(/^run\s+(?:automation\s+)?(.+)$/);
    if (rm) {
      const q = rm[1].replace(/[?.\s]+$/, "").trim();
      const hit = Object.values(get().automations).find(
        (a) => a.name.toLowerCase() === q || a.name.toLowerCase().includes(q),
      );
      if (hit) {
        get().runAutomation(hit.id);
        reply(`ran automation "${hit.name}"`);
      } else {
        reply(`no automation "${q}"`);
      }
      return;
    }
    if (/^new task\b/.test(low)) {
      get().focusSpawn();
      reply("spawn chooser is on the Orchestrator card");
      return;
    }
    const bm = low.match(/^(?:board|space|switch(?:\s+to)?)\s+(.+)$/);
    if (bm) {
      const q = bm[1].replace(/[?.\s]+$/, "").replace(/^(?:board|space)\s+/, "").trim();
      const hit = Object.entries(get().boards).find(
        ([id, name]) =>
          name.toLowerCase() === q || id === q || name.toLowerCase().startsWith(q),
      );
      if (hit) {
        get().setActiveBoard(hit[0]);
        reply(`switched to ${hit[1]}`);
      } else {
        reply(`no board "${q}" — boards: ${Object.values(get().boards).join(", ")}`);
      }
      return;
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
          "approve/deny Terminal N · spawn <cli> · kill Terminal N · kill all · " +
          "pause/resume · board/new board <name> · apply/save preset <n> · " +
          "open <panel> · focus <name> · gather · hide chrome · " +
          "obsidian <note> · pdf <topic> · share <artifact> · handoff <agent> · parallel N <cli> <task> · permission <agent> <level> · status · summary",
      );
      return;
    }
    if (/^(?:clear|wipe) thread$/.test(low)) {
      localStorage.removeItem(THREAD_KEY);
      set({ threadLog: [{ role: "thread", text: "thread cleared" }] });
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

  ptyBuffer: (agentId) => {
    flushPendingPtyState(get, (patch) => set(patch));
    return get().ptyBuffers[agentId];
  },

  attachPty: (agentId, cb) =>
    set((s) => {
      const set_ = new Set(s.ptyListeners[agentId]);
      set_.add(cb);
      return { ptyListeners: { ...s.ptyListeners, [agentId]: set_ } };
    }),

  detachPty: (agentId, cb) =>
    set((s) => {
      const set_ = new Set(s.ptyListeners[agentId]);
      if (cb) set_.delete(cb);
      else set_.clear();
      const { [agentId]: _drop, ...rest } = s.ptyListeners;
      return { ptyListeners: set_.size ? { ...rest, [agentId]: set_ } : rest };
    }),

  sendInput: (agentId, bytes) => client?.ptyInput(agentId, bytes),
  resizePty: (agentId, cols, rows) => {
    set({ ptySize: { ...get().ptySize, [agentId]: { cols, rows } } });
    client?.resize(agentId, cols, rows);
  },

  requestTranscript: (agentId) => client?.transcript(agentId),
}));

// Dev-only handle for console debugging — never shipped to Tauri prod usage.
if (import.meta.env.DEV) {
  (window as unknown as { useBoard?: typeof useBoard }).useBoard = useBoard;
}
