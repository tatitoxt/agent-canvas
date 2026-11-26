import { useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useBoard } from "../store/board";
import { Icon } from "./icons";

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

  const row = (
    icon: string,
    label: string,
    onClick: () => void,
    opts?: { danger?: boolean; checked?: boolean },
  ) => (
    <button
      key={label}
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--cv-glass-hi)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        textAlign: "left",
        border: "none",
        background: "transparent",
        color: opts?.danger ? "#e05d5d" : "var(--cv-ink-dim)",
        fontSize: "var(--cv-text-xs)",
        padding: "6px 10px",
        borderRadius: 8,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <Icon name={icon} size={13} color={opts?.danger ? "#e05d5d" : "var(--cv-ink-faint)"} />
      <span style={{ flex: 1 }}>{label}</span>
      {opts?.checked && <span style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-accent)" }}>✓</span>}
    </button>
  );
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
        top: Math.min(y, window.innerHeight - 340),
        zIndex: 60,
        minWidth: 205,
        padding: 6,
        borderRadius: 12,
      }}
    >
      {row("eye", "View panel summary", () => { st.togglePanelSummaries(); onClose(); })}
      {sep}
      {row("x", "Close", () => { close(); onClose(); }, { danger: true })}
      {row("x", "Close All", () => { st.closeAllCards(); onClose(); })}
      {sep}
      {row("minus", card?.collapsed ? "Expand" : "Minimize", () => { collapse(); onClose(); })}
      {isPanel && (
        <>
          {row("split", "Split Right", () => { st.splitPanelCard(nodeId, "right"); onClose(); })}
          {row("split", "Split Down", () => { st.splitPanelCard(nodeId, "down"); onClose(); })}
        </>
      )}
      {row("zoom", "Maximize", () => { maximize(); onClose(); })}
      {row("pin", "Pin to the screen", () => { dockRight(); onClose(); })}
      {row("lock", "Lock position", () => { st.toggleCardLock(nodeId); onClose(); }, { checked: !!card?.locked })}
      {sep}
      {row("arrowup", "Move to front", () => { st.bringCardToFront(nodeId); onClose(); })}
      {row("arrowdown", "Move to back", () => { st.sendCardToBack(nodeId); onClose(); })}
      <div style={{ position: "relative" }}>
        {row("boards", "Move to board ▸", () => setBoardsOpen((o) => !o))}
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
                onClick={() => { st.moveCardToBoard(nodeId, id); onClose(); }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background: "transparent",
                  color: "var(--cv-ink-dim)",
                  fontSize: "var(--cv-text-xxs)",
                  padding: "6px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
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
          {row("terminal", "Agent actions…", () => { onAgentMenu(); onClose(); })}
        </>
      )}
    </div>
  );
}
