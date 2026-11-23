import { useEffect, useRef, useState } from "react";
import { useBoard } from "../store/board";

// Right-click menu on a node — Deska-style node actions: open terminal,
// move to another board, kill (inline two-step confirm).
export function ContextMenu({
  x,
  y,
  nodeId,
  isAgent,
  onOpenTerminal,
  onClose,
}: {
  x: number;
  y: number;
  nodeId: string;
  isAgent: boolean;
  onOpenTerminal: () => void;
  onClose: () => void;
}) {
  const boards = useBoard((s) => s.boards);
  const moveToBoard = useBoard((s) => s.moveToBoard);
  const kill = useBoard((s) => s.kill);
  const current = useBoard(
    (s) => s.agents[nodeId]?.board_id ?? s.workspaces[nodeId]?.board_id ?? "main",
  );
  const [confirmKill, setConfirmKill] = useState(false);
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

  return (
    <div
      ref={ref}
      className="glass"
      style={{
        position: "fixed",
        left: Math.min(x, window.innerWidth - 220),
        top: Math.min(y, window.innerHeight - 200),
        zIndex: 60,
        minWidth: 190,
        padding: 6,
        borderRadius: 12,
      }}
    >
      {isAgent && (
        <button style={item} onClick={() => { onOpenTerminal(); onClose(); }}>
          open terminal
        </button>
      )}
      <div style={{ position: "relative" }}>
        <button
          style={{ ...item, color: "var(--cv-ink-dim)" }}
          onClick={() => setBoardsOpen((o) => !o)}
        >
          move to board ▸
        </button>
        {boardsOpen && (
          <div
            className="glass"
            style={{
              position: "absolute",
              left: "100%",
              top: 0,
              marginLeft: 6,
              minWidth: 140,
              padding: 6,
              borderRadius: 12,
            }}
          >
            {Object.entries(boards).map(([id, name]) => (
              <button
                key={id}
                style={{
                  ...item,
                  color: id === current ? "var(--cv-accent)" : "var(--cv-ink)",
                }}
                onClick={() => { moveToBoard(nodeId, id); onClose(); }}
              >
                {id === current ? "✓ " : ""}{name}
              </button>
            ))}
          </div>
        )}
      </div>
      {isAgent && (
        <button
          style={{
            ...item,
            color: confirmKill ? "var(--cv-blocked)" : "var(--cv-ink-dim)",
          }}
          onClick={() => {
            if (confirmKill) { kill(nodeId); onClose(); }
            else setConfirmKill(true);
          }}
        >
          {confirmKill ? "confirm kill?" : "kill agent"}
        </button>
      )}
    </div>
  );
}
