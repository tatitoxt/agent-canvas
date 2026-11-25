import type { Edge, Node } from "@xyflow/react";
import type { BoardNodeData, DelegationEdgeData } from "./types";

/**
 * Demo board (offline mode): two workspaces coexisting — one orchestrated
 * feature build, one independent solo session.
 */
export const initialNodes: Node<BoardNodeData>[] = [
  {
    id: "ws-1",
    type: "workspace",
    position: { x: 0, y: 0 },
    style: { width: 1260, height: 560 },
    data: { kind: "workspace", name: "cartfull", repo: "~/repos/cartfull" },
  },
  {
    id: "orch",
    type: "orchestrator",
    position: { x: 36, y: 240 },
    parentId: "ws-1",
    extent: "parent",
    data: { kind: "orchestrator", name: "Atlas", delegations: 3 },
  },
  {
    id: "a1",
    type: "agent",
    position: { x: 250, y: 60 },
    parentId: "ws-1",
    extent: "parent",
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
    position: { x: 430, y: 260 },
    parentId: "ws-1",
    extent: "parent",
    data: {
      kind: "agent",
      name: "tests-2",
      cli: "codex",
      status: "waiting",
      task: "Allow deleting the fixtures directory? (yes/no)",
    },
  },
  {
    id: "a5",
    type: "agent",
    position: { x: 770, y: 40 },
    parentId: "ws-1",
    extent: "parent",
    data: {
      kind: "agent",
      name: "review-3",
      cli: "claude-code",
      status: "working",
      task: "Review builder-1 diff",
    },
  },
  {
    id: "a3",
    type: "agent",
    position: { x: 460, y: 460 },
    parentId: "ws-1",
    extent: "parent",
    data: {
      kind: "agent",
      name: "docs-4",
      cli: "gemini-cli",
      status: "done",
      task: "Update API reference",
    },
  },
  {
    id: "ws-2",
    type: "workspace",
    position: { x: 1380, y: 60 },
    style: { width: 400, height: 300 },
    data: { kind: "workspace", name: "notes-app", repo: "~/repos/notes" },
  },
  {
    id: "b1",
    type: "agent",
    position: { x: 48, y: 80 },
    parentId: "ws-2",
    extent: "parent",
    data: {
      kind: "agent",
      name: "solo-5",
      cli: "aider",
      status: "idle",
      task: "Waiting at prompt",
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
    id: "e-a1-a5",
    source: "a1",
    target: "a5",
    type: "delegation",
    data: { state: "delegated", task: "review diff +142/-38" },
  },
];
