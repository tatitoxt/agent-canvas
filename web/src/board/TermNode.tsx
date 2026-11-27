import { memo, useContext } from "react";
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { useBoard } from "../store/board";
import { LazyTermHost as TermHost } from "../components/LazyTermHost";
import { PanelActionsCtx } from "../components/panelCtx";
import { CliMark } from "../components/CliMark";
import { CardChrome, CardChromeButton } from "../components/CardChrome";
import { STATUS_COLOR, STATUS_LABEL, StatusBars, cliMeta } from "./nodes";
import { countRender } from "../lib/renderProbe";
import type { AgentStatus } from "./types";

// CSI + OSC escape sequences — good enough to copy a readable transcript.
const ANSI = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[\[\]()#;?]*[0-9;]*[ -\/]*[@-~]/g;

/** A live terminal popped out of the bottom drawer onto the canvas —
 * a real card: movable, resizable, collapsible, closable (Deska window). */
export const TermNode = memo(function TermNode({ id, selected, width }: NodeProps) {
  countRender("TermNode", id);
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
  const cardWidth = typeof width === "number" && width >= 300 ? width : 560;
  const tightHeader = cardWidth < 350;
  return (
    <div
      className="glass-panel"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--cv-panel-bg)",
        border: "1px solid var(--cv-glass-edge)",
        boxShadow: "var(--cv-card-shadow)",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <NodeResizer
        isVisible={selected}
        minWidth={320}
        minHeight={120}
        handleClassName="cv-node-resize-handle"
        lineClassName="cv-node-resize-line"
        onResizeEnd={(_, p) =>
          useBoard.getState().resizeTermNode(id, Math.round(p.width), Math.round(p.height), { x: p.x, y: p.y })
        }
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: tightHeader ? 5 : 7,
          padding: tightHeader ? "6px 7px 6px 9px" : "6px 8px 6px 11px",
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
            border: "1px solid color-mix(in srgb, #5b9dff 25%, transparent)",
            background: "color-mix(in srgb, #5b9dff 12%, transparent)",
            color: "#5b9dff",
            fontSize: "var(--cv-text-xxs)",
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
            fontSize: "var(--cv-text-sm)",
            fontWeight: 600,
            color: "var(--cv-text-main)",
            whiteSpace: "nowrap",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
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
            fontSize: "var(--cv-text-sm)",
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
            fontSize: "var(--cv-text-xs)",
            fontWeight: 600,
            lineHeight: 1,
            color: meta.color,
            whiteSpace: "nowrap",
            padding: tightHeader ? "2.5px 4px" : "2.5px 7px 2.5px 5px",
            borderRadius: 999,
            background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${meta.color} 25%, transparent)`,
          }}
        >
          <CliMark cli={cli} color={meta.color} size={11} />
          {!tightHeader && meta.label}
        </span>
        <span style={{ flex: 1 }} />
        <CardChrome>
          {!tightHeader && (
            <CardChromeButton
              icon="files"
              title="Files — open this agent's worktree in the repo explorer"
              onClick={() => {
                const st = useBoard.getState();
                const a = st.agents[agentId];
                const wsRepo = a?.workspace_id ? st.workspaces[a.workspace_id]?.repo : undefined;
                st.openExplorer(a?.worktree ?? wsRepo);
              }}
            />
          )}
          {!tightHeader && (
            <CardChromeButton
              icon="copy"
              title="Copy transcript to clipboard"
              onClick={() => {
                const buf = useBoard.getState().ptyBuffer(agentId);
                if (!buf) { useBoard.getState().notify("nothing to copy yet"); return; }
                const text = new TextDecoder().decode(buf).replace(ANSI, "");
                void navigator.clipboard?.writeText(text).catch(() => {});
                useBoard.getState().notify("transcript copied");
              }}
            />
          )}
          <CardChromeButton
            icon={n.collapsed ? "expand" : "collapse"}
            title={n.collapsed ? "Expand" : "Collapse"}
            ariaLabel={n.collapsed ? "Expand terminal card" : "Minimize terminal card"}
            onClick={() => useBoard.getState().collapseTermNode(id)}
          />
          <CardChromeButton
            icon={n.maximized ? "restore" : "maximize"}
            title={n.maximized ? "Restore terminal card size" : "Maximize terminal card"}
            ariaLabel={n.maximized ? "Restore terminal card size" : "Maximize terminal card"}
            onClick={() => {
              if (n.maximized) {
                useBoard.getState().maximizeTermNode(id);
              } else {
                const tl = rf.screenToFlowPosition({ x: 12, y: 64 });
                const br = rf.screenToFlowPosition({ x: window.innerWidth - 12, y: window.innerHeight - 12 });
                useBoard.getState().maximizeTermNode(id, { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y });
              }
            }}
          />
          <CardChromeButton
            icon="close"
            title="Put back — card closes, terminal returns to the drawer"
            ariaLabel="Put terminal back in drawer"
            onClick={() => {
              useBoard.getState().closeTermNode(id);
              actions?.openTerm?.({ id: agentId, name: agent?.name ?? "terminal" });
            }}
          />
        </CardChrome>
      </div>
      {!n.collapsed && (
        <div className="nodrag nowheel" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <TermHost agentId={agentId} />
        </div>
      )}
    </div>
  );
});
