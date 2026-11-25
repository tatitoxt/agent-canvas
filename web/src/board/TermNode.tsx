import { memo, useContext } from "react";
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { useBoard } from "../store/board";
import { TermHost } from "../components/TermHost";
import { PanelActionsCtx } from "../components/panelCtx";
import { CliMark } from "../components/CliMark";
import { Icon } from "../components/icons";
import { STATUS_COLOR, STATUS_LABEL, StatusBars, cliMeta } from "./nodes";
import type { AgentStatus } from "./types";

// CSI + OSC escape sequences — good enough to copy a readable transcript.
const ANSI = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[\[\]()#;?]*[0-9;]*[ -\/]*[@-~]/g;

/** A live terminal popped out of the bottom drawer onto the canvas —
 * a real card: movable, resizable, collapsible, closable (Deska window). */
export const TermNode = memo(function TermNode({ id, selected }: NodeProps) {
  const rf = useReactFlow();
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
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "color-mix(in srgb, var(--cv-base) 94%, #0d0e10)",
        border: "1px solid var(--cv-glass-edge)",
        boxShadow: selected
          ? "0 0 0 1.5px color-mix(in srgb, var(--cv-accent) 55%, transparent), var(--cv-shadow)"
          : "var(--cv-shadow)",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: meta.color, opacity: 0.85, pointerEvents: "none", zIndex: 1 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <NodeResizer
        isVisible={selected}
        minWidth={320}
        minHeight={120}
        handleClassName="cv-node-resize-handle"
        lineClassName="cv-node-resize-line"
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
        <button
          className="nodrag"
          title="Locate the agent card"
          onClick={() => useBoard.getState().requestFocus(agentId)}
          style={{
            fontSize: 11,
            fontWeight: 650,
            color: "var(--cv-ink)",
            whiteSpace: "nowrap",
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
          }}
        >
          {agent?.name ?? "terminal"}
        </button>
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
          title="Files — open this agent's worktree in the repo explorer"
          onClick={() => {
            const st = useBoard.getState();
            const a = st.agents[agentId];
            const wsRepo = a?.workspace_id ? st.workspaces[a.workspace_id]?.repo : undefined;
            st.openExplorer(a?.worktree ?? wsRepo);
          }}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--cv-ink-dim)",
            fontSize: 11,
            padding: "0 2px",
          }}
        >
          ⌸
        </button>
        <button
          className="nodrag"
          title="Copy transcript to clipboard"
          onClick={() => {
            const buf = useBoard.getState().ptyBuffer(agentId);
            if (!buf) { useBoard.getState().notify("nothing to copy yet"); return; }
            const text = new TextDecoder().decode(buf).replace(ANSI, "");
            void navigator.clipboard?.writeText(text).catch(() => {});
            useBoard.getState().notify("transcript copied");
          }}
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
          ⧉
        </button>
        <button
          className="nodrag"
          title={n.maximized ? "Restore terminal card size" : "Maximize terminal card"}
          aria-label={n.maximized ? "Restore terminal card size" : "Maximize terminal card"}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (n.maximized) {
              useBoard.getState().maximizeTermNode(id);
            } else {
              const tl = rf.screenToFlowPosition({ x: 12, y: 64 });
              const br = rf.screenToFlowPosition({ x: window.innerWidth - 12, y: window.innerHeight - 12 });
              useBoard.getState().maximizeTermNode(id, { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y });
            }
          }}
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "var(--cv-ink-faint)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon name={n.maximized ? "ph-restore" : "ph-max"} size={12} color="var(--cv-ink)" />
        </button>
        <button
          className="nodrag"
          title={n.collapsed ? "Expand" : "Collapse"}
          aria-label={n.collapsed ? "Expand terminal card" : "Minimize terminal card"}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); useBoard.getState().collapseTermNode(id); }}
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
          {n.collapsed ? "▸" : "−"}
        </button>
        <button
          className="nodrag"
          title="Put back — card closes, terminal returns to the drawer"
          aria-label="Put terminal back in drawer"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
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
