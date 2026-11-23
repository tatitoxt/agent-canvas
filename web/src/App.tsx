import { useEffect, useMemo, useState } from "react";
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
import { InboxPanel } from "./components/InboxPanel";
import { AutomationsPanel } from "./components/AutomationsPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { CommandPalette } from "./components/CommandPalette";
import { DelegationPanel } from "./components/DelegationPanel";
import { SearchPanel } from "./components/SearchPanel";
import { Topbar } from "./components/Topbar";
import { BoardTabs } from "./components/BoardTabs";
import { ContextMenu } from "./components/ContextMenu";
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
  const activeBoard = useBoard((s) => s.activeBoard);
  const approvals = useBoard((s) => s.approvals);
  const attention = useBoard((s) => s.attention);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const viewCmdN = useBoard((s) => s.viewCmdN);
  useEffect(() => {
    if (viewCmdN > 0) fitView({ padding: 0.18, maxZoom: 1.1, duration: 250 });
  }, [viewCmdN, fitView]);
  const [openTerms, setOpenTerms] = useState<Array<{ id: string; name: string }>>([]);
  const openTerm = (t: { id: string; name: string }) =>
    setOpenTerms((ts) => (ts.some((x) => x.id === t.id) ? ts : [...ts, t]));
  const closeTerm = (id: string) => setOpenTerms((ts) => ts.filter((x) => x.id !== id));
  const [delegateFrom, setDelegateFrom] = useState<{ from: string; at: { x: number; y: number } } | null>(null);
  const [nav, setNav] = useState("canvas");
  const [palette, setPalette] = useState(false);
  const [edgeDetail, setEdgeDetail] = useState<string | null>(null);
  const [search, setSearch] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  // Connect on load when a token is present — no manual "connect" click.
  useEffect(() => {
    useBoard.getState().connect("");
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearch((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      if ((a.board_id ?? "main") !== activeBoard) continue;
      const k = a.status === "exited"
        ? "done"
        : attention[a.id]
          ? "blocked"
          : a.status;
      if (k in c) c[k as AgentStatus] += 1;
    }
    return c;
  }, [agents, connected, attention, activeBoard]);

  const nodes = useMemo<Node<BoardNodeData>[]>(() => {
    const wsNodes: Node<BoardNodeData>[] = Object.values(workspaces)
      .filter((w) => (w.board_id ?? "main") === activeBoard)
      .map((w) => ({
      id: w.id,
      type: "workspace" as const,
      position: positions[w.id] ?? { x: 60, y: 60 },
      style: { width: 900, height: 540 },
      data: { kind: "workspace" as const, name: w.name, repo: w.repo },
    }));
    let i = 0;
    const live = Object.values(agents)
      .filter((a) => (a.board_id ?? "main") === activeBoard)
      .map((a) => {
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
          id: a.id,
          name: a.name,
          cli: (a.command ?? "bash").split(/\s+/)[0].toLowerCase(),
          permission: a.permission,
          files: a.files,
          paths: a.paths,
          status: a.status === "exited"
            ? ("done" as const)
            : attention[a.id]
              ? ("blocked" as const)
              : a.status,
          task: a.status === "exited" ? "session ended — transcript" : (a.lastLine ?? "live PTY — click to open"),
          pendingApproval: approvals[a.id],
          branch: a.branch,
        },
      };
    });
    // Mock board only renders in offline/demo mode — with a daemon the
    // canvas shows reality, not fixtures.
    return connected ? [...wsNodes, ...live] : [...initialNodes, ...live];
  }, [agents, positions, connected, workspaces, approvals, attention, activeBoard]);

  const onNodeClick: NodeMouseHandler = (_, node) => {
    const a = agents[node.id];
    if (a) openTerm({ id: a.id, name: a.name });
  };

  // Double-click focuses a node — single click already opens its terminal.
  const onNodeDoubleClick: NodeMouseHandler = (_, node) => {
    fitView({ nodes: [{ id: node.id }], padding: 0.9, maxZoom: 1.4, duration: 300 });
  };

  const onNodeContextMenu: NodeMouseHandler = (ev, node) => {
    ev.preventDefault();
    if (!agents[node.id] && !workspaces[node.id]) return;
    setMenu({ x: ev.clientX, y: ev.clientY, id: node.id });
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
    const { clientX, clientY } = "changedTouches" in event ? event.changedTouches[0] : event;
    setDelegateFrom({ from, at: screenToFlowPosition({ x: clientX, y: clientY }) });
  };

  const edges = useMemo(() => {
    if (!connected) return initialEdges;
    // An edge is visible when its delegating node is on this board.
    return Object.values(liveEdges)
      .filter((e) => (agents[e.from]?.board_id ?? "main") === activeBoard)
      .map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      type: "delegation" as const,
      data: { state: e.state, task: e.task, result: e.result, files: e.files },
    }));
  }, [connected, liveEdges, agents, activeBoard]);

  return (
    <div className="relative h-full w-full">
      <NavRail
        active={nav}
        onSelect={(k) => setNav((n) => (n === k ? "canvas" : k))}
      />
      <Topbar />
      <BoardTabs />
      <MissionStrip counts={counts} />
      <SpawnBar />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStop={onNodeDragStop}
        onConnectEnd={onConnectEnd}
        onEdgeClick={(_, edge) => setEdgeDetail(edge.id)}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => setEdgeDetail(null)}
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
      {nav === "inbox" && (
        <InboxPanel
          onOpenAgent={(id) => {
            const a = agents[id];
            if (a) openTerm({ id: a.id, name: a.name });
          }}
        />
      )}
      {nav === "automations" && <AutomationsPanel />}
      {nav === "history" && (
        <HistoryPanel onOpenEdge={(id) => { setEdgeDetail(id); setNav("canvas"); }} />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          nodeId={menu.id}
          isAgent={!!agents[menu.id]}
          onOpenTerminal={() => {
            const a = agents[menu.id];
            if (a) openTerm({ id: a.id, name: a.name });
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {edgeDetail && liveEdges[edgeDetail] && (
        <DelegationPanel
          edgeId={edgeDetail}
          onClose={() => setEdgeDetail(null)}
          onOpenAgent={(id, name) => openTerm({ id, name })}
        />
      )}
      {openTerms.map((t, i) => (
        <TerminalPanel
          key={t.id}
          agentId={t.id}
          name={t.name}
          index={i}
          onClose={() => closeTerm(t.id)}
        />
      ))}
      {search && (
        <SearchPanel
          onClose={() => setSearch(false)}
          onOpenAgent={(id, name) => {
            openTerm({ id, name });
            setSearch(false);
          }}
        />
      )}
      {palette && (
        <CommandPalette
          onClose={() => setPalette(false)}
          onNav={(k) => {
            setNav(k);
            setPalette(false);
          }}
          onOpenAgent={(id, name) => {
            openTerm({ id, name });
            setPalette(false);
          }}
        />
      )}
      {delegateFrom && (
        <DelegateDialog from={delegateFrom.from} at={delegateFrom.at} onClose={() => setDelegateFrom(null)} />
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
