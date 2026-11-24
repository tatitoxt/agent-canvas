import { useCallback, useEffect, useMemo, useState } from "react";
import { toPng } from "html-to-image";
import {
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  getNodesBounds,
  getViewportForBounds,
  useReactFlow,
  type FinalConnectionState,
  type Node,
  type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import { AgentNode, OrchestratorNode, WebNode, WorkspaceNode } from "./board/nodes";
import { ShapeNode } from "./components/ShapeNode";
import { MdNode } from "./components/MdNode";
import { DelegationEdge } from "./board/edges";
import { initialEdges, initialNodes } from "./board/mockData";
import { DelegateDialog } from "./components/DelegateDialog";
import { NavRail } from "./components/NavRail";
import { SpawnBar } from "./components/SpawnBar";
import { TerminalPanel } from "./components/TerminalPanel";
import { InboxPanel } from "./components/InboxPanel";
import { AutomationsPanel } from "./components/AutomationsPanel";
import { LoopsPanel } from "./components/LoopsPanel";
import { PresetsPanel } from "./components/PresetsPanel";
import { ThreadPanel } from "./components/ThreadPanel";
import { AccountsPanel } from "./components/AccountsPanel";
import { MemoryPanel } from "./components/MemoryPanel";
import { NotesPanel } from "./components/NotesPanel";
import { ArtifactsPanel } from "./components/ArtifactsPanel";
import { VaultPanel } from "./components/VaultPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SkillsPanel } from "./components/SkillsPanel";
import { StudioPanel } from "./components/StudioPanel";
import { DigestPanel } from "./components/DigestPanel";
import { NoticePill } from "./components/NoticePill";
import { HistoryPanel } from "./components/HistoryPanel";
import { CommandPalette } from "./components/CommandPalette";
import { DelegationPanel } from "./components/DelegationPanel";
import { SearchPanel } from "./components/SearchPanel";
import { Topbar } from "./components/Topbar";
import { ToolsRail } from "./components/ToolsRail";
import { ContextMenu } from "./components/ContextMenu";
import { useBoard } from "./store/board";
import type { AgentStatus, BoardNodeData } from "./board/types";

const nodeTypes = {
  agent: AgentNode,
  orchestrator: OrchestratorNode,
  workspace: WorkspaceNode,
  web: WebNode,
  shape: ShapeNode,
  md: MdNode,
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
  const webNodes = useBoard((s) => s.webNodes);
  const orchestrators = useBoard((s) => s.orchestrators);
  const shapes = useBoard((s) => s.shapes);
  const moveShape = useBoard((s) => s.moveShape);
  const mdNodes = useBoard((s) => s.mdNodes);
  const wiringFrom = useBoard((s) => s.wiringFrom);
  const toggleWire = useBoard((s) => s.toggleWire);
  const setWiring = useBoard((s) => s.setWiring);
  const { screenToFlowPosition, fitView, getNodes } = useReactFlow();

  // Full-canvas PNG export: render every node fitted into a fixed-size
  // bitmap — the "screenshot button" on the board.
  // Markup pencil — freehand strokes drawn over the canvas (screen coords),
  // baked into the PNG when a shot exports.
  const [pencil, setPencil] = useState(false);
  const [strokes, setStrokes] = useState<Array<Array<{ x: number; y: number }>>>([]);
  const [drawing, setDrawing] = useState<Array<{ x: number; y: number }> | null>(null);

  const composeShot = useCallback(
    async (dataUrl: string, screenRect: { x1: number; y1: number; x2: number; y2: number }, name: string) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const cv = document.createElement("canvas");
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const sx = img.width / (screenRect.x2 - screenRect.x1);
      const sy = img.height / (screenRect.y2 - screenRect.y1);
      ctx.strokeStyle = "#e8b25a";
      ctx.lineWidth = 3;
      ctx.lineJoin = ctx.lineCap = "round";
      for (const st of strokes) {
        if (st.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo((st[0].x - screenRect.x1) * sx, (st[0].y - screenRect.y1) * sy);
        for (const p of st.slice(1)) ctx.lineTo((p.x - screenRect.x1) * sx, (p.y - screenRect.y1) * sy);
        ctx.stroke();
      }
      const a = document.createElement("a");
      a.download = name;
      a.href = cv.toDataURL("image/png");
      a.click();
    }, [strokes]);
  const shotCanvas = useCallback(async () => {
    const ns = getNodes();
    if (ns.length === 0) return;
    const bounds = getNodesBounds(ns);
    const w = Math.min(2400, Math.max(800, Math.ceil(bounds.width) + 240));
    const h = Math.min(2400, Math.max(600, Math.ceil(bounds.height) + 240));
    const vp = getViewportForBounds(bounds, w, h, 0.2, 2, 0.12);
    const el = document.querySelector<HTMLElement>(".react-flow__viewport");
    if (!el) return;
    const dataUrl = await toPng(el, {
      backgroundColor: "#0e0e10",
      width: w,
      height: h,
      style: {
        width: `${w}px`,
        height: `${h}px`,
        transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
      },
    });
    const a = document.createElement("a");
    a.download = `canvas-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    a.href = dataUrl;
    a.click();
  }, [getNodes, composeShot]);
  const viewCmdN = useBoard((s) => s.viewCmdN);
  useEffect(() => {
    if (viewCmdN > 0) fitView({ padding: 0.18, maxZoom: 1.1, duration: 250 });
  }, [viewCmdN, fitView]);
  const navRequest = useBoard((s) => s.navRequest);
  useEffect(() => {
    if (navRequest) setNav(navRequest.key);
  }, [navRequest]);
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
  // Region shot: marquee-select part of the canvas → PNG of just that area.
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [shotMode, setShotMode] = useState(false);
  const shotRegion = useCallback(async (r: { x1: number; y1: number; x2: number; y2: number }) => {
    const ns = getNodes();
    const vp = document.querySelector<HTMLElement>(".react-flow__viewport");
    if (!vp) return;
    // Intersect each node's rendered box with the marquee to capture it.
    const picked = ns.filter((n) => {
      const el = document.querySelector(`[data-id="${n.id}"]`);
      if (!el) return false;
      const b = el.getBoundingClientRect();
      return b.left < r.x2 && b.right > r.x1 && b.top < r.y2 && b.bottom > r.y1;
    });
    if (picked.length === 0) {
      useBoard.getState().notify("region shot — no nodes in the selected area");
      return;
    }
    const bounds = getNodesBounds(picked);
    const w = Math.min(2400, Math.max(400, Math.ceil(bounds.width) + 160));
    const h = Math.min(2400, Math.max(300, Math.ceil(bounds.height) + 160));
    const v = getViewportForBounds(bounds, w, h, 0.2, 2, 0.12);
    const dataUrl = await toPng(vp, {
      backgroundColor: "#0e0e10",
      width: w,
      height: h,
      style: { width: `${w}px`, height: `${h}px`, transform: `translate(${v.x}px, ${v.y}px) scale(${v.zoom})` },
    });
    void composeShot(dataUrl, r, `canvas-region-${Date.now()}.png`);
    useBoard.getState().notify(`region shot — ${picked.length} node(s)`);
  }, [getNodes]);
  // Connect on load when a token is present — no manual "connect" click.
  useEffect(() => {
    useBoard.getState().connect("");
    const t = localStorage.getItem("cv-theme") ?? "obsidian";
    document.documentElement.dataset.theme = t;
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
    // Nodes taking part in an in-flight delegation glow orange — the
    // "talking to the orchestrator" cue.
    const inFlight = new Set(
      Object.values(liveEdges)
        .filter((e) => e.state === "delegated")
        .flatMap((e) => [e.from, e.to]),
    );
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
          termNo: i,
          cli: (a.command ?? "bash").split(/\s+/)[0].toLowerCase(),
          permission: a.permission,
          accountLabel: a.account_label ?? undefined,
          delegating: inFlight.has(a.id),
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
    const webNs: Node<BoardNodeData>[] = Object.entries(webNodes[activeBoard] ?? {}).map(
      ([id, url]) => ({
        id,
        type: "web" as const,
        position: positions[id] ?? { x: 600, y: 120 },
        style: { width: 520, height: 340 },
        data: { kind: "web" as const, url },
      }),
    );
    // Orchestrator cards live in the store (client-side, per board).
    const orchNs: Node<BoardNodeData>[] = Object.entries(orchestrators)
      .filter(([, o]) => o.board === activeBoard)
      .map(([id, o]) => ({
        id,
        type: "orchestrator" as const,
        position: positions[id] ?? { x: 420, y: 80 },
        data: {
          kind: "orchestrator" as const,
          id,
          name: o.name,
          delegations:
            o.wired.length +
            Object.values(liveEdges).filter((e) => e.from === id).length,
        },
      }));
    const shapeNs: Node<BoardNodeData>[] = Object.values(shapes[activeBoard] ?? {}).map((s) => ({
      id: s.id,
      type: "shape" as const,
      position: { x: s.x, y: s.y },
      style: { width: s.w, height: s.h },
      data: { kind: "shape" as const, shape: s },
    }));
    const mdNs: Node<BoardNodeData>[] = Object.entries(mdNodes[activeBoard] ?? {}).map(
      ([id, path]) => ({
        id,
        type: "md" as const,
        position: positions[id] ?? { x: 640, y: 160 },
        style: { width: 340, height: 260 },
        data: { kind: "md" as const, id, path },
      }),
    );
    return connected
      ? [...wsNodes, ...shapeNs, ...mdNs, ...webNs, ...live, ...orchNs]
      : [...initialNodes, ...shapeNs, ...mdNs, ...webNs, ...live, ...orchNs];
  }, [agents, positions, connected, workspaces, approvals, attention, activeBoard, webNodes, orchestrators, liveEdges, shapes, mdNodes]);

  const onNodeClick: NodeMouseHandler = (_, node) => {
    // In Connect mode a click on an agent card wires/unwires it to the
    // orchestrator instead of opening the terminal.
    if (wiringFrom && agents[node.id]) {
      toggleWire(wiringFrom, node.id);
      return;
    }
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
    if (node.id.startsWith("shape-")) {
      moveShape(node.id, node.position.x, node.position.y);
    } else if (agents[node.id] || workspaces[node.id] || node.id.startsWith("web-") || node.id.startsWith("orch-") || node.id.startsWith("md-")) {
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
    const delegEdges = Object.values(liveEdges)
      .filter(
        (e) =>
          (agents[e.from]?.board_id ??
            agents[e.to]?.board_id ??
            orchestrators[e.from]?.board ??
            "main") === activeBoard,
      )
      .map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      type: "delegation" as const,
      data: { state: e.state, task: e.task, result: e.result, files: e.files },
    }));
    // Orchestrator wiring: an orange bezier from each wired console into
    // the card — same cable look as a delegation in flight.
    const wireEdges = Object.entries(orchestrators)
      .filter(([, o]) => o.board === activeBoard)
      .flatMap(([oid, o]) =>
        o.wired
          .filter((aid) => agents[aid])
          .map((aid) => ({
            id: `wire-${oid}-${aid}`,
            source: aid,
            target: oid,
            type: "delegation" as const,
            data: { state: "delegated" as const },
          })),
      );
    return [...delegEdges, ...wireEdges];
  }, [connected, liveEdges, agents, activeBoard, orchestrators]);

  return (
    <div className="relative h-full w-full">
      <NavRail
        active={nav}
        onSelect={(k) => setNav((n) => (n === k ? "canvas" : k))}
      />
      <ToolsRail
        active={nav}
        onSelect={(k) => setNav((n) => (n === k ? "canvas" : k))}
        drawOn={pencil}
        regionOn={shotMode}
        actions={{
          onDigest: () => useBoard.getState().digestNow(),
          onShot: () => void shotCanvas(),
          onStudio: () => useBoard.getState().studioDocNow(),
          onDraw: () => setPencil((m) => !m),
          onRegion: () => setShotMode((m) => !m),
          onSettings: () => setNav((n) => (n === "settings" ? "canvas" : "settings")),
        }}
      />
      <Topbar />
      {pencil && (
        <div
          style={{ position: "absolute", inset: 0, zIndex: 29, cursor: "crosshair" }}
          onMouseDown={(e) => setDrawing([{ x: e.clientX, y: e.clientY }])}
          onMouseMove={(e) => { if (drawing) setDrawing([...drawing, { x: e.clientX, y: e.clientY }]); }}
          onMouseUp={() => { if (drawing && drawing.length > 1) setStrokes((st) => [...st, drawing]); setDrawing(null); }}
        >
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {[...strokes, ...(drawing ? [drawing] : [])].map((st, i) => (
              <polyline
                key={i}
                points={st.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="#e8b25a"
                strokeWidth={3}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </svg>
          <button
            className="glass-pill"
            style={{ position: "absolute", right: 20, top: 52, fontSize: 10.5, padding: "5px 12px", cursor: "pointer", border: "none", color: "var(--cv-ink-dim)" }}
            onClick={(e) => { e.stopPropagation(); setStrokes([]); }}
          >
            clear strokes
          </button>
        </div>
      )}
      {shotMode && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 30,
            cursor: "crosshair",
            background: "rgba(14,14,16,0.15)",
          }}
          onMouseDown={(e) => setMarquee({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY })}
          onMouseMove={(e) => { if (marquee) setMarquee({ ...marquee, x2: e.clientX, y2: e.clientY }); }}
          onMouseUp={(e) => {
            if (marquee) {
              const r = {
                x1: Math.min(marquee.x1, e.clientX), x2: Math.max(marquee.x1, e.clientX),
                y1: Math.min(marquee.y1, e.clientY), y2: Math.max(marquee.y1, e.clientY),
              };
              setMarquee(null);
              setShotMode(false);
              if (r.x2 - r.x1 > 20 && r.y2 - r.y1 > 20) void shotRegion(r);
            } else setShotMode(false);
          }}
        >
          {marquee && (
            <div
              style={{
                position: "absolute",
                left: Math.min(marquee.x1, marquee.x2),
                top: Math.min(marquee.y1, marquee.y2),
                width: Math.abs(marquee.x2 - marquee.x1),
                height: Math.abs(marquee.y2 - marquee.y1),
                border: "1.5px solid var(--cv-accent)",
                background: "rgba(201,162,107,0.08)",
                borderRadius: 8,
              }}
            />
          )}
        </div>
      )}
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
        onPaneClick={() => {
          setEdgeDetail(null);
          setWiring(null);
        }}
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
                working: "#3ddc84",
                waiting: "#ffb224",
                blocked: "#ff5d5d",
                done: "#34d399",
                idle: "#9aa0a6",
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
      {nav === "loops" && <LoopsPanel />}
      {nav === "presets" && <PresetsPanel />}
      {nav === "thread" && <ThreadPanel />}
      {nav === "accounts" && <AccountsPanel />}
      {nav === "memory" && <MemoryPanel />}
      {nav === "notes" && <NotesPanel />}
      {nav === "artifacts" && <ArtifactsPanel />}
      {nav === "vault" && <VaultPanel />}
      {nav === "settings" && <SettingsPanel />}
      {nav === "skills" && <SkillsPanel />}
      <DigestPanel />
      <StudioPanel />
      <NoticePill />
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
      {/* Excalidraw-style sloppiness for whiteboard shapes */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id="cv-sloppy">
          <feTurbulence type="turbulence" baseFrequency="0.015" numOctaves="2" result="n" seed="3" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="4" />
        </filter>
      </svg>
      <Board />
    </ReactFlowProvider>
  );
}
