export type AgentStatus = "working" | "waiting" | "blocked" | "done" | "idle";

export type AgentNodeData = {
  kind: "agent";
  /** Live agent id — needed by node-level actions (approve/deny). */
  id?: string;
  name: string;
  /** Deska-style "Terminal N" ordinal — position in the board's spawn order. */
  termNo?: number;
  cli: string;
  status: AgentStatus;
  permission?: string;
  task?: string;
  lastOutput?: string;
  /** Uncommitted files in the agent's worktree — the diff badge. */
  files?: number;
  /** Uncommitted file paths — badge tooltip. */
  paths?: string[];
  /** Command line held by the supervised-input gate awaiting a decision. */
  pendingApproval?: string;
  /** Label of the named account this agent signs in as. */
  accountLabel?: string;
  /** Worktree branch — shown as a muted mono badge. */
  branch?: string;
  /** Part of an in-flight delegation — orange outline (talking to orchestrator). */
  delegating?: boolean;
  /** Session pre-dates this client's connect — daemon replayed it (Deska "restored session"). */
  restored?: boolean;
  /** Live PTY size — footer shows `cols×rows` like Deska. */
  ptySize?: { cols: number; rows: number };
};

export type OrchestratorNodeData = {
  kind: "orchestrator";
  /** Node id — the card looks itself up in the store for wiring/roster. */
  id?: string;
  name: string;
  delegations: number;
};

/** A container agents live inside — several coexist on one canvas. */
export type WorkspaceNodeData = {
  kind: "workspace";
  name: string;
  repo: string;
};

export type WebNodeData = {
  kind: "web";
  url: string;
};

export type ShapeKind = "rect" | "ellipse" | "diamond" | "sticky" | "pin" | "artifact";

export type ShapeDef = {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  text: string;
  /** Card title (pinned panels) — body lives in `text`. */
  title?: string;
  anchor?: string;
  /** Live snapshot reference for an artifact window on the board. */
  artifactId?: string;
  artifactKind?: string;
  /** Frames created by Gather/“group windows” use a cleaner region chrome
   * than freehand whiteboard rects. */
  group?: boolean;
};

export type ShapeNodeData = {
  kind: "shape";
  shape: ShapeDef;
};

export type MdNodeData = {
  kind: "md";
  id: string;
  path: string;
};

export type PanelNodeData = {
  kind: "panel";
  id: string;
};

export type TermNodeData = {
  kind: "term";
  /** Node id `term-<agentId>` — the card resolves its agent from it. */
  id: string;
};

export type BoardNodeData =
  | AgentNodeData
  | OrchestratorNodeData
  | WorkspaceNodeData
  | WebNodeData
  | ShapeNodeData
  | MdNodeData
  | PanelNodeData
  | TermNodeData;

export type DelegationEdgeData = {
  task?: string;
  result?: string;
  /** Files the child changed — the edge's produced diff. */
  files?: number;
  state: "delegated" | "returned" | "failed";
};
