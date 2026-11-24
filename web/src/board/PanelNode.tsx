import { memo } from "react";
import { NodeResizer, useReactFlow, type NodeProps } from "@xyflow/react";
import { useBoard } from "../store/board";
import { Icon } from "../components/icons";
import { PANEL_DEFS } from "../components/panelRegistry";

/** A tool panel living on the canvas — Deska "Add to board": the live
 * panel UI inside a real card (title bar, close X, resizable, movable
 * like any node). */
export const PanelNode = memo(function PanelNode({ id, selected }: NodeProps) {
  const rf = useReactFlow();
  const n = useBoard((s) => s.panelNodes[s.activeBoard]?.[id]);
  if (!n) return null;
  const def = PANEL_DEFS[n.panel];
  if (!def) return null;
  return (
    <div
      className="glass"
      data-panel={n.panel}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: selected
          ? "0 0 0 1.5px color-mix(in srgb, var(--cv-accent) 55%, transparent), var(--cv-shadow)"
          : "var(--cv-shadow)",
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={def.minW ?? 240}
        minHeight={def.minH ?? 180}
        onResizeEnd={(_, p) =>
          useBoard.getState().resizePanelNode(id, Math.round(p.width), Math.round(p.height))
        }
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "6px 8px 6px 11px",
          borderBottom: "1px solid var(--cv-glass-edge)",
          flexShrink: 0,
          cursor: "grab",
        }}
        onDoubleClick={() => useBoard.getState().collapsePanelNode(id)}
      >
        {def.img ? (
          <img src={def.img} alt="" width={14} height={14} style={{ display: "block" }} />
        ) : (
          <Icon name={def.icon ?? "panels"} size={13} color="var(--cv-ink-dim)" />
        )}
        <span style={{ fontSize: 11, fontWeight: 650, color: "var(--cv-ink)" }}>{def.title}</span>
        <span style={{ flex: 1 }} />
        <button
          className="nodrag"
          title={n.collapsed ? "Expand" : "Collapse"}
          onClick={() => useBoard.getState().collapsePanelNode(id)}
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "var(--cv-ink-faint)",
            fontSize: 12,
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          {n.collapsed ? "▸" : "–"}
        </button>
        <button
          className="nodrag"
          title="Dock to the right edge of the view"
          onClick={() => {
            const { screenToFlowPosition } = rf;
            const p = screenToFlowPosition({ x: window.innerWidth - (n.w + 20), y: 20 });
            useBoard.getState().movePanelNode(id, p.x, p.y);
          }}
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "var(--cv-ink-faint)",
            fontSize: 11,
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          ⬈
        </button>
        <button
          className="nodrag"
          title="Close panel"
          onClick={() => {
            useBoard.getState().closePanelNode(id);
            useBoard.getState().requestNav("canvas");
          }}
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "var(--cv-ink-faint)",
            fontSize: 13,
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          ×
        </button>
      </div>
      {!n.collapsed && (
        <div className="nodrag nowheel" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {def.render()}
        </div>
      )}
    </div>
  );
});
