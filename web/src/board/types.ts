export type AgentStatus = "working" | "waiting" | "blocked" | "done" | "idle";

export type AgentNodeData = {
  kind: "agent";
  name: string;
  cli: string;
  status: AgentStatus;
  permission?: string;
  task?: string;
  lastOutput?: string;
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

export type BoardNodeData =
  | AgentNodeData
  | OrchestratorNodeData
  | WorkspaceNodeData;

export type DelegationEdgeData = {
  task?: string;
  result?: string;
  state: "delegated" | "returned" | "failed";
};
