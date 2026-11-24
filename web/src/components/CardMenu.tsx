import { useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useBoard } from "../store/board";

/** Deska-style window menu for canvas cards (right-click / two-finger
 * press on a panel or terminal card): summaries, close, minimize,
 * maximize, lock position, z-order, close all. */
export function CardMenu({
  x,
  y,
  nodeId,
  onAgentMenu,
  onClose,
}: {
  x: number;
  y: number;
  nodeId: string;
  /** term cards also expose their owner agent's menu. */
  onAgentMenu?: () => void;
  onClose: () => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const [boardsOpen, setBoardsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const card = useBoard((s) =>
    nodeId.startsWith("panel-")
      ? s.panelNodes[s.activeBoard]?.[nodeId]
      : s.termNodes[s.activeBoard]?.[nodeId],
  );
  const boards = useBoard((s) => s.boards);
  const activeBoard = useBoard((s) => s.activeBoard);

  const item: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    border: "none",
    background: "transparent",
    color: "var(--cv-ink)",
    fontSize: 12,
    padding: "7px 12px",
    borderRadius: 8,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
  const dim = { ...item, color: "var(--cv-ink-dim)" };
  const sep = (
    <div style={{ height: 1, background: "var(--cv-glass-edge)", margin: "4px 6px" }} />
  );

  const st = useBoard.getState();
  const isPanel = nodeId.startsWith("panel-");
  const close = () => (isPanel ? st.closePanelNode(nodeId) : st.closeTermNode(nodeId));
  const collapse = () => (isPanel ? st.collapsePanelNode(nodeId) : st.collapseTermNode(nodeId));
  const resize = (w: number, h: number) =>
    isPanel ? st.resizePanelNode(nodeId, w, h) : st.resizeTermNode(nodeId, w, h);
  const move = (x2: number, y2: number) =>
    isPanel ? st.movePanelNode(nodeId, x2, y2) : st.moveTermNode(nodeId, x2, y2);

  const maximize = () => {
    // Fill the visible viewport with ~24px margins.
    const tl = screenToFlowPosition({ x: 24, y: 64 });
    const br = screenToFlowPosition({ x: window.innerWidth - 24, y: window.innerHeight - 88 });
    move(tl.x, tl.y);
    resize(Math.round(br.x - tl.x), Math.round(br.y - tl.y));
  };

  const dockRight = () => {
    const w = card?.w ?? 340;
    const p = screenToFlowPosition({ x: window.innerWidth - w - 20, y: 20 });
    move(p.x, p.y);
  };

  return (
    <div
      ref={ref}
      className="glass"
      style={{
        position: "fixed",
        left: Math.min(x, window.innerWidth - 230),
        top: Math.min(y, window.innerHeight - 320),
        zIndex: 60,
        minWidth: 200,
        padding: 6,
        borderRadius: 12,
      }}
    >
      <button style={dim} onClick={() => { useBoard.getState().togglePanelSummaries(); onClose(); }}>
        View panel summary
      </button>
      {sep}
      <button style={item} onClick={() => { close(); onClose(); }}>Close</button>
      <button style={dim} onClick={() => { useBoard.getState().closeAllCards(); onClose(); }}>
        Close All
      </button>
      {sep}
      <button style={item} onClick={() => { collapse(); onClose(); }}>
        {card?.collapsed ? "Expand" : "Minimize"}
      </button>
      <button style={dim} onClick={() => { maximize(); onClose(); }}>Maximize</button>
      <button style={dim} onClick={() => { dockRight(); onClose(); }}>Pin to the screen</button>
      <button style={dim} onClick={() => { useBoard.getState().toggleCardLock(nodeId); onClose(); }}>
        {card?.locked ? "Unlock position" : "Lock position"}
      </button>
      {sep}
      <button style={dim} onClick={() => { useBoard.getState().bringCardToFront(nodeId); onClose(); }}>
        Move to front
      </button>
      <button style={dim} onClick={() => { useBoard.getState().sendCardToBack(nodeId); onClose(); }}>
        Move to back
      </button>
      <div style={{ position: "relative" }}>
        <button style={dim} onClick={() => setBoardsOpen((o) => !o)}>
          move to board ▸
        </button>
        {boardsOpen && (
          <div
            className="glass"
            style={{
              position: "absolute",
              left: "calc(100% + 6px)",
              top: 0,
              minWidth: 140,
              padding: 6,
              borderRadius: 12,
            }}
          >
            {Object.entries(boards).map(([id, name]) => (
              <button
                key={id}
                style={{ ...item, fontSize: 11 }}
                onClick={() => { useBoard.getState().moveCardToBoard(nodeId, id); onClose(); }}
              >
                {id === activeBoard ? "✓ " : ""}{name}
              </button>
            ))}
          </div>
        )}
      </div>
      {onAgentMenu && (
        <>
          {sep}
          <button style={dim} onClick={() => { onAgentMenu(); onClose(); }}>
            agent actions…
          </button>
        </>
      )}
    </div>
  );
}
