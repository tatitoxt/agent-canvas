import { useMemo, useState } from "react";
import {
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type FinalConnectionState,
  type Node,
  type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import { AgentNode, OrchestratorNode, WorkspaceNode } from "./board/nodes";
import { DelegationEdge } from "./board/edges";
import { initialEdges, initialNodes } from "./board/mockData";
import { DelegateDialog } from "./components/DelegateDialog";
import { MissionStrip } from "./components/MissionStrip";
import { NavRail } from "./components/NavRail";
import { SpawnBar } from "./components/SpawnBar";
import { TerminalPanel } from "./components/TerminalPanel";
import { Topbar } from "./components/Topbar";
import { useBoard } from "./store/board";
import type { AgentStatus, BoardNodeData } from "./board/types";

const nodeTypes = {
  agent: AgentNode,
  orchestrator: OrchestratorNode,
  workspace: WorkspaceNode,
};
const edgeTypes = { delegation: DelegationEdge };

function Board() {
  const agents = useBoard((s) => s.agents);
  const liveEdges = useBoard((s) => s.edges);
  const workspaces = useBoard((s) => s.workspaces);
  const positions = useBoard((s) => s.positions);
  const moveNode = useBoard((s) => s.moveNode);
  const connected = useBoard((s) => s.connected);
  const { screenToFlowPosition } = useReactFlow();
  const [openTerm, setOpenTerm] = useState<{ id: string; name: string } | null>(null);
  const [delegateFrom, setDelegateFrom] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<AgentStatus, number> = {
      working: 0,
      waiting: 0,
      blocked: 0,
      done: 0,
      idle: 0,
    };
    if (!connected) {
      for (const n of initialNodes) {
        if (n.data.kind === "agent") c[n.data.status] += 1;
      }
    }
    for (const a of Object.values(agents)) {
      const k = a.status === "exited" ? "done" : a.status;
      if (k in c) c[k as AgentStatus] += 1;
    }
    return c;
  }, [agents, connected]);

  const nodes = useMemo<Node<BoardNodeData>[]>(() => {
    const wsNodes: Node<BoardNodeData>[] = Object.values(workspaces).map((w) => ({
      id: w.id,
      type: "workspace" as const,
      position: positions[w.id] ?? { x: 60, y: 60 },
      style: { width: 900, height: 540 },
      data: { kind: "workspace" as const, name: w.name, repo: w.repo },
    }));
    let i = 0;
    const live = Object.values(agents).map((a) => {
      const ws = a.workspace_id ? workspaces[a.workspace_id] : undefined;
      const position = positions[a.id] ??
        (ws ? { x: 60 + (i % 3) * 300, y: 80 + Math.floor(i / 3) * 190 } : { x: 1100, y: 60 + i * 170 });
      i += 1;
      return {
        id: a.id,
        type: "agent" as const,
        position,
        ...(ws ? { parentId: ws.id, extent: "parent" as const } : {}),
        data: {
          kind: "agent" as const,
          name: a.name,
          cli: (a.command ?? "bash").split(/\s+/)[0].toLowerCase(),
          permission: a.permission,
          status: a.status === "exited" ? ("done" as const) : a.status,
          task: a.status === "exited" ? "session ended" : "live PTY — click to open",
        },
      };
    });
    // Mock board only renders in offline/demo mode — with a daemon the
    // canvas shows reality, not fixtures.
    return connected ? [...wsNodes, ...live] : [...initialNodes, ...live];
  }, [agents, positions, connected, workspaces]);

  const onNodeClick: NodeMouseHandler = (_, node) => {
    const a = agents[node.id];
    if (a && a.status !== "exited") setOpenTerm({ id: a.id, name: a.name });
  };

  const onNodeDragStop: OnNodeDrag = (_, node) => {
    if (agents[node.id] || workspaces[node.id]) {
      moveNode(node.id, node.position.x, node.position.y);
    }
  };

  // Drag a source handle onto empty canvas → delegate dialog. Dropping on
  // a node is reserved (incomplete connections are simply discarded).
  const onConnectEnd = (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
    const from = connectionState.fromNode?.id;
    if (!from || !agents[from]) return;
    if (connectionState.isValid || connectionState.toNode) return;
    void event; void screenToFlowPosition; // drop position reserved for placing the child node later
    setDelegateFrom(from);
  };

  const edges = useMemo(() => {
    if (!connected) return initialEdges;
    return Object.values(liveEdges).map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      type: "delegation" as const,
      data: { state: e.state, task: e.task, result: e.result },
    }));
  }, [connected, liveEdges]);

  return (
    <div className="relative h-full w-full">
      <NavRail active="canvas" />
      <Topbar />
      <MissionStrip counts={counts} />
      <SpawnBar />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onConnectEnd={onConnectEnd}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          className="!bg-[var(--cv-base)]"
          maskColor="rgba(14,14,16,0.7)"
          nodeColor={(n) => {
            const data = n.data as Partial<BoardNodeData>;
            if (data.kind === "orchestrator") return "#c9a26b";
            if (data.kind === "workspace") return "#1d1d20";
            if (data.kind === "agent" && data.status) {
              const map: Record<AgentStatus, string> = {
                working: "#7d9cb8",
                waiting: "#c2a15e",
                blocked: "#b06a5e",
                done: "#7ba389",
                idle: "#86817a",
              };
              return map[data.status] ?? "#33333a";
            }
            return "#33333a";
          }}
        />
      </ReactFlow>
      {connected === false && null}
      {openTerm && (
        <TerminalPanel
          agentId={openTerm.id}
          name={openTerm.name}
          onClose={() => setOpenTerm(null)}
        />
      )}
      {delegateFrom && (
        <DelegateDialog from={delegateFrom} onClose={() => setDelegateFrom(null)} />
      )}
    </div>
  );
}

export function App() {
  return (
    <ReactFlowProvider>
      <Board />
    </ReactFlowProvider>
  );
}
