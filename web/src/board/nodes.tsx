import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { useMemo } from "react";
import { useBoard } from "../store/board";
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

/** Official CLI identities — each keeps its brand accent (muted, never
 * neon) the way Deska colors a terminal's title and logo: Claude's clay,
 * OpenAI's green, Google's blue, Cursor's violet. */
const CLI_META: Record<string, { mark: string; label: string; color: string }> = {
  "claude-code": { mark: "◆", label: "Claude Code", color: "#cf7f5a" },
  claude: { mark: "◆", label: "Claude Code", color: "#cf7f5a" },
  codex: { mark: "◈", label: "Codex", color: "#5da381" },
  "gemini-cli": { mark: "✦", label: "Gemini CLI", color: "#6b93cf" },
  gemini: { mark: "✦", label: "Gemini CLI", color: "#6b93cf" },
  aider: { mark: "▣", label: "Aider", color: "#b08d68" },
  cursor: { mark: "◐", label: "Cursor", color: "#8f7fd4" },
  "cursor-agent": { mark: "◐", label: "Cursor", color: "#8f7fd4" },
  opencode: { mark: "❖", label: "OpenCode", color: "#9a7fd4" },
  bash: { mark: "›_", label: "Terminal", color: "#86817a" },
  live: { mark: "›_", label: "Terminal", color: "#86817a" },
};

const PERMISSION_LABEL: Record<string, string> = {
  supervised: "supervised",
  auto_accept: "auto-accept",
  auto: "auto",
  full: "full access",
};

function cliMeta(cli: string) {
  return CLI_META[cli.toLowerCase()] ?? { mark: "▢", label: cli, color: "#9a968e" };
}

const ANSI_RE = /\u001b\[[0-9;?><=!$]*[a-zA-Z@]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[()][0-9A-B]|\u001b[=>#]?[0-9]*.?/g;
const decoder = new TextDecoder();

/** Live tail of the agent's real PTY rendered inside the node — the
 * actual Claude Code / Codex / Gemini interface, like Deska's panels. */
function MiniTerm({ agentId }: { agentId: string }) {
  const buf = useBoard((s) => s.ptyBuffers[agentId]);
  const lines = useMemo(() => {
    if (!buf || buf.length === 0) return [];
    const tail = buf.slice(Math.max(0, buf.length - 4000));
    const text = decoder.decode(tail).replace(ANSI_RE, "").replace(/\r/g, "");
    return text.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0).slice(-5);
  }, [buf]);
  if (lines.length === 0) return null;
  return (
    <div
      className="nodrag"
      style={{
        marginTop: 10,
        padding: "7px 9px",
        borderRadius: 8,
        background: "rgba(0,0,0,0.35)",
        border: "1px solid var(--cv-glass-edge)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 9,
        lineHeight: 1.5,
        color: "rgba(236,234,230,0.72)",
        overflow: "hidden",
        whiteSpace: "pre",
        textOverflow: "clip",
        cursor: "default",
      }}
    >
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            opacity: 0.45 + (0.55 * (i + 1)) / lines.length,
          }}
        >
          {l.length > 46 ? l.slice(0, 46) : l}
        </div>
      ))}
    </div>
  );
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
            color: meta.color,
            background: `color-mix(in srgb, ${meta.color} 12%, var(--cv-glass-hi))`,
            border: `1px solid color-mix(in srgb, ${meta.color} 30%, var(--cv-glass-edge))`,
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
          <div style={{ fontSize: 11, color: meta.color, marginTop: 1, opacity: 0.9 }}>
            {meta.label}
            {data.accountLabel && (
              <span style={{ color: "var(--cv-accent)" }}> · @{data.accountLabel}</span>
            )}
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
          {data.branch && (
            <span
              style={{
                fontSize: 9.5,
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                color: "var(--cv-ink-faint)",
                fontWeight: 500,
              }}
              title="worktree branch"
            >
              ⎇ {data.branch}
            </span>
          )}
          {data.files != null && data.files > 0 && (
            <span
              style={{ fontSize: 10, color: "var(--cv-ink-faint)", fontWeight: 500 }}
              title={data.paths?.length ? data.paths.join("\n") : "uncommitted changes in worktree"}
            >
              {data.files} file{data.files === 1 ? "" : "s"}
            </span>
          )}
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
      {data.id && <MiniTerm agentId={data.id} />}
      {data.pendingApproval && (
        <div
          className="nodrag"
          onClick={(e) => e.stopPropagation()}
          style={{
            marginTop: 10,
            paddingTop: 9,
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              color: "var(--cv-waiting)",
              fontWeight: 600,
              marginBottom: 5,
            }}
          >
            approve command?
          </div>
          <div
            style={{
              fontSize: 11,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              color: "var(--cv-ink-dim)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              marginBottom: 7,
            }}
            title={data.pendingApproval}
          >
            {data.pendingApproval}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="glass-pill"
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                padding: "3px 12px",
                color: "var(--cv-done)",
                cursor: "pointer",
              }}
              onClick={() => data.id && useBoard.getState().approveInput(data.id)}
            >
              allow
            </button>
            <button
              className="glass-pill"
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                padding: "3px 12px",
                color: "var(--cv-blocked)",
                cursor: "pointer",
              }}
              onClick={() => data.id && useBoard.getState().denyInput(data.id)}
            >
              deny
            </button>
          </div>
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
