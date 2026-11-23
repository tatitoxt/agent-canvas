import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import { AgentNode, OrchestratorNode } from "./board/nodes";
import { DelegationEdge } from "./board/edges";
import { initialEdges, initialNodes } from "./board/mockData";
import { MissionStrip } from "./components/MissionStrip";
import { SpawnBar } from "./components/SpawnBar";
import { TerminalPanel } from "./components/TerminalPanel";
import { useBoard } from "./store/board";
import type { AgentStatus, BoardNodeData } from "./board/types";

const nodeTypes = { agent: AgentNode, orchestrator: OrchestratorNode };
const edgeTypes = { delegation: DelegationEdge };

function Board() {
  const agents = useBoard((s) => s.agents);
  const positions = useBoard((s) => s.positions);
  const moveNode = useBoard((s) => s.moveNode);
  const connected = useBoard((s) => s.connected);
  const [openTerm, setOpenTerm] = useState<{ id: string; name: string } | null>(null);

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
    let i = 0;
    const live = Object.values(agents).map((a) => {
      const position = positions[a.id] ?? { x: 1420, y: 60 + i++ * 170 };
      return {
        id: a.id,
        type: "agent" as const,
        position,
        data: {
          kind: "agent" as const,
          name: a.name,
          cli: "live",
          status: a.status === "exited" ? ("done" as const) : a.status,
          task: a.status === "exited" ? "session ended" : "live PTY — click to open",
        },
      };
    });
    // Mock board only renders in offline/demo mode — with a daemon the
    // canvas shows reality, not fixtures.
    return connected ? live : [...initialNodes, ...live];
  }, [agents, positions, connected]);

  const onNodeClick: NodeMouseHandler = (_, node) => {
    const a = agents[node.id];
    if (a && a.status !== "exited") setOpenTerm({ id: a.id, name: a.name });
  };

  const onNodeDragStop: OnNodeDrag = (_, node) => {
    if (agents[node.id]) moveNode(node.id, node.position.x, node.position.y);
  };

  return (
    <div className="relative h-full w-full">
      <MissionStrip counts={counts} />
      <SpawnBar />
      <ReactFlow
        nodes={nodes}
        edges={connected ? [] : initialEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
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
          maskColor="rgba(11,14,20,0.7)"
          nodeColor={(n) => {
            const data = n.data as Partial<BoardNodeData>;
            if (data.kind === "orchestrator") return "#22d3ee";
            if (data.kind === "agent" && data.status) {
              const map: Record<AgentStatus, string> = {
                working: "#38bdf8",
                waiting: "#fbbf24",
                blocked: "#f87171",
                done: "#34d399",
                idle: "#8b94a7",
              };
              return map[data.status] ?? "#232c3d";
            }
            return "#232c3d";
          }}
        />
        <Background gap={24} size={1} color="#1c2434" />
      </ReactFlow>
      {connected === false && null}
      {openTerm && (
        <TerminalPanel
          agentId={openTerm.id}
          name={openTerm.name}
          onClose={() => setOpenTerm(null)}
        />
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
