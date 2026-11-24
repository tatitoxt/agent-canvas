export type AgentStatus = "working" | "waiting" | "blocked" | "done" | "idle";

export type AgentNodeData = {
  kind: "agent";
  /** Live agent id — needed by node-level actions (approve/deny). */
  id?: string;
  name: string;
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
};

export type OrchestratorNodeData = {
  kind: "orchestrator";
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

export type BoardNodeData =
  | AgentNodeData
  | OrchestratorNodeData
  | WorkspaceNodeData
  | WebNodeData;

export type DelegationEdgeData = {
  task?: string;
  result?: string;
  /** Files the child changed — the edge's produced diff. */
  files?: number;
  state: "delegated" | "returned" | "failed";
};
