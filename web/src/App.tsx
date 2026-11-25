import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  MiniMap,
  ReactFlow,
  ViewportPortal,
  ReactFlowProvider,
  getNodesBounds,
  getViewportForBounds,
  useReactFlow,
  useViewport,
  applyNodeChanges,
  useNodesState,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import { AgentNode, OrchestratorNode, WebNode, WorkspaceNode } from "./board/nodes";
import { ShapeNode } from "./components/ShapeNode";
import { edgePoint, obstacleRects, segmentHitsRect, type Rect } from "./components/anchorGeom";
import { MdNode } from "./components/MdNode";
import { DelegationEdge } from "./board/edges";
import { initialEdges, initialNodes } from "./board/mockData";
import { DelegateDialog } from "./components/DelegateDialog";
import { NavRail, RightRail, BottomDock } from "./components/NavRail";
import { Icon } from "./components/icons";
import { SpawnBar } from "./components/SpawnBar";
import { TerminalPanel } from "./components/TerminalPanel";
import { PanelNode } from "./board/PanelNode";
import { PANEL_DEFS } from "./components/panelRegistry";
import { PanelActionsCtx } from "./components/panelCtx";
import { StudioPanel } from "./components/StudioPanel";
import { DigestPanel } from "./components/DigestPanel";
import { NoticePill } from "./components/NoticePill";

import { CommandPalette } from "./components/CommandPalette";

import { DelegationPanel } from "./components/DelegationPanel";
import { SearchPanel } from "./components/SearchPanel";
import { Topbar } from "./components/Topbar";
import { ContextMenu } from "./components/ContextMenu";
import { CardMenu } from "./components/CardMenu";
import { isTauri } from "./daemon/tauriClient";
import { PaneMenu } from "./components/PaneMenu";
import { TermNode } from "./board/TermNode";
import { useBoard } from "./store/board";
import type { AgentStatus, BoardNodeData } from "./board/types";

const nodeTypes = {
  agent: AgentNode,
  orchestrator: OrchestratorNode,
  workspace: WorkspaceNode,
  web: WebNode,
  shape: ShapeNode,
  md: MdNode,
  panel: PanelNode,
  term: TermNode,
};
const edgeTypes = { delegation: DelegationEdge };

/** Keeps the zoom % readout fresh — Deska's bottom-right zoom %. */

/** Dashed cables tying pinned cards / obsidian notes to the panel they
 * were pinned from — border to border, only drawn when the straight line
 * crosses no other node or panel (Deska anchor notes, collision-aware). */
function AnchorCables({ nav }: { nav: string }) {
  const { flowToScreenPosition } = useReactFlow();
  useViewport();
  const anchors = useBoard((s) => s.anchors);
  const shapes = useBoard((s) => s.shapes);
  const positions = useBoard((s) => s.positions);
  const activeBoard = useBoard((s) => s.activeBoard);
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const [id, key] of Object.entries(anchors[activeBoard] ?? {})) {
    // Two anchor kinds: a panel key (draw only while that panel is open) or
    // `agent:<id>` — a note pinned next to an agent card, always drawn.
    let target: Rect | null = null;
    let skipSel = "";
    if (key.startsWith("agent:")) {
      const agentId = key.slice(6);
      const p = positions[agentId];
      if (!p) continue;
      const tl = flowToScreenPosition({ x: p.x, y: p.y });
      const br = flowToScreenPosition({ x: p.x + 340, y: p.y + 260 });
      target = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
      skipSel = `[data-id="${agentId}"]`;
    } else {
      if (key !== nav) continue;
      const el = document.querySelector(`[data-panel="${key}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      target = { x: r.left, y: r.top, w: r.width, h: r.height };
      skipSel = `[data-panel="${key}"]`;
    }
    const sh = (shapes[activeBoard] ?? {})[id];
    let card: Rect | null = null;
    if (sh) {
      const tl = flowToScreenPosition({ x: sh.x, y: sh.y });
      const br = flowToScreenPosition({ x: sh.x + sh.w, y: sh.y + sh.h });
      card = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
    } else if (positions[id]) {
      const tl = flowToScreenPosition({ x: positions[id].x, y: positions[id].y });
      const br = flowToScreenPosition({ x: positions[id].x + 340, y: positions[id].y + 260 });
      card = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
    }
    if (!card) continue;
    const targetC = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    const cardC = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
    const a = edgePoint(card, targetC);
    const b = edgePoint(target, cardC);
    // Draw only through free space — never across another node or panel.
    const obstacles = obstacleRects([`[data-id="${id}"]`, skipSel]);
    if (obstacles.some((o) => segmentHitsRect(a, b, o))) continue;
    lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  if (!lines.length) return null;
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 18 }}>
      {lines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
          stroke="var(--cv-accent)" strokeWidth={1.5} strokeDasharray="6 5" opacity={0.8} strokeLinecap="round" />
      ))}
    </svg>
  );
}

function ViewportTracker() {
  const { zoom, x: vpX, y: vpY } = useViewport();
  const [winSize, setWinSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    useBoard.setState({
      viewportRect: {
        left: -vpX / zoom,
        top: -vpY / zoom,
        right: -vpX / zoom + winSize.w / zoom,
        bottom: -vpY / zoom + winSize.h / zoom,
      },
    });
  }, [vpX, vpY, zoom, winSize]);
  useEffect(() => {
    useBoard.setState({ zoomPct: Math.round(zoom * 100) });
  }, [zoom]);
  return null;
}

function Board() {
  const agents = useBoard((s) => s.agents);
  const liveEdges = useBoard((s) => s.edges);
  const workspaces = useBoard((s) => s.workspaces);
  const workspaceSizes = useBoard((s) => s.workspaceSizes);
  const agentSizes = useBoard((s) => s.agentSizes);
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
  const mdNodeSizes = useBoard((s) => s.mdNodeSizes);
  const panelNodes = useBoard((s) => s.panelNodes);
  const termNodes = useBoard((s) => s.termNodes);
  const cardZ = useBoard((s) => s.cardZ);
  const wiringFrom = useBoard((s) => s.wiringFrom);
  const toggleWire = useBoard((s) => s.toggleWire);
  const setWiring = useBoard((s) => s.setWiring);
  const { screenToFlowPosition, fitView, getNodes, getZoom, zoomTo, setNodes, setCenter } = useReactFlow();

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

  const zoomN = useBoard((s) => s.zoomN);
  useEffect(() => {
    if (zoomN.n > 0) zoomTo(getZoom() * (zoomN.dir > 0 ? 1.3 : 0.77), { duration: 160 });
  }, [zoomN, getZoom, zoomTo]);
  const chromeHidden = useBoard((s) => s.chromeHidden);
  const navRequest = useBoard((s) => s.navRequest);
  useEffect(() => {
    if (navRequest) setNav(navRequest.key);
  }, [navRequest]);
  const [openTerms, setOpenTerms] = useState<Array<{ id: string; name: string }>>([]);
  // Re-opening an already-open terminal raises it to the front instead of
  // doing nothing (later entries render on top).
  const openTerm = (t: { id: string; name: string }) =>
    setOpenTerms((ts) => {
      const rest = ts.filter((x) => x.id !== t.id);
      return rest.length === ts.length ? [...ts, t] : [...rest, t];
    });
  const closeTerm = (id: string) => setOpenTerms((ts) => ts.filter((x) => x.id !== id));
  const termRequest = useBoard((s) => s.termRequest);
  useEffect(() => {
    if (termRequest) openTerm({ id: termRequest.id, name: termRequest.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termRequest]);
  const focusNode = useBoard((s) => s.focusNode);
  useEffect(() => {
    if (focusNode) {
      // Retry a few frames: a just-created panel node may take a tick to
      // register, and fitView on a missing node falls back to fitting all.
      let tries = 8;
      const attempt = () => {
        const n = getNodes().find((x) => x.id === focusNode.id);
        if (n) fitView({ nodes: [n], padding: 0.25, maxZoom: 1.2, duration: 300 });
        else if (--tries > 0) setTimeout(attempt, 40);
      };
      const t = setTimeout(attempt, 40);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNode]);
  const [delegateFrom, setDelegateFrom] = useState<{ from: string; at: { x: number; y: number } } | null>(null);
  const [nav, setNav] = useState("canvas");
  // Tool panels live on the canvas as nodes (Deska "Add to board"):
  // clicking a rail/topbar icon opens or focuses its card; re-clicking
  // closes it. Non-panel keys (canvas) behave as before.
  const navToggle = (k: string) => {
    setNav((n) => {
      if (n === k) {
        useBoard.getState().closePanelNode(`panel-${k}`);
        return "canvas";
      }
      if (PANEL_DEFS[k]) {
        // openPanelNode focuses the card only when it already exists — a new
        // card keeps the placement we give it (inbox docks right, Deska-style).
        const b = useBoard.getState();
        if (!b.panelNodes[b.activeBoard]?.[`panel-${k}`]) {
          const def = PANEL_DEFS[k];
          const sx = k === "inbox" ? window.innerWidth - def.w - 24 : window.innerWidth * 0.42;
          const p = screenToFlowPosition({ x: sx, y: window.innerHeight * 0.1 });
          b.openPanelNode(k, p, { w: def.w, h: def.h });
        } else {
          b.requestFocus(`panel-${k}`);
        }
      }
      return k;
    });
  };
  const addPanelToBoard = (key: string) => {
    if (!PANEL_DEFS[key]) return;
    const def = PANEL_DEFS[key];
    const p = screenToFlowPosition({ x: Math.max(24, window.innerWidth * 0.38), y: Math.max(72, window.innerHeight * 0.22) });
    useBoard.getState().openPanelNode(key, p, { w: def.w, h: def.h });
    setNav("canvas");
  };
  const [palette, setPalette] = useState(false);
  const edgeDetail = useBoard((s) => s.edgeDetail);
  const setEdgeDetail = useBoard((s) => s.setEdgeDetail);
  const [search, setSearch] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(null);
  const [shapeMenu, setShapeMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [mmSize, setMmSize] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cv-minimap-size") ?? "null") ?? { w: 148, h: 96 }; }
    catch { return { w: 148, h: 96 }; }
  });
  const [sel, setSel] = useState<Array<{ id: string; x: number; y: number; w: number; h: number }>>([]);
  const selRef = useRef(sel);
  selRef.current = sel;
  /** Deska "drop to place" ghost — dashed rect at the drop position
   * while a card is being dragged. */
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
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
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void shotCanvas();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setShotMode((m) => !m);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPencil((m) => !m);
      } else if (e.key === "Escape" && pencil) {
        setDrawing(null);
        setPencil(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "`") {
        // Pop the selected agent's terminal out as a canvas card, or put an
        // existing card back into the drawer — one keystroke both ways.
        e.preventDefault();
        const st = useBoard.getState();
        const boardId = st.activeBoard ?? "main";
        const selIds = selRef.current.map((s) => s.id);
        const agentId =
          selIds.find((id) => st.agents[id]) ??
          selIds.find((id) => id.startsWith("term-"))?.slice(5);
        if (agentId) {
          const termId = `term-${agentId}`;
          if (st.termNodes[boardId]?.[termId]) {
            st.closeTermNode(termId);
            const a = st.agents[agentId];
            openTerm({ id: agentId, name: a?.name ?? "terminal" });
          } else {
            st.openTermNode(agentId);
          }
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        // Duplicate the selected agent — same CLI, offset +60/+60.
        e.preventDefault();
        const st = useBoard.getState();
        const agentId = selRef.current.map((s) => s.id).find((id) => st.agents[id]);
        if (agentId) {
          const a = st.agents[agentId];
          const p = st.positions[agentId];
          if (p) st.setPendingSpawnPos({ x: p.x + 60, y: p.y + 60 });
          st.spawn(a.name, a.command ?? "bash", a.workspace_id ?? undefined, a.permission);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        const t = e.target as HTMLElement;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        useBoard.getState().undoMove();
      } else if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const st = useBoard.getState();
        const id = Object.keys(st.boards)[Number(e.key) - 1];
        if (id) st.setActiveBoard(id);
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        if (e.key === "f") {
          e.preventDefault();
          fitView({ padding: 0.2, duration: 300 });
        } else if (e.key === "?") {
          e.preventDefault();
          setPalette(true);
        } else if (e.key === "1") {
          e.preventDefault();
          zoomTo(1, { duration: 300 });
        } else if (e.key === "t") {
          e.preventDefault();
          useBoard.getState().gatherLoose();
        } else if (e.key === "Backspace" || e.key === "Delete") {
          // Close selected tool/terminal cards. Agents are excluded — they
          // need the explicit kill confirm, never a bare Delete.
          const b = useBoard.getState();
          for (const s of selRef.current) {
            if (s.id.startsWith("panel-")) b.closePanelNode(s.id);
            else if (s.id.startsWith("term-")) b.closeTermNode(s.id);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pencil]);

  const baseNodes = useMemo<Node<BoardNodeData>[]>(() => {
    const wsNodes: Node<BoardNodeData>[] = Object.values(workspaces)
      .filter((w) => (w.board_id ?? "main") === activeBoard)
      .map((w) => ({
      id: w.id,
      type: "workspace" as const,
      deletable: false,
      position: positions[w.id] ?? { x: 60, y: 60 },
      style: { width: workspaceSizes[w.id]?.w ?? 900, height: workspaceSizes[w.id]?.h ?? 540 },
      className: "cv-workspace-node",
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
        (ws ? { x: 60 + (i % 3) * 300, y: 80 + Math.floor(i / 3) * 190 } : { x: 1000 + (i % 2) * 500, y: 60 + Math.floor(i / 2) * 300 });
      i += 1;
      const csz = agentSizes[a.id];
      return {
        id: a.id,
        type: "agent" as const,
      deletable: false,
        position,
        ...(csz ? { style: { width: csz.w, ...(csz.h ? { height: csz.h } : {}) } } : {}),
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
          restored: a.restored,
        },
      };
    });
    // Mock board only renders in offline/demo mode — with a daemon the
    // canvas shows reality, not fixtures.
    const webNs: Node<BoardNodeData>[] = Object.entries(webNodes[activeBoard] ?? {}).map(
      ([id, url]) => ({
        id,
        type: "web" as const,
        deletable: true,
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
      deletable: false,
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
      deletable: true,
      position: { x: s.x, y: s.y },
      style: { width: s.w, height: s.h },
      data: { kind: "shape" as const, shape: s },
    }));
    const mdNs: Node<BoardNodeData>[] = Object.entries(mdNodes[activeBoard] ?? {}).map(
      ([id, path]) => ({
        id,
        type: "md" as const,
        deletable: true,
        position: positions[id] ?? { x: 640, y: 160 },
        style: { width: (mdNodeSizes[`${activeBoard}:${id}`] ?? mdNodeSizes[id])?.w ?? 340, height: (mdNodeSizes[`${activeBoard}:${id}`] ?? mdNodeSizes[id])?.h ?? 260 },
        data: { kind: "md" as const, id, path },
      }),
    );
    const panelNs: Node<BoardNodeData>[] = Object.entries(panelNodes[activeBoard] ?? {}).map(
      ([id, n]) => ({
        id,
        type: "panel" as const,
        deletable: true,
        position: { x: n.x, y: n.y },
        style: { width: n.w, height: n.h },
        draggable: !n.locked,
        zIndex: cardZ[id] ?? 0,
        data: { kind: "panel" as const, id },
      }),
    );
    const termNs: Node<BoardNodeData>[] = Object.entries(termNodes[activeBoard] ?? {}).map(
      ([id, n]) => ({
        id,
        type: "term" as const,
        position: { x: n.x, y: n.y },
        style: { width: n.w, height: n.h },
        draggable: !n.locked,
        zIndex: cardZ[id] ?? 0,
        data: { kind: "term" as const, id },
      }),
    );
    // Demo mock only when the daemon was never connected AND there's no
    // persisted state — a transient disconnect keeps the real board.
    const useMock = !connected && Object.keys(agents).length === 0;
    return useMock
      ? [...initialNodes, ...shapeNs, ...mdNs, ...webNs, ...live, ...orchNs, ...panelNs, ...termNs]
      : [...wsNodes, ...shapeNs, ...mdNs, ...webNs, ...live, ...orchNs, ...panelNs, ...termNs];
  }, [agents, positions, connected, workspaces, workspaceSizes, approvals, attention, activeBoard, webNodes, orchestrators, liveEdges, shapes, mdNodes, mdNodeSizes, panelNodes, termNodes, cardZ, agentSizes]);

  // Controlled React Flow needs change application for selection and drag to
  // stick. rfNodes is the rendered array: baseNodes is re-derived from the
  // store, then merged over rfNodes so each node's `selected`/`dragging` flags
  // (and in-flight drag position) survive every store re-render.
  const [rfNodes, setRfNodes] = useNodesState<Node<BoardNodeData>>(baseNodes);
  // Node identity cache: baseNodes rebuilds every node object on each store
  // write (activity flushes every 400ms while agents output), which made
  // React Flow re-render the whole canvas. Reuse the previous object when
  // the node's defining inputs are unchanged so unchanged cards don't
  // re-render.
  const nodeSigCache = useRef(new Map<string, { sig: string; node: Node<BoardNodeData> }>());
  useEffect(() => {
    setRfNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      const out = baseNodes.map((b) => {
        const sig = JSON.stringify(b);
        const cached = nodeSigCache.current.get(b.id);
        let base = b;
        if (cached?.sig === sig) base = cached.node;
        else nodeSigCache.current.set(b.id, { sig, node: b });
        const p = byId.get(b.id);
        if (!p) return base;
        if (p.dragging) {
          return { ...base, selected: p.selected, dragging: true, position: p.position };
        }
        // Reuse the previous node only while its geometry still matches the
        // store-derived node. A maximize/restore can update the store before
        // React Flow has flushed its measured position and size; blindly
        // reusing that stale object leaves restored cards at viewport size.
        const hasControlledCardGeometry = /^(panel|term)-/.test(b.id);
        const geometryMatches = !hasControlledCardGeometry || (
          p.position.x === base.position.x &&
          p.position.y === base.position.y &&
          p.style?.width === base.style?.width &&
          p.style?.height === base.style?.height
        );
        if (cached?.sig === sig && geometryMatches) return p;
        return { ...base, selected: p.selected, dragging: p.dragging };
      });
      const alive = new Set(baseNodes.map((n) => n.id));
      for (const k of nodeSigCache.current.keys()) {
        if (!alive.has(k)) nodeSigCache.current.delete(k);
      }
      return out;
    });
  }, [baseNodes, setRfNodes]);
  const onNodesChange = useCallback(
    (changes: NodeChange<Node<BoardNodeData>>[]) =>
      setRfNodes((ns) => applyNodeChanges(changes, ns)),
    [setRfNodes],
  );

  const onNodeClick: NodeMouseHandler = (e, node) => {
    // Shift+click is multi-select — don't rewire.
    if (e.shiftKey) return;
    // In Connect mode a click on an agent card wires/unwires it to the
    // orchestrator. Otherwise React Flow keeps the click as pure selection.
    if (wiringFrom && agents[node.id]) {
      toggleWire(wiringFrom, node.id);
      return;
    }
    // Click selects the card — nothing more. Opening a terminal is
    // double-click (expands in place) or the card's own buttons; the
    // bottom-right drawer never appears as a confusing duplicate.
  };

  // Double-click opens an agent's terminal; single click remains selection.
  // A pinned card's double-click also reopens the panel it was pinned from.
  const onNodeDoubleClick: NodeMouseHandler = (_, node) => {
    const sh = shapes[activeBoard ?? "main"]?.[node.id];
    if (sh?.kind === "pin" && sh.anchor) {
      useBoard.getState().requestNav(sh.anchor);
    }
    // Double-click an agent card expands its terminal IN PLACE — popped out
    // as a full canvas card instead of the bottom-right drawer duplicate.
    const termId = `term-${node.id}`;
    const termExists = !!useBoard.getState().termNodes[activeBoard ?? "main"]?.[termId];
    if (agents[node.id]) {
      if (termExists) {
        // Already expanded — focus THAT card instead of zooming the agent
        // and leaving the terminal offscreen.
        useBoard.getState().requestFocus(termId);
        return;
      }
      useBoard.getState().openTermNode(node.id);
      // Close the drawer copy — the canvas card replaces it, same as the
      // drawer's own pop-out button does.
      setOpenTerms((ts) => ts.filter((t) => t.id !== node.id));
    }
    fitView({ nodes: [{ id: node.id }], padding: 0.9, maxZoom: 1.4, duration: 300 });
  };

  const onNodeContextMenu: NodeMouseHandler = (ev, node) => {
    ev.preventDefault();
    // Deska-style window menu on canvas cards (panels + popped-out terms).
    if (/^(panel|term)-/.test(node.id)) {
      setCardMenu({ x: ev.clientX, y: ev.clientY, id: node.id });
      return;
    }
    if (node.id.startsWith("shape-")) {
      setShapeMenu({ x: ev.clientX, y: ev.clientY, id: node.id });
      return;
    }
    const id = node.id;
    if (!agents[id] && !workspaces[id]) return;
    setMenu({ x: ev.clientX, y: ev.clientY, id });
  };

  // Snap + alignment guides: a dragging card snaps when its edges/center
  // come within 8px of another visible card's edges/center, with thin
  // guide lines at the matched positions.
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const SNAP = 8;
  const snapFor = (node: { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number } }) => {
    const w = node.measured?.width ?? 240;
    const h = node.measured?.height ?? 120;
    const selfX = [node.position.x, node.position.x + w / 2, node.position.x + w];
    const selfY = [node.position.y, node.position.y + h / 2, node.position.y + h];
    let dx = 0, dy = 0, bestX = SNAP + 1, bestY = SNAP + 1;
    const v: number[] = [], hh: number[] = [];
    for (const o of getNodes()) {
      if (o.id === node.id) continue;
      const ow = o.measured?.width ?? 240;
      const oh = o.measured?.height ?? 120;
      for (const tx of [o.position.x, o.position.x + ow / 2, o.position.x + ow]) {
        for (const sx of selfX) {
          const d = Math.abs(tx - sx);
          if (d <= SNAP && d < bestX) { bestX = d; dx = tx - sx; }
        }
      }
      for (const ty of [o.position.y, o.position.y + oh / 2, o.position.y + oh]) {
        for (const sy of selfY) {
          const d = Math.abs(ty - sy);
          if (d <= SNAP && d < bestY) { bestY = d; dy = ty - sy; }
        }
      }
    }
    if (bestX <= SNAP) {
      for (const o of getNodes()) {
        if (o.id === node.id) continue;
        const ow = o.measured?.width ?? 240;
        for (const tx of [o.position.x, o.position.x + ow / 2, o.position.x + ow]) {
          for (const sx of selfX) if (Math.abs(tx - (sx + dx)) < 0.5 && !v.includes(tx)) v.push(tx);
        }
      }
    }
    if (bestY <= SNAP) {
      for (const o of getNodes()) {
        if (o.id === node.id) continue;
        const oh = o.measured?.height ?? 120;
        for (const ty of [o.position.y, o.position.y + oh / 2, o.position.y + oh]) {
          for (const sy of selfY) if (Math.abs(ty - (sy + dy)) < 0.5 && !hh.includes(ty)) hh.push(ty);
        }
      }
    }
    return { dx: bestX <= SNAP ? dx : 0, dy: bestY <= SNAP ? dy : 0, v, h: hh };
  };
  const onNodeDrag: OnNodeDrag = (_, node) => {
    const s = snapFor(node);
    setGuides({ v: s.dx ? s.v : [], h: s.dy ? s.h : [] });
    setDragGhost({
      x: node.position.x,
      y: node.position.y,
      w: node.measured?.width ?? 200,
      h: node.measured?.height ?? 90,
    });
  };

  // OS drag & drop — a file dropped on the canvas becomes a markdown card:
  // .md keeps its text, images embed as data URLs, anything else is a
  // name + size stub. Written into the vault and pinned at the drop point.
  const onCanvasDrop = useCallback(async (e: React.DragEvent) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    const dir = useBoard.getState().vaultDir;
    if (!dir) {
      useBoard.getState().notify("drop needs a mounted vault — open the Obsidian panel first");
      return;
    }
    const pt = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const fmtSize = (b: number) =>
      b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
    const read = (f: File, as: "text" | "data") =>
      new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(r.error);
        if (as === "text") r.readAsText(f); else r.readAsDataURL(f);
      });
    const files = Array.from(e.dataTransfer.files);
    for (const [fi, f] of files.entries()) {
      const safe = f.name.replace(/[\\:*?"<>|\[\]]/g, "-").replace(/\.md$/i, "");
      let body: string;
      try {
        if (f.name.toLowerCase().endsWith(".md") || f.type === "text/markdown") {
          body = await read(f, "text");
        } else if (f.type.startsWith("image/") && f.size <= 3 * 1024 * 1024) {
          body = `# ${f.name}\n\n![${safe}](${await read(f, "data")})\n`;
        } else {
          body = `# ${f.name}\n\nDropped file — ${fmtSize(f.size)}${f.type ? `, ${f.type}` : ""}.\n`;
        }
      } catch {
        body = `# ${f.name}\n\nDropped file — contents could not be read.\n`;
      }
      let path = `${safe}.md`;
      const existing = new Set(useBoard.getState().vaultEntries.map((e) => e.toLowerCase()));
      for (let n = 2; existing.has(path.toLowerCase()); n++) path = `${safe}-${n}.md`;
      useBoard.getState().vaultWrite(path, body);
      // vaultWrite is fire-and-forget — give the daemon a beat before the
      // card pins and reads the note back.
      setTimeout(() => useBoard.getState().mdNodeAdd(path, undefined, { x: pt.x + fi * 28, y: pt.y + fi * 28 }), 400);
    }
  }, [screenToFlowPosition]);


  const onNodeDragStop: OnNodeDrag = (event, node) => {
    // Deska-style: dropping a card on a board tab moves it there.
    setDragGhost(null);
    const pt =
      "changedTouches" in event && event.changedTouches.length
        ? event.changedTouches[0]
        : (event as MouseEvent);
    // The dragged card itself is under the cursor at drop time — walk the
    // stack past every .react-flow__node until something else is hit.
    const target = document
      .elementsFromPoint(pt.clientX, pt.clientY)
      .filter((el) => !el.closest(".react-flow__node"))
      .map((el) => el.closest("[data-board-tab]")?.getAttribute("data-board-tab"))
      .find(Boolean);
    if (target) {
      const a = agents[node.id] ?? workspaces[node.id];
      if (a) {
        if (target !== (a.board_id ?? "main")) {
          useBoard.getState().moveToBoard(node.id, target);
          return;
        }
      } else if (/^(term|panel|shape|md|web|orch)-/.test(node.id)) {
        if (target !== useBoard.getState().activeBoard) {
          useBoard.getState().moveCardToBoard(node.id, target);
          return;
        }
      }
    }
    const s0 = snapFor(node);
    setGuides({ v: [], h: [] });
    const x = node.position.x + s0.dx;
    const y = node.position.y + s0.dy;
    if (node.id.startsWith("shape-")) {
      moveShape(node.id, x, y);
    } else if (node.id.startsWith("panel-")) {
      useBoard.getState().movePanelNode(node.id, x, y);
    } else if (node.id.startsWith("term-")) {
      useBoard.getState().moveTermNode(node.id, x, y);
    } else if (agents[node.id] || workspaces[node.id] || node.id.startsWith("web-") || node.id.startsWith("orch-") || node.id.startsWith("md-")) {
      moveNode(node.id, x, y);
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
    if (!connected && Object.keys(agents).length === 0) return initialEdges;
    // An edge is visible when its delegating node is on this board.
    const delegEdges = Object.values(liveEdges)
      .filter(
        (e) =>
          (agents[e.from]?.board_id ??
            orchestrators[e.from]?.board ??
            agents[e.to]?.board_id ??
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
    // A thin dashed thread from each agent card to its popped-out
    // terminal card — shows ownership at a glance.
    const termOwnEdges = Object.keys(termNodes[activeBoard] ?? {})
      .filter((id) => agents[id.slice(5)])
      .map((id) => ({
        id: `own-${id}`,
        source: id.slice(5),
        target: id,
        type: "default" as const,
        style: { stroke: "var(--cv-accent)", strokeDasharray: "4 6", strokeWidth: 1.5, opacity: 0.85 },
        animated: false,
        selectable: false,
      }));
    return [...delegEdges, ...wireEdges, ...termOwnEdges];
  }, [connected, liveEdges, agents, activeBoard, orchestrators, termNodes]);

  return (
    <PanelActionsCtx.Provider value={{ openTerm, openEdgeDetail: setEdgeDetail }}>
    <div className="relative h-full w-full">
      {!chromeHidden && (
        <>
          <NavRail
            active={nav}
            onSelect={navToggle}
          />
          <RightRail />
          <BottomDock
            active={nav}
            onSelect={navToggle}
          />
          <Topbar
            nav={nav}
            onNav={navToggle}
            tools={{
              onDigest: () => useBoard.getState().digestNow(),
              onShot: () => void shotCanvas(),
              onStudio: () => useBoard.getState().studioDocNow(),
              onDraw: () => setPencil((m) => !m),
              onRegion: () => setShotMode((m) => !m),
              onAddToBoard: addPanelToBoard,
              drawOn: pencil,
              regionOn: shotMode,
            }}
          />
        </>
      )}
      {chromeHidden && (
        <button
          className="glass-pill"
          onClick={() => useBoard.getState().toggleChrome()}
          title="Show panels and menus"
          style={{
            position: "absolute",
            left: 14,
            // Clear the overlay-titlebar traffic lights on macOS/Tauri.
            top: isTauri() ? 52 : 14,
            zIndex: 20,
            width: 36,
            height: 36,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
          }}
        >
          <Icon name="eye" size={16} color="var(--cv-ink-dim)" />
        </button>
      )}
      {pencil && (
        <div
          style={{ position: "absolute", inset: 0, zIndex: 29, cursor: "crosshair", pointerEvents: drawing ? "auto" : "none" }}
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
            style={{ position: "absolute", right: 20, top: 52, zIndex: 1, fontSize: 10.5, padding: "5px 12px", cursor: "pointer", border: "none", color: "var(--cv-ink-dim)", pointerEvents: "auto" }}
            onClick={(e) => { e.stopPropagation(); setStrokes([]); }}
          >
            clear strokes
          </button>
          <button
            className="glass-pill"
            title="Turn off pencil (Esc)"
            style={{ position: "absolute", right: 20, top: 84, zIndex: 1, fontSize: 10.5, padding: "5px 12px", cursor: "pointer", border: "none", color: "var(--cv-accent)", pointerEvents: "auto" }}
            onClick={(e) => { e.stopPropagation(); setDrawing(null); setPencil(false); }}
          >
            done drawing
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
                background: "color-mix(in srgb, var(--cv-accent) 8%, transparent)",
                borderRadius: 8,
              }}
            />
          )}
        </div>
      )}
      {!chromeHidden && <SpawnBar />}
      <ReactFlow
        nodes={rfNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onDrop={onCanvasDrop}
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); }}
        onConnectEnd={onConnectEnd}
        onEdgeClick={(_, edge) => setEdgeDetail(edge.id)}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          setPaneMenu({ x: e.clientX, y: e.clientY });
        }}
        onPaneClick={() => {
          setEdgeDetail(null);
          setWiring(null);
        }}
        zoomOnDoubleClick={false}
        onDoubleClick={(e) => {
          // Deska-style: double-click empty canvas spawns an agent there.
          const t = e.target as HTMLElement;
          if (!t.classList.contains("react-flow__pane")) return;
          const st = useBoard.getState();
          st.setPendingSpawnPos(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
          st.setSpawnOpen(true);
        }}
        onInit={(rf) => rf.fitView({ padding: 0.18, maxZoom: 1.1 })}
        minZoom={0.15}
        maxZoom={2}
        selectionOnDrag
        panOnDrag={[1, 2]}
        panOnScroll
        zoomOnScroll={false}
        onlyRenderVisibleElements
        selectionKeyCode={null}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={["Backspace", "Delete"]}
        onNodesDelete={(deleted) => {
          const st = useBoard.getState();
          for (const n of deleted) {
            if (n.type === "shape") st.deleteShape(n.id);
            else if (n.type === "md") st.mdNodeRemove(n.id);
            else if (n.type === "web") st.webNodeRemove(n.id);
            else if (n.type === "panel") st.closePanelNode(n.id);
          }
        }}
        onSelectionChange={({ nodes }) =>
          setSel(
            nodes.map((n) => ({
              id: n.id,
              x: n.position.x,
              y: n.position.y,
              w: n.measured?.width ?? 460,
              h: n.measured?.height ?? 220,
            })),
          )
        }
        proOptions={{ hideAttribution: true }}
      >
        {/* resize grip at the minimap's top-left corner — drag to resize */}
        <div
          title="Resize minimap"
          style={{
            position: "absolute",
            right: 10 + 84 + mmSize.w - 5,
            bottom: 10 + mmSize.h - 5,
            width: 10,
            height: 10,
            cursor: "nwse-resize",
            zIndex: 10,
            borderRadius: 2,
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            const sx = e.clientX;
            const sy = e.clientY;
            const sw = mmSize.w;
            const sh = mmSize.h;
            const move = (ev: PointerEvent) => {
              const next = {
                w: Math.min(320, Math.max(96, sw + (sx - ev.clientX))),
                h: Math.min(220, Math.max(64, sh + (sy - ev.clientY))),
              };
              setMmSize(next);
              localStorage.setItem("cv-minimap-size", JSON.stringify(next));
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          style={{
            width: mmSize.w,
            height: mmSize.h,
            marginRight: 184,
            "--xy-minimap-mask-background-color": "var(--cv-minimap-mask)",
            "--xy-minimap-mask-stroke-color": "var(--cv-accent)",
            "--xy-minimap-node-stroke-color": "var(--cv-minimap-node-stroke)",
          } as React.CSSProperties}
          className="!bg-[var(--cv-base)]"
          maskStrokeWidth={1.5}
          nodeStrokeWidth={1}
          nodeColor={(n) => {
            const data = n.data as Partial<BoardNodeData>;
            if (data.kind === "orchestrator") return "#f5a524";
            if (data.kind === "workspace") return "#1d1d20";
            if (data.kind === "agent" && data.status) {
              const map: Record<AgentStatus, string> = {
                working: "#34c77b",
                waiting: "#f5b83d",
                blocked: "#e0695f",
                done: "#54c48e",
                idle: "#55565c",
              };
              return map[data.status] ?? "#33333a";
            }
            return "#33333a";
          }}
          onClick={(_e, pos) => setCenter(pos.x, pos.y, { zoom: getZoom(), duration: 250 })}
          onNodeClick={(_e, node) =>
            setCenter(node.position.x + (node.measured?.width ?? 0) / 2, node.position.y + (node.measured?.height ?? 0) / 2, { zoom: Math.max(getZoom(), 0.9), duration: 250 })
          }
        />
        <ViewportTracker />
        <AnchorCables nav={nav} />
              <ViewportPortal>
          {guides.v.map((x) => (
            <div key={`gv${x}`} style={{ position: "absolute", left: x, top: -100000, width: 0, height: 200000, borderLeft: "1px dashed var(--cv-accent)", pointerEvents: "none", opacity: 0.7 }} />
          ))}
          {guides.h.map((y) => (
            <div key={`gh${y}`} style={{ position: "absolute", top: y, left: -100000, height: 0, width: 200000, borderTop: "1px dashed var(--cv-accent)", pointerEvents: "none", opacity: 0.7 }} />
          ))}
        </ViewportPortal>
        {dragGhost && (
          <ViewportPortal>
            <div
              style={{
                position: "absolute",
                transform: `translate(${dragGhost.x}px, ${dragGhost.y}px)`,
                width: dragGhost.w,
                height: dragGhost.h,
                border: "1.5px dashed var(--cv-accent)",
                borderRadius: 14,
                background: "rgba(201,162,107,0.08)",
                pointerEvents: "none",
              }}
            />
          </ViewportPortal>
        )}
      </ReactFlow>
      {connected === false && null}
      <DigestPanel />
      <StudioPanel />
      <NoticePill />
      {sel.length >= 2 && !chromeHidden && (
        <button
          className="glass"
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: 64,
            zIndex: 21,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 16px",
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            color: "var(--cv-ink)",
            fontSize: 12,
            fontWeight: 600,
          }}
          onClick={() => {
            const x0 = Math.min(...sel.map((n) => n.x));
            const y0 = Math.min(...sel.map((n) => n.y));
            const x1 = Math.max(...sel.map((n) => n.x + n.w));
            const y1 = Math.max(...sel.map((n) => n.y + n.h));
            const label = useBoard.getState().frameNodes(x0 - 26, y0 - 46, x1 - x0 + 52, y1 - y0 + 56);
            useBoard.getState().notify(`${label} created — ${sel.length} windows`);
            setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
          }}
        >
          Group {sel.length} windows
        </button>
      )}
      {paneMenu && (
        <PaneMenu x={paneMenu.x} y={paneMenu.y} onClose={() => setPaneMenu(null)} />
      )}
      {cardMenu && (
        <CardMenu
          x={cardMenu.x}
          y={cardMenu.y}
          nodeId={cardMenu.id}
          onAgentMenu={
            cardMenu.id.startsWith("term-")
              ? () => setMenu({ x: cardMenu.x, y: cardMenu.y, id: cardMenu.id.slice(5) })
              : undefined
          }
          onClose={() => setCardMenu(null)}
        />
      )}
      {shapeMenu && (
        <div
          className="glass"
          style={{
            position: "fixed",
            left: shapeMenu.x,
            top: shapeMenu.y,
            zIndex: 60,
            minWidth: 170,
            padding: 6,
            borderRadius: 12,
          }}
          onMouseLeave={() => setShapeMenu(null)}
        >
          {[
            { icon: "draw", label: "Rename region", fn: () => useBoard.getState().requestFocus(shapeMenu.id) },
            { icon: "x", label: "Dissolve region", fn: () => useBoard.getState().deleteShape(shapeMenu.id) },
          ].map((r) => (
            <button
              key={r.label}
              onClick={() => { r.fn(); setShapeMenu(null); }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--cv-glass-hi)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              style={{
                display: "flex", alignItems: "center", gap: 9, width: "100%",
                textAlign: "left", border: "none", background: "transparent",
                color: "var(--cv-ink-dim)", fontSize: 12, padding: "6px 10px",
                borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              <Icon name={r.icon} size={13} color="var(--cv-ink-faint)" />
              {r.label}
            </button>
          ))}
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          nodeId={menu.id}
          isAgent={!!agents[menu.id]}
          multi={sel.map((s) => s.id).filter((id) => !!agents[id])}
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
            // Palette commands are explicit open/focus actions. Keep rail
            // clicks as toggles, but never let a search result close its panel.
            if (PANEL_DEFS[k]) {
              const b = useBoard.getState();
              if (b.panelNodes[b.activeBoard]?.[`panel-${k}`]) b.requestFocus(`panel-${k}`);
              else {
                const def = PANEL_DEFS[k];
                const sx = k === "inbox" ? window.innerWidth - def.w - 24 : window.innerWidth * 0.42;
                b.openPanelNode(k, screenToFlowPosition({ x: sx, y: window.innerHeight * 0.1 }), { w: def.w, h: def.h });
              }
            }
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
    </PanelActionsCtx.Provider>
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
