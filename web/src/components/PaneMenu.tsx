import { useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { useBoard } from "../store/board";
import { PANEL_DEFS } from "./panelRegistry";
import { Icon } from "./icons";

/** Right-click on empty canvas — Deska "Add to board": drops any tool
 * panel as a card at the click point. */
export function PaneMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const { screenToFlowPosition } = useReactFlow();
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

  return (
    <div
      ref={ref}
      className="glass"
      style={{
        position: "fixed",
        left: Math.min(x, window.innerWidth - 200),
        top: Math.min(y, window.innerHeight - 420),
        zIndex: 60,
        minWidth: 168,
        maxHeight: 400,
        overflowY: "auto",
        padding: 6,
        borderRadius: 12,
      }}
    >
      <button
        onClick={() => {
          const p = screenToFlowPosition({ x, y });
          const b = useBoard.getState();
          b.setPendingTermPos({ x: p.x, y: p.y });
          b.spawn("terminal", "bash");
          onClose();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          textAlign: "left",
          border: "none",
          background: "transparent",
          color: "var(--cv-accent)",
          fontSize: 12,
          fontWeight: 600,
          padding: "6px 10px",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        <span style={{ color: "#7cb9ff", fontSize: 11 }}>›_</span>
        New terminal
      </button>
      <button
        onClick={() => {
          const p = screenToFlowPosition({ x, y });
          const b = useBoard.getState();
          b.setPendingSpawnPos({ x: p.x, y: p.y });
          b.setSpawnOpen(true);
          onClose();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          textAlign: "left",
          border: "none",
          background: "transparent",
          color: "var(--cv-accent)",
          fontSize: 12,
          fontWeight: 600,
          padding: "6px 10px",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        <span style={{ color: "var(--cv-accent)", fontSize: 12 }}>＋</span>
        New agent…
      </button>
      <div style={{ fontSize: 9.5, color: "var(--cv-ink-faint)", padding: "4px 10px 6px", letterSpacing: 0.6, textTransform: "uppercase" }}>
        Add to board
      </div>
      {Object.entries(PANEL_DEFS).map(([key, def]) => (
        <button
          key={key}
          onClick={() => {
            const p = screenToFlowPosition({ x, y });
            useBoard.getState().openPanelNode(key, p, { w: def.w, h: def.h });
            onClose();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            textAlign: "left",
            border: "none",
            background: "transparent",
            color: "var(--cv-ink)",
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          {def.img ? (
            <img src={def.img} alt="" width={13} height={13} style={{ display: "block" }} />
          ) : (
            <Icon name={def.icon ?? "panels"} size={12} color="var(--cv-ink-dim)" />
          )}
          {def.title}
        </button>
      ))}
    </div>
  );
}
