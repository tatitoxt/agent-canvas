import { useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import { AgentNode, OrchestratorNode } from "./board/nodes";
import { DelegationEdge } from "./board/edges";
import { initialEdges, initialNodes } from "./board/mockData";
import { MissionStrip } from "./components/MissionStrip";
import type { AgentStatus, BoardNodeData } from "./board/types";

const nodeTypes = { agent: AgentNode, orchestrator: OrchestratorNode };
const edgeTypes = { delegation: DelegationEdge };

function Board() {
  const counts = useMemo(() => {
    const c: Record<AgentStatus, number> = {
      working: 0,
      waiting: 0,
      blocked: 0,
      done: 0,
      idle: 0,
    };
    for (const n of initialNodes) {
      if (n.data.kind === "agent") c[n.data.status] += 1;
    }
    return c;
  }, []);

  return (
    <div className="relative h-full w-full">
      <MissionStrip counts={counts} />
      <ReactFlow
        nodes={initialNodes}
        edges={initialEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
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
