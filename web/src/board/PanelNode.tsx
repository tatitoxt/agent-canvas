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
      className="glass-panel"
      data-panel={n.panel}
      onClickCapture={(e) => {
        // Panel content sits inside `nodrag`, so React Flow never selects
        // the card when the click lands in a dead area (empty states,
        // padding, labels). Force-select unless the target is a real
        // interactive control.
        const t = e.target as HTMLElement;
        if (t.closest('button, a, input, select, textarea, [contenteditable="true"], [role="button"], [role="link"], [role="textbox"], [role="menuitem"], [role="tab"], [role="checkbox"]')) return;
        rf.setNodes((ns) =>
          ns.map((x) =>
            x.id === id
              ? { ...x, selected: true }
              : e.shiftKey
                ? x
                : x.selected
                  ? { ...x, selected: false }
                  : x,
          ),
        );
      }}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "var(--cv-card-shadow)",
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={def.minW ?? 240}
        minHeight={def.minH ?? 180}
        handleClassName="cv-node-resize-handle"
        lineClassName="cv-node-resize-line"
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
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) e.stopPropagation();
        }}
      >
        {def.img ? (
          <img src={def.img} alt="" width={14} height={14} style={{ display: "block" }} />
        ) : (
          <Icon name={def.icon ?? "panels"} size={13} color="var(--cv-ink-dim)" />
        )}
        <span style={{ fontSize: "var(--cv-text-sm)", fontWeight: 600, color: "var(--cv-text-main)" }}>{def.title}</span>
        <span style={{ flex: 1 }} />
        <span
          className="cv-card-chrome"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
        <button
          className="nodrag"
          title={n.collapsed ? "Expand" : "Collapse"}
          aria-label={n.collapsed ? "Expand panel" : "Minimize panel"}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); useBoard.getState().collapsePanelNode(id); }}
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "var(--cv-text-main)",
            fontSize: "var(--cv-text-xs)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon name={n.collapsed ? "ph-max" : "ph-min"} size={12} />
        </button>
        <button
          className="nodrag"
          title={n.maximized ? "Restore size" : "Maximize — fill the view"}
          aria-label={n.maximized ? "Restore panel size" : "Maximize panel"}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (n.maximized) {
              useBoard.getState().maximizePanelNode(id);
            } else {
              // y=64 keeps the title bar below the top chrome — otherwise
              // the restore button lands under the topbar and can't be clicked.
              const tl = rf.screenToFlowPosition({ x: 12, y: 64 });
              const br = rf.screenToFlowPosition({ x: window.innerWidth - 12, y: window.innerHeight - 12 });
              useBoard.getState().maximizePanelNode(id, { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y });
            }
          }}
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "var(--cv-text-main)",
            fontSize: "var(--cv-text-xxs)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon name={n.maximized ? "ph-restore" : "ph-max"} size={12} />
        </button>
        <button
          className="nodrag cv-card-close"
          title="Close panel"
          aria-label="Close panel"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            useBoard.getState().closePanelNode(id);
            useBoard.getState().requestNav("canvas");
          }}
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "var(--cv-text-main)",
            fontSize: "var(--cv-text-sm)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon name="ph-x" size={13} />
        </button>
        </span>
      </div>
      {!n.collapsed && (
        <div className="nodrag nowheel" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {def.render()}
        </div>
      )}
    </div>
  );
});
