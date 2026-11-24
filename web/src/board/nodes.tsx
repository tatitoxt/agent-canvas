import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { useMemo, useState } from "react";
import { CliMark } from "../components/CliMark";
import { useBoard } from "../store/board";
import { screenLines } from "./ptyScreen";
import type {
  AgentNodeData,
  AgentStatus,
  OrchestratorNodeData,
  WorkspaceNodeData,
  WebNodeData,
} from "./types";

export const STATUS_COLOR: Record<AgentStatus, string> = {
  working: "var(--cv-working)",
  waiting: "var(--cv-waiting)",
  blocked: "var(--cv-blocked)",
  done: "var(--cv-done)",
  idle: "var(--cv-idle)",
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: "running",
  waiting: "waiting",
  blocked: "blocked",
  done: "done",
  idle: "idle",
};

/** Official CLI identities — each keeps its brand accent (muted, never
 * neon) the way Deska colors a terminal's title and logo: Claude's clay,
 * OpenAI's green, Google's blue, Cursor's violet. */
const CLI_META: Record<string, { mark: string; label: string; color: string }> = {
  "claude-code": { mark: "◆", label: "Claude Code", color: "#ee7d53" },
  claude: { mark: "◆", label: "Claude Code", color: "#ee7d53" },
  codex: { mark: "◈", label: "Codex", color: "#35d68f" },
  "gemini-cli": { mark: "✦", label: "Gemini CLI", color: "#4f9bf0" },
  gemini: { mark: "✦", label: "Gemini CLI", color: "#4f9bf0" },
  aider: { mark: "▣", label: "Aider", color: "#d4a072" },
  cursor: { mark: "◐", label: "Cursor", color: "#a78bfa" },
  "cursor-agent": { mark: "◐", label: "Cursor", color: "#a78bfa" },
  opencode: { mark: "❖", label: "OpenCode", color: "#b794f4" },
  amp: { mark: "▲", label: "Amp", color: "#ff8c5a" },
  droid: { mark: "⬡", label: "Droid", color: "#9ccc65" },
  goose: { mark: "◈", label: "Goose", color: "#4f9bf0" },
  kilocode: { mark: "◈", label: "Kilocode", color: "#60a5fa" },
  qwen: { mark: "✧", label: "Qwen Code", color: "#a855f7" },
  hermes: { mark: "◧", label: "Hermes", color: "#f0b429" },
  kimi: { mark: "◻", label: "Kimi Code", color: "#38bdf8" },
  vibe: { mark: "▦", label: "Mistral Vibe", color: "#ff7a1a" },
  pi: { mark: "▶", label: "Pi", color: "#fbbf24" },
  antigravity: { mark: "▲", label: "Antigravity", color: "#ff7043" },
  bash: { mark: "›_", label: "Terminal", color: "#9aa0a6" },
  live: { mark: "›_", label: "Terminal", color: "#9aa0a6" },
};

const PERMISSION_LABEL: Record<string, string> = {
  supervised: "supervised",
  auto_accept: "auto-accept",
  auto: "auto",
  full: "full access",
};

export function cliMeta(cli: string) {
  return CLI_META[cli.toLowerCase()] ?? { mark: "▢", label: cli, color: "#9a968e" };
}

const ANSI_RE = /\u001b\[[0-9;?><=!$]*[a-zA-Z@]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[()][0-9A-B]|\u001b[=>#]?[0-9]*.?/g;
const decoder = new TextDecoder();

const MODEL_RE =
  /(opus[\s\d.]*|sonnet[\s\d.]*|haiku[\s\d.]*|gpt-[\w.-]+|gemini-[\w.-]+|o\d[a-z0-9.-]*|kimi-[\w.-]+|qwen[\w.-]*|deepseek[\w.-]*|minimax[\w.-]*|mistral[\w.-]*|codex[\w.-]*mini[\w.-]*)/i;

function MiniTerm({ agentId }: { agentId: string }) {
  const buf = useBoard((s) => s.ptyBuffers[agentId]);
  const lines = useMemo(() => {
    // Real screen model — cursor addressing and TUI repaints resolve to the
    // screen the CLI actually shows (banner, boxes, status bar, input line).
    return screenLines(agentId, buf).slice(-14);
  }, [agentId, buf]);
  if (lines.length === 0) return null;
  return (
    <div
      className="nodrag"
      style={{
        marginTop: 10,
        padding: "9px 11px",
        borderRadius: 8,
        background: "rgba(0,0,0,0.34)",
        border: "1px solid var(--cv-glass-edge)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 10,
        lineHeight: 1.55,
        color: "rgba(244,242,238,0.85)",
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
            whiteSpace: "nowrap",
            opacity: 0.55 + (0.45 * (i + 1)) / lines.length,
          }}
        >
          {l.map((sp, j) => (
            <span key={j} style={{ color: sp.color, fontWeight: sp.bold ? 600 : undefined }}>
              {sp.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Deska's signal bars — three rising bars in the status color, shown in
 * front of "Cursor running". A real glyph, not a colored square. */
export function StatusBars({ color }: { color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 2, height: 10 }}>
      {[4, 7, 10].map((h) => (
        <span key={h} style={{ width: 2.5, height: h, borderRadius: 1, background: color }} />
      ))}
    </span>
  );
}

export function AgentNode({ data, selected }: NodeProps<Node<AgentNodeData>>) {
  const meta = cliMeta(data.cli);
  const [collapsed, setCollapsed] = useState(false);
  const statusColor = STATUS_COLOR[data.status];
  // Outline = the state color (waiting/running/idle/error) — Deska's
  // hairline for quiet states, full vivid ring + halo when it needs you.
  const attention = data.delegating || data.status === "waiting" || data.status === "blocked";
  const border = attention || selected
    ? `1.5px solid ${statusColor}`
    : `1.5px solid color-mix(in srgb, ${statusColor} 50%, transparent)`;
  const glow = attention || selected
    ? `0 0 22px color-mix(in srgb, ${statusColor} 30%, transparent), 0 12px 32px rgba(0,0,0,0.35)`
    : undefined;
  // The comet ring walks the border in the state color — working green,
  // waiting amber, blocked red (idle/done keep a quiet hairline).
  const ring = attention || selected || data.status === "working";
  if (collapsed) {
    // Deska's collapsed terminal — glyph tile + number in a small pill.
    return (
      <div
        className="glass"
        onClick={() => setCollapsed(false)}
        title={`${data.name} — click to expand`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 14px 7px 9px",
          background: "color-mix(in srgb, var(--cv-base) 68%, transparent)",
          border,
          cursor: "pointer",
          fontSize: 12.5,
          fontWeight: 650,
        }}
      >
        <Handle type="target" position={Position.Left} />
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 5,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--cv-glass-hi)",
            border: "1px solid var(--cv-glass-edge)",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontWeight: 700,
            fontSize: 10.5,
            color: "#5aa2f7",
            lineHeight: 1,
          }}
        >
          ›_
        </span>
        {data.termNo ? `Terminal ${data.termNo}` : data.name}
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }
  return (
    <div
      className={`glass ${ring ? "card-ring" : ""} ${data.status === "waiting" ? "node-waiting" : ""}`}
      style={{
        ["--cv-ring" as string]: statusColor,
        position: "relative",
        width: 460,
        padding: 0,
        overflow: "hidden",
        // Deska's card is near-opaque glass — the dot canvas barely bleeds.
        background: "color-mix(in srgb, var(--cv-base) 70%, transparent)",
        border,
        boxShadow: glow,
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Left} />
      {/* Deska header: [›_] Terminal N   ▮▮▮ running   [logo] Cli   (— × only when selected) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          minWidth: 0,
          padding: "10px 12px",
        }}
      >
        <span
          title={meta.label}
          style={{
            flex: "none",
            width: 24,
            height: 24,
            borderRadius: 6,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--cv-glass-hi)",
            border: "1px solid var(--cv-glass-edge)",
            fontSize: 11.5,
            fontWeight: 700,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            color: "#5aa2f7",
            textShadow: "0 0 10px rgba(90,162,247,0.5)",
            lineHeight: 1,
          }}
        >
          ›_
        </span>
        <div
          style={{
            fontSize: 13,
            fontWeight: 650,
            letterSpacing: -0.1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
          title={data.name}
        >
          {data.termNo ? `Terminal ${data.termNo}` : data.name}
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            fontWeight: 600,
            color: statusColor,
            flex: "none",
            whiteSpace: "nowrap",
          }}
        >
          <StatusBars color={statusColor} />
          {STATUS_LABEL[data.status]}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5.5,
            marginLeft: "auto",
            fontSize: 11.5,
            fontWeight: 600,
            flex: "none",
            whiteSpace: "nowrap",
          }}
        >
          <CliMark cli={data.cli} color={meta.color} size={13} />
          <span style={{ color: "var(--cv-ink-dim)" }}>{meta.label}</span>
        </span>
        {selected && (
          <span className="nodrag" style={{ display: "inline-flex", alignItems: "center", gap: 7, flex: "none", color: "var(--cv-ink-faint)", fontSize: 12 }}>
            <span
              role="button"
              title="collapse"
              style={{ cursor: "pointer", lineHeight: 1 }}
              onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
            >
              —
            </span>
            <span
              role="button"
              title="kill"
              style={{ cursor: "pointer", lineHeight: 1, fontSize: 13 }}
              onClick={(e) => { e.stopPropagation(); if (data.id) useBoard.getState().kill(data.id); }}
            >
              ×
            </span>
          </span>
        )}
      </div>
      {/* Full-width section separator — Deska splits header from body
          edge to edge, not inside the padding. */}
      <div style={{ height: 1, background: "var(--cv-glass-edge)" }} />
      {data.status === "working" && (
        <div className="card-scanline" style={{ ["--cv-ring" as string]: statusColor }} />
      )}
      {!collapsed && (
      <div style={{ padding: "9px 12px 10px" }}>
      {/* Meta row — files / account / permission. */}
      {(data.files || data.accountLabel || (data.permission && data.permission !== "supervised")) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 6,
            fontSize: 9.5,
            color: "var(--cv-ink-faint)",
          }}
        >
          {data.files != null && data.files > 0 && (
            <span title={data.paths?.length ? data.paths.join("\n") : "uncommitted changes in worktree"}>
              {data.files} file{data.files === 1 ? "" : "s"}
            </span>
          )}
          {data.accountLabel && (
            <span style={{ color: "var(--cv-accent)" }} title="account">
              @{data.accountLabel}
            </span>
          )}
          {data.permission && data.permission !== "supervised" && (
            <span
              className="glass-pill"
              style={{ fontSize: 9, padding: "1px 6px", color: "var(--cv-accent)", marginLeft: "auto" }}
              title="permission level"
            >
              {PERMISSION_LABEL[data.permission] ?? data.permission}
            </span>
          )}
        </div>
      )}
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
      {/* Deska footer: branch + accept-edits on the left, model on the right. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginTop: 9,
          paddingTop: 8,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: 9.5,
          color: "var(--cv-ink-faint)",
        }}
      >
        {data.permission === "auto_accept" && (
          <span style={{ color: "#9a7fd4", fontWeight: 600 }}>▸ accept edits on</span>
        )}
        {data.branch && (
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              marginLeft: data.permission === "auto_accept" ? 8 : 0,
            }}
            title="worktree branch"
          >
            {data.branch.replace(/^canvas\//, "")}
          </span>
        )}
        <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
          <FooterModel agentId={data.id} />
        </span>
      </div>
      </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

/** Reads the same pty buffer as MiniTerm and reports the model the CLI
 * announced, for the Deska-style footer (bottom-right). */
function FooterModel({ agentId }: { agentId?: string }) {
  const buf = useBoard((s) => (agentId ? s.ptyBuffers[agentId] : undefined));
  const model = useMemo(() => {
    if (!buf || buf.length === 0) return undefined as string | undefined;
    const tail = decoder.decode(buf.slice(Math.max(0, buf.length - 4000)));
    const parsed = tail.replace(/\r/g, "").split("\n").map((l) => l.replace(ANSI_RE, ""));
    for (let i = parsed.length - 1; i >= 0; i--) {
      const m = parsed[i].match(MODEL_RE);
      if (m) return m[0];
    }
    return undefined;
  }, [buf, agentId]);
  return <>{model}</>;
}

/**
 * The orchestrator card (Symvibe's "Dex"): wire consoles to it with
 * Connect — each pick draws an orange cable — then the composer sends one
 * command into every wired PTY at once.
 */
const EMPTY_WIRED: string[] = [];

export function OrchestratorNode({
  data,
  id,
}: NodeProps<Node<OrchestratorNodeData>>) {
  const orchId = data.id ?? id;
  const agents = useBoard((s) => s.agents);
  const edges = useBoard((s) => s.edges);
  const wired = useBoard((s) => s.orchestrators[orchId]?.wired ?? EMPTY_WIRED);
  const wiring = useBoard((s) => s.wiringFrom === orchId);
  const setWiring = useBoard((s) => s.setWiring);
  const commandAgents = useBoard((s) => s.commandAgents);
  const [cmd, setCmd] = useState("");

  // Roster = hand-wired consoles ∪ agents this orchestrator spawned by
  // delegation — the cable to a spawned child is its delegation edge.
  const delegated = useMemo(
    () => Object.values(edges).filter((e) => e.from === orchId).map((e) => e.to),
    [edges, orchId],
  );
  const roster = useMemo(
    () => [...new Set([...wired, ...delegated])],
    [wired, delegated],
  );

  const send = () => {
    if (!cmd.trim()) return;
    commandAgents(orchId, cmd);
    setCmd("");
  };

  return (
    <div
      className="glass"
      style={{
        width: 268,
        padding: "14px 16px",
        borderColor: wiring ? "var(--cv-accent)" : "var(--cv-accent-dim)",
        boxShadow: wiring
          ? "0 0 0 1px var(--cv-accent), 0 0 18px rgba(201,162,107,0.18)"
          : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
        <button
          className="nodrag"
          onClick={() => setWiring(wiring ? null : orchId)}
          title="Pick agent consoles on the canvas to wire them here"
          style={{
            background: wiring ? "rgba(201,162,107,0.16)" : "none",
            border: "1px solid var(--cv-accent-dim)",
            borderRadius: 11,
            color: wiring ? "var(--cv-accent)" : "var(--cv-ink-dim)",
            fontSize: 10,
            padding: "2px 9px",
            cursor: "pointer",
          }}
        >
          {wiring ? "done" : "⚡ connect"}
        </button>
      </div>
      <div style={{ fontSize: 16, fontWeight: 650, marginTop: 4 }}>
        {data.name}
      </div>
      <div style={{ fontSize: 11, color: "var(--cv-ink-dim)", marginTop: 5 }}>
        {wiring
          ? "click agent cards to wire them — click Connect when done"
          : roster.length
            ? `${roster.length} agents · General`
            : "No agents wired — Connect and pick consoles"}
      </div>
      {roster.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {roster.map((aid) => {
            const a = agents[aid];
            if (!a) return null;
            const cli = (a.command ?? "bash").split(/\s+/)[0].toLowerCase();
            const meta = CLI_META[cli];
            return (
              <div key={aid} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10.5 }}>
                <CliMark cli={cli} color={meta?.color ?? "#9a968e"} size={11} />
                <span style={{ color: "var(--cv-ink)", fontWeight: 600 }}>{a.name}</span>
                <span style={{ color: "var(--cv-ink-dim)" }}>· {meta?.label ?? cli}</span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 9.5,
                    color: a.status === "exited" ? "var(--cv-idle)" : "var(--cv-working)",
                  }}
                >
                  {a.status === "exited" ? "done" : "running"}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="nodrag" style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={
            roster.length
              ? `Command ${roster.length} agent${roster.length === 1 ? "" : "s"} · @ to direct…`
              : "Try 'spawn two reviewers'…"
          }
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 7,
            color: "var(--cv-ink)",
            fontSize: 11,
            padding: "5px 8px",
            outline: "none",
          }}
        />
        <button
          onClick={send}
          disabled={!cmd.trim()}
          title="Send the command to every wired console — 'spawn two codex' also works"
          style={{
            background: "rgba(201,162,107,0.14)",
            border: "1px solid var(--cv-accent-dim)",
            borderRadius: 7,
            color: "var(--cv-accent)",
            fontSize: 11,
            padding: "5px 10px",
            cursor: "pointer",
            opacity: cmd.trim() ? 1 : 0.45,
          }}
        >
          ▸
        </button>
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

/** A live web page embedded in the canvas — e.g. a localhost dev server
 * preview that sits next to the agent building it. */
export function WebNode({
  id,
  data,
  selected,
}: NodeProps<Node<WebNodeData>>) {
  const webNodeRemove = useBoard((s) => s.webNodeRemove);
  return (
    <div
      className="glass"
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 14,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        outline: selected ? "1.5px solid var(--cv-glass-shine)" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          fontSize: 10.5,
          color: "var(--cv-ink-dim)",
          borderBottom: "1px solid var(--cv-glass-edge)",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "#7ba3cf" }}>◍</span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {data.url}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); window.open(data.url, "_blank"); }}
          style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 11 }}
          title="open in browser"
        >
          ↗
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); webNodeRemove(id); }}
          style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 12 }}
        >
          ×
        </button>
      </div>
      <iframe
        src={data.url}
        title={data.url}
        className="nodrag"
        style={{ flex: 1, border: "none", background: "#fff" }}
      />
    </div>
  );
}
