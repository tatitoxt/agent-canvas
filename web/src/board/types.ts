export type AgentStatus = "working" | "waiting" | "blocked" | "done" | "idle";

export type AgentNodeData = {
  kind: "agent";
  name: string;
  cli: string;
  status: AgentStatus;
  task?: string;
  lastOutput?: string;
};

export type OrchestratorNodeData = {
  kind: "orchestrator";
  name: string;
  activeDelegations: number;
};

export type BoardNodeData = AgentNodeData | OrchestratorNodeData;

export type DelegationEdgeData = {
  task?: string;
  result?: string;
  state: "delegated" | "returned" | "failed";
};
