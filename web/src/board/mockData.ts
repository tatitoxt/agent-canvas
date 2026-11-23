import type { Edge, Node } from "@xyflow/react";
import type { BoardNodeData, DelegationEdgeData } from "./types";

export const initialNodes: Node<BoardNodeData>[] = [
  {
    id: "orch",
    type: "orchestrator",
    position: { x: 40, y: 260 },
    data: { kind: "orchestrator", name: "Atlas", activeDelegations: 3 },
  },
  {
    id: "a1",
    type: "agent",
    position: { x: 520, y: 40 },
    data: {
      kind: "agent",
      name: "builder-1",
      cli: "claude-code",
      status: "working",
      task: "Scaffold checkout API",
    },
  },
  {
    id: "a2",
    type: "agent",
    position: { x: 520, y: 220 },
    data: {
      kind: "agent",
      name: "tests-1",
      cli: "codex",
      status: "waiting",
      task: "Needs approval: delete fixtures?",
    },
  },
  {
    id: "a3",
    type: "agent",
    position: { x: 520, y: 400 },
    data: {
      kind: "agent",
      name: "docs-1",
      cli: "gemini-cli",
      status: "done",
      task: "Update API reference",
    },
  },
  {
    id: "a4",
    type: "agent",
    position: { x: 520, y: 580 },
    data: {
      kind: "agent",
      name: "audit-1",
      cli: "aider",
      status: "blocked",
      task: "Merge conflict in billing.ts",
    },
  },
  {
    id: "a5",
    type: "agent",
    position: { x: 960, y: 130 },
    data: {
      kind: "agent",
      name: "review-1",
      cli: "claude-code",
      status: "working",
      task: "Review builder-1 diff",
    },
  },
];

export const initialEdges: Edge<DelegationEdgeData>[] = [
  {
    id: "e-orch-a1",
    source: "orch",
    target: "a1",
    type: "delegation",
    data: { state: "delegated", task: "Implement POST /checkout" },
  },
  {
    id: "e-orch-a2",
    source: "orch",
    target: "a2",
    type: "delegation",
    data: { state: "delegated", task: "Write checkout tests" },
  },
  {
    id: "e-a3-orch",
    source: "a3",
    target: "orch",
    type: "delegation",
    data: { state: "returned", result: "docs updated, 12 pages" },
  },
  {
    id: "e-orch-a4",
    source: "orch",
    target: "a4",
    type: "delegation",
    data: { state: "failed", task: "Audit merge" },
  },
  {
    id: "e-a1-a5",
    source: "a1",
    target: "a5",
    type: "delegation",
    data: { state: "delegated", task: "review diff +142/-38" },
  },
];
