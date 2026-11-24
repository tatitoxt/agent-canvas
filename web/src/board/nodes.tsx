import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { useMemo, useState } from "react";
import { useBoard } from "../store/board";
import type {
  AgentNodeData,
  AgentStatus,
  OrchestratorNodeData,
  WorkspaceNodeData,
  WebNodeData,
} from "./types";

const STATUS_COLOR: Record<AgentStatus, string> = {
  working: "var(--cv-working)",
  waiting: "var(--cv-waiting)",
  blocked: "var(--cv-blocked)",
  done: "var(--cv-done)",
  idle: "var(--cv-idle)",
};

const STATUS_LABEL: Record<AgentStatus, string> = {
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
  "claude-code": { mark: "◆", label: "Claude Code", color: "#cf7f5a" },
  claude: { mark: "◆", label: "Claude Code", color: "#cf7f5a" },
  codex: { mark: "◈", label: "Codex", color: "#5da381" },
  "gemini-cli": { mark: "✦", label: "Gemini CLI", color: "#6b93cf" },
  gemini: { mark: "✦", label: "Gemini CLI", color: "#6b93cf" },
  aider: { mark: "▣", label: "Aider", color: "#b08d68" },
  cursor: { mark: "◐", label: "Cursor", color: "#8f7fd4" },
  "cursor-agent": { mark: "◐", label: "Cursor", color: "#8f7fd4" },
  opencode: { mark: "❖", label: "OpenCode", color: "#9a7fd4" },
  amp: { mark: "▲", label: "Amp", color: "#cf7d5a" },
  droid: { mark: "⬡", label: "Droid", color: "#7d9a6b" },
  goose: { mark: "◈", label: "Goose", color: "#6b93cf" },
  kilocode: { mark: "◈", label: "Kilocode", color: "#5b8dd6" },
  qwen: { mark: "✧", label: "Qwen Code", color: "#8f7fd4" },
  hermes: { mark: "◧", label: "Hermes", color: "#c9a24a" },
  kimi: { mark: "◻", label: "Kimi Code", color: "#4a8ec2" },
  vibe: { mark: "▦", label: "Mistral Vibe", color: "#cf5a3a" },
  pi: { mark: "▶", label: "Pi", color: "#7ba3cf" },
  antigravity: { mark: "▲", label: "Antigravity", color: "#b8573e" },
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

/** ANSI SGR → colored spans: keeps each CLI's real colors (Claude coral,
 * Codex green, OpenCode violet) inside the node preview. */
type AnsiSpan = { text: string; color?: string; bold?: boolean };
const BASIC = [
  "#8a817a", "#c07a6a", "#7ba389", "#c2a15e",
  "#7ba3cf", "#9a7fd4", "#6ba3a8", "#eceae6",
];
const BRIGHT = BASIC.map((c) => c);
const SGR_RE = /\u001b\[([0-9;]*)m/g;
const PALETTE_256: string[] = (() => {
  const base = ["#4a4640","#c07a6a","#7ba389","#c2a15e","#7ba3cf","#9a7fd4","#6ba3a8","#eceae6",
                "#86817a","#d68a7a","#8bb39b","#d2b16e","#8bb3df","#aa8fe4","#7bb3b8","#fffdfa"];
  const cube: string[] = [];
  const lv = [0, 95, 135, 175, 215, 255];
  for (const r of lv) for (const g of lv) for (const b of lv) cube.push(`rgb(${r},${g},${b})`);
  const grays: string[] = [];
  for (let i = 0; i < 24; i++) { const v = 8 + i * 10; grays.push(`rgb(${v},${v},${v})`); }
  return [...base, ...cube, ...grays];
})();

function parseAnsiLine(raw: string): AnsiSpan[] {
  const clean = raw.replace(ANSI_RE, "");
  const spans: AnsiSpan[] = [];
  let color: string | undefined;
  let bold = false;
  let last = 0;
  const push = (end: number) => {
    const t = clean.slice(last, end).replace(/[^\x20-\x7e\u00a0-\uffff\u{1f300}-\u{1faff}]/gu, "");
    if (t) spans.push({ text: t, color, bold });
  };
  for (const m of clean.matchAll(SGR_RE)) {
    push(m.index!);
    last = m.index! + m[0].length;
    const codes = m[1].split(";");
    for (let i = 0; i < codes.length; i++) {
      const n = parseInt(codes[i] || "0", 10);
      if (n === 0) { color = undefined; bold = false; }
      else if (n === 1) bold = true;
      else if (n === 22) bold = false;
      else if (n === 39) color = undefined;
      else if (n >= 30 && n <= 37) color = BASIC[n - 30];
      else if (n >= 90 && n <= 97) color = BRIGHT[n - 90];
      else if (n === 38) {
        // 38;5;idx (256-color) or 38;2;r;g;b (truecolor) — consume params.
        const mode = parseInt(codes[i + 1] || "0", 10);
        if (mode === 5) {
          const idx = parseInt(codes[i + 2] || "0", 10);
          color = PALETTE_256[idx] ?? color;
          i += 2;
        } else if (mode === 2) {
          const r = codes[i + 2], g = codes[i + 3], b = codes[i + 4];
          color = `rgb(${r},${g},${b})`;
          i += 4;
        }
      }
    }
  }
  push(clean.length);
  return spans;
}


/** Live tail of the agent's real PTY rendered inside the node — the
 * actual Claude Code / Codex / Gemini interface, like Deska's panels. */
const MODEL_RE =
  /(opus[\s\d.]*|sonnet[\s\d.]*|haiku[\s\d.]*|gpt-[\w.-]+|gemini-[\w.-]+|o\d[a-z0-9.-]*|kimi-[\w.-]+|qwen[\w.-]*|deepseek[\w.-]*|minimax[\w.-]*|mistral[\w.-]*|codex[\w.-]*mini[\w.-]*)/i;

function MiniTerm({ agentId }: { agentId: string }) {
  const buf = useBoard((s) => s.ptyBuffers[agentId]);
  const { lines, model } = useMemo(() => {
    if (!buf || buf.length === 0) return { lines: [] as { spans: AnsiSpan[]; text: string }[], model: undefined as string | undefined };
    const tail = buf.slice(Math.max(0, buf.length - 4000));
    const text = decoder.decode(tail).replace(/\r/g, "");
    const parsed = text
      .split("\n")
      .map(parseAnsiLine)
      .map((spans) => ({ spans, text: spans.map((p) => p.text).join("") }))
      .filter((l) => l.text.trim().length > 0)
      .slice(-5);
    // Last model mention in the tail — the real model the CLI announced.
    let model: string | undefined;
    for (let i = parsed.length - 1; i >= 0; i--) {
      const m = parsed[i].text.match(MODEL_RE);
      if (m) { model = m[0]; break; }
    }
    return { lines: parsed, model };
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
            whiteSpace: "nowrap",
            opacity: 0.45 + (0.55 * (i + 1)) / lines.length,
          }}
        >
          {l.spans.map((sp, j) => (
            <span key={j} style={{ color: sp.color, fontWeight: sp.bold ? 600 : undefined }}>
              {sp.text}
            </span>
          ))}
        </div>
      ))}
      {model && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: 3,
            fontSize: 8.5,
            color: "var(--cv-ink-faint)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {model}
        </div>
      )}
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
        outline: selected
          ? "1px solid var(--cv-glass-shine)"
          : data.delegating
            ? "1.5px solid var(--cv-waiting)"
            : "none",
        boxShadow: data.delegating
          ? "0 0 18px color-mix(in srgb, var(--cv-waiting) 24%, transparent)"
          : "none",
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Left} />
      {/* Deska-style header: [tile] name · <cli> <status> · [logo] <cli> */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 20,
            height: 20,
            flex: "none",
            display: "grid",
            placeItems: "center",
            borderRadius: 5,
            fontSize: 10.5,
            color: meta.color,
            background: `color-mix(in srgb, ${meta.color} 14%, var(--cv-glass-hi))`,
            border: `1px solid color-mix(in srgb, ${meta.color} 30%, var(--cv-glass-edge))`,
          }}
          title={meta.label}
        >
          {meta.mark}
        </div>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            letterSpacing: -0.1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
            flex: "1 1 auto",
          }}
        >
          {data.name}
        </div>
        <span
          style={{
            fontSize: 11,
            color: STATUS_COLOR[data.status],
            fontWeight: 500,
            flex: "none",
            whiteSpace: "nowrap",
          }}
        >
          ≋ {meta.label} {STATUS_LABEL[data.status]}
        </span>
        <span
          style={{
            fontSize: 11,
            color: meta.color,
            fontWeight: 600,
            flex: "none",
            whiteSpace: "nowrap",
            marginLeft: "auto",
          }}
        >
          {meta.mark} {meta.label}
        </span>
      </div>
      {/* Meta row — files / branch / account / permission (Deska keeps the
          header clean and pushes these under it). */}
      {(data.files || data.branch || data.accountLabel || (data.permission && data.permission !== "supervised")) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 7,
            fontSize: 9.5,
            color: "var(--cv-ink-faint)",
          }}
        >
          {data.files != null && data.files > 0 && (
            <span title={data.paths?.length ? data.paths.join("\n") : "uncommitted changes in worktree"}>
              {data.files} file{data.files === 1 ? "" : "s"}
            </span>
          )}
          {data.branch && (
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }} title="worktree branch">
              ⎇ {data.branch}
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
      <Handle type="source" position={Position.Right} />
    </div>
  );
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
                <span style={{ color: meta?.color ?? "var(--cv-ink-dim)", width: 12, textAlign: "center" }}>
                  {meta?.mark ?? "›_"}
                </span>
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
