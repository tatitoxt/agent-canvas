import { memo, useContext } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { useBoard } from "../store/board";
import { TermHost } from "../components/TermHost";
import { PanelActionsCtx } from "../components/panelCtx";
import { CliMark } from "../components/CliMark";
import { STATUS_COLOR, STATUS_LABEL, StatusBars, cliMeta } from "./nodes";
import type { AgentStatus } from "./types";

/** A live terminal popped out of the bottom drawer onto the canvas —
 * a real card: movable, resizable, collapsible, closable (Deska window). */
export const TermNode = memo(function TermNode({ id, selected }: NodeProps) {
  const n = useBoard((s) => s.termNodes[s.activeBoard]?.[id]);
  const agentId = id.slice(5); // term-<agentId>
  const agent = useBoard((s) => s.agents[agentId]);
  const actions = useContext(PanelActionsCtx);
  if (!n) return null;
  const status = (agent?.status === "exited" ? "done" : agent?.status ?? "idle") as AgentStatus;
  const cli = (agent?.command ?? "bash").split(/\s+/)[0].toLowerCase();
  const meta = cliMeta(cli);
  const statusColor = STATUS_COLOR[status];
  return (
    <div
      className="glass"
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
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <NodeResizer
        isVisible={selected}
        minWidth={320}
        minHeight={120}
        onResizeEnd={(_, p) =>
          useBoard.getState().resizeTermNode(id, Math.round(p.width), Math.round(p.height))
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
        onDoubleClick={() => useBoard.getState().collapseTermNode(id)}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            borderRadius: 5,
            border: "1px solid rgba(120,150,190,0.45)",
            color: "#7cb9ff",
            fontSize: 10,
            flex: "none",
          }}
        >
          ›_
        </span>
        <span style={{ fontSize: 11, fontWeight: 650, color: "var(--cv-ink)", whiteSpace: "nowrap" }}>
          {agent?.name ?? "terminal"}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            fontWeight: 600,
            color: statusColor,
            whiteSpace: "nowrap",
          }}
        >
          <StatusBars color={statusColor} />
          {STATUS_LABEL[status]}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10.5,
            fontWeight: 600,
            color: "var(--cv-ink-dim)",
            whiteSpace: "nowrap",
          }}
        >
          <CliMark cli={cli} color={meta.color} size={11} />
          {meta.label}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="nodrag"
          title={n.collapsed ? "Expand" : "Collapse"}
          onClick={() => useBoard.getState().collapseTermNode(id)}
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
          title="Put back — card closes, terminal returns to the drawer"
          onClick={() => {
            useBoard.getState().closeTermNode(id);
            actions?.openTerm?.({ id: agentId, name: agent?.name ?? "terminal" });
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
          <TermHost agentId={agentId} />
        </div>
      )}
    </div>
  );
});
