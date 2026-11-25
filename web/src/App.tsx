import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  MiniMap,
  ReactFlow,
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
import { MissionStrip } from "./components/MissionStrip";
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
  const { zoom } = useViewport();
  useEffect(() => {
    useBoard.setState({ zoomPct: Math.round(zoom * 100) });
  }, [zoom]);
  return null;
}

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
  const panelNodes = useBoard((s) => s.panelNodes);
  const termNodes = useBoard((s) => s.termNodes);
  const cardZ = useBoard((s) => s.cardZ);
  const wiringFrom = useBoard((s) => s.wiringFrom);
  const toggleWire = useBoard((s) => s.toggleWire);
  const setWiring = useBoard((s) => s.setWiring);
  const { screenToFlowPosition, fitView, getNodes, getZoom, zoomTo, setNodes } = useReactFlow();

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
  const [palette, setPalette] = useState(false);
  const edgeDetail = useBoard((s) => s.edgeDetail);
  const setEdgeDetail = useBoard((s) => s.setEdgeDetail);
  const [search, setSearch] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(null);
  const [shapeMenu, setShapeMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [mmSize, setMmSize] = useState({ w: 148, h: 96 });
  const [sel, setSel] = useState<Array<{ id: string; x: number; y: number; w: number; h: number }>>([]);
  const [missionOpen, setMissionOpen] = useState(false);
  const missionCounts = useMemo(() => {
    const c: Record<string, number> = { working: 0, waiting: 0, blocked: 0, done: 0 };
    for (const a of Object.values(agents)) {
      if ((a.board_id ?? "main") !== activeBoard) continue;
      if (attention[a.id]) c.blocked++;
      else if (a.status === "exited") c.done++;
      else if (a.status === "working" || a.status === "waiting" || a.status === "blocked") c[a.status]++;
    }
    return c;
  }, [agents, activeBoard, attention]);
  const selRef = useRef(sel);
  selRef.current = sel;
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
  }, []);

  const baseNodes = useMemo<Node<BoardNodeData>[]>(() => {
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
    const panelNs: Node<BoardNodeData>[] = Object.entries(panelNodes[activeBoard] ?? {}).map(
      ([id, n]) => ({
        id,
        type: "panel" as const,
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
  }, [agents, positions, connected, workspaces, approvals, attention, activeBoard, webNodes, orchestrators, liveEdges, shapes, mdNodes, panelNodes, termNodes, cardZ]);

  // Controlled React Flow needs change application for selection and drag to
  // stick. rfNodes is the rendered array: baseNodes is re-derived from the
  // store, then merged over rfNodes so each node's `selected`/`dragging` flags
  // (and in-flight drag position) survive every store re-render.
  const [rfNodes, setRfNodes] = useNodesState<Node<BoardNodeData>>(baseNodes);
  useEffect(() => {
    setRfNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return baseNodes.map((b) => {
        const p = byId.get(b.id);
        return p
          ? {
              ...b,
              selected: p.selected,
              dragging: p.dragging,
              position: p.dragging ? p.position : b.position,
            }
          : b;
      });
    });
  }, [baseNodes, setRfNodes]);
  const onNodesChange = useCallback(
    (changes: NodeChange<Node<BoardNodeData>>[]) =>
      setRfNodes((ns) => applyNodeChanges(changes, ns)),
    [setRfNodes],
  );

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
  // A pinned card's double-click also reopens the panel it was pinned from.
  const onNodeDoubleClick: NodeMouseHandler = (_, node) => {
    const sh = shapes[activeBoard ?? "main"]?.[node.id];
    if (sh?.kind === "pin" && sh.anchor) {
      useBoard.getState().requestNav(sh.anchor);
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

  const onNodeDragStop: OnNodeDrag = (event, node) => {
    // Deska-style: dropping a card on a board tab moves it there.
    const pt =
      "changedTouches" in event && event.changedTouches.length
        ? event.changedTouches[0]
        : (event as MouseEvent);
    const tabEl = document.elementFromPoint(pt.clientX, pt.clientY);
    const target = tabEl?.closest?.("[data-board-tab]")?.getAttribute("data-board-tab");
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
    if (node.id.startsWith("shape-")) {
      moveShape(node.id, node.position.x, node.position.y);
    } else if (node.id.startsWith("panel-")) {
      useBoard.getState().movePanelNode(node.id, node.position.x, node.position.y);
    } else if (node.id.startsWith("term-")) {
      useBoard.getState().moveTermNode(node.id, node.position.x, node.position.y);
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
    if (!connected && Object.keys(agents).length === 0) return initialEdges;
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
              onMission: () => setMissionOpen((o) => !o),
              drawOn: pencil,
              regionOn: shotMode,
            }}
          />
          <MissionStrip
            counts={missionCounts}
            open={missionOpen}
            onToggle={() => setMissionOpen((o) => !o)}
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
      {!chromeHidden && <SpawnBar />}
      <ReactFlow
        nodes={rfNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStop={onNodeDragStop}
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
              setMmSize({
                w: Math.min(320, Math.max(96, sw + (sx - ev.clientX))),
                h: Math.min(220, Math.max(64, sh + (sy - ev.clientY))),
              });
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
          style={{ width: mmSize.w, height: mmSize.h, marginRight: 184 }}
          className="!bg-[var(--cv-base)]"
          maskColor="rgba(14,14,16,0.55)"
          maskStrokeColor="var(--cv-accent)"
          maskStrokeWidth={1.5}
          nodeStrokeColor="rgba(255,255,255,0.25)"
          nodeStrokeWidth={1}
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
        <ViewportTracker />
        <AnchorCables nav={nav} />
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
