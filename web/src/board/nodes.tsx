import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type {
  AgentNodeData,
  AgentStatus,
  OrchestratorNodeData,
  WorkspaceNodeData,
} from "./types";

const STATUS_COLOR: Record<AgentStatus, string> = {
  working: "var(--cv-working)",
  waiting: "var(--cv-waiting)",
  blocked: "var(--cv-blocked)",
  done: "var(--cv-done)",
  idle: "var(--cv-idle)",
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  working: "working",
  waiting: "needs input",
  blocked: "blocked",
  done: "done",
  idle: "idle",
};

/** Official CLI identities — muted monochrome marks, real names. */
const CLI_META: Record<string, { mark: string; label: string }> = {
  "claude-code": { mark: "◆", label: "Claude Code" },
  claude: { mark: "◆", label: "Claude Code" },
  codex: { mark: "◈", label: "Codex" },
  "gemini-cli": { mark: "✦", label: "Gemini CLI" },
  gemini: { mark: "✦", label: "Gemini CLI" },
  aider: { mark: "▣", label: "Aider" },
  cursor: { mark: "◐", label: "Cursor" },
  bash: { mark: "›_", label: "Terminal" },
  live: { mark: "›_", label: "Terminal" },
};

const PERMISSION_LABEL: Record<string, string> = {
  supervised: "supervised",
  auto_accept: "auto-accept",
  auto: "auto",
  full: "full access",
};

function cliMeta(cli: string) {
  return CLI_META[cli.toLowerCase()] ?? { mark: "▢", label: cli };
}

export function AgentNode({ data, selected }: NodeProps<Node<AgentNodeData>>) {
  const meta = cliMeta(data.cli);
  return (
    <div
      className={`glass ${data.status === "waiting" ? "node-waiting" : ""}`}
      style={{
        width: 264,
        padding: "13px 15px 12px",
        outline: selected ? "1px solid var(--cv-glass-shine)" : "none",
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            flex: "none",
            display: "grid",
            placeItems: "center",
            borderRadius: 9,
            fontSize: 13,
            color: "var(--cv-ink)",
            background: "var(--cv-glass-hi)",
            border: "1px solid var(--cv-glass-edge)",
            boxShadow: "inset 0 1px 0 var(--cv-glass-shine)",
          }}
        >
          {meta.mark}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              letterSpacing: -0.1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {data.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--cv-ink-dim)", marginTop: 1 }}>
            {meta.label}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            className="status-dot"
            style={{ background: STATUS_COLOR[data.status] }}
          />
          <span
            style={{
              fontSize: 10.5,
              color: STATUS_COLOR[data.status],
              fontWeight: 500,
            }}
          >
            {STATUS_LABEL[data.status]}
          </span>
          {data.permission && data.permission !== "supervised" && (
            <span
              className="glass-pill"
              style={{ fontSize: 9.5, padding: "2px 7px", color: "var(--cv-accent)" }}
              title="permission level"
            >
              {PERMISSION_LABEL[data.permission] ?? data.permission}
            </span>
          )}
        </div>
      </div>
      {data.task && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 9,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            fontSize: 11.5,
            lineHeight: 1.45,
            color: "var(--cv-ink-dim)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {data.task}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function OrchestratorNode({
  data,
}: NodeProps<Node<OrchestratorNodeData>>) {
  return (
    <div
      className="glass"
      style={{
        width: 220,
        padding: "14px 16px",
        borderColor: "var(--cv-accent-dim)",
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div
        style={{
          fontSize: 9.5,
          letterSpacing: 1.6,
          textTransform: "uppercase",
          color: "var(--cv-accent)",
          fontWeight: 600,
        }}
      >
        orchestrator
      </div>
      <div style={{ fontSize: 16, fontWeight: 650, marginTop: 4 }}>
        {data.name}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--cv-ink-dim)",
          marginTop: 6,
        }}
      >
        {data.delegations} delegation{data.delegations === 1 ? "" : "s"} in
        flight
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

/**
 * A workspace: a container agents live inside. Several coexist on one
 * canvas — like Codex/Claude "projects", but spatial.
 */
export function WorkspaceNode({
  data,
  selected,
}: NodeProps<Node<WorkspaceNodeData>>) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 14,
        border: `1px solid ${selected ? "var(--cv-glass-shine)" : "rgba(255,255,255,0.07)"}`,
        background: "rgba(255,255,255,0.018)",
        position: "relative",
      }}
    >
      <div
        className="glass-pill"
        style={{
          position: "absolute",
          top: -14,
          left: 18,
          padding: "5px 14px",
          fontSize: 11.5,
          fontWeight: 600,
          letterSpacing: 0.2,
          display: "flex",
          alignItems: "center",
          gap: 8,
          zIndex: 10,
        }}
      >
        <span style={{ color: "var(--cv-ink-faint)", fontSize: 10 }}>◫</span>
        {data.name}
        <span style={{ color: "var(--cv-ink-faint)", fontWeight: 400 }}>
          {data.repo}
        </span>
      </div>
    </div>
  );
}
