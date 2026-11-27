import { memo, useEffect, useRef, useState } from "react";

import { LazyTermHost as TermHost } from "./LazyTermHost";
import { markPtyResizeIntent } from "./ptyResize";
import { useBoard } from "../store/board";
import { CliMark } from "./CliMark";
import { announcedModel, STATUS_COLOR, STATUS_LABEL, StatusBars, cliMeta } from "../board/nodes";
import type { AgentStatus } from "../board/types";

/** Where the floating terminal panel sits — default bottom-right (Deska-style
 * dock position) until the user pops it out by dragging the header. */
const DEFAULT_POS = { x: -1, y: -1 }; // sentinel: anchored, not popped out
const DEFAULT_SIZE = { width: 576, height: 320 };
const TERMINAL_SIZE_KEY = "cv-terminal-drawer-size";
const ROLE_LABELS: Record<string, string> = {
  review: "Review", reviewer: "Review", builder: "Builder", frontend: "Frontend",
  backend: "Backend", test: "Test", tester: "Test", docs: "Docs", doc: "Docs",
  design: "Design", security: "Security", general: "General",
};

export function terminalTitle(name: string, termNo: number): string {
  const namedRole = name.match(/^([a-z][a-z _-]*?)[-_ ](\d+)$/i);
  const roleKey = namedRole?.[1].toLowerCase().replace(/[ _-]/g, "");
  if (namedRole && roleKey && ROLE_LABELS[roleKey]) return `${ROLE_LABELS[roleKey]} ${namedRole[2]}`;
  if (/^terminal(?:[-_ ]?\d+)?$/i.test(name)) return `Terminal ${termNo > 0 ? termNo : ""}`.trim();
  return name || `Terminal ${termNo > 0 ? termNo : ""}`.trim();
}

type Props = { agentId: string; name: string; index?: number; onClose: (agentId: string) => void };

export const TerminalPanel = memo(function TerminalPanel({ agentId, name, index = 0, onClose }: Props) {
  const [confirmingKill, setConfirmingKill] = useState(false);
  const kill = useBoard((s) => s.kill);
  const [pos, setPos] = useState(DEFAULT_POS);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [size, setSize] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TERMINAL_SIZE_KEY) ?? "null");
      if (Number.isFinite(saved?.width) && Number.isFinite(saved?.height)) {
        return {
          width: Math.max(380, Math.min(1200, saved.width)),
          height: Math.max(240, Math.min(900, saved.height)),
        };
      }
    } catch { /* use the default size */ }
    return DEFAULT_SIZE;
  });
  const resizeRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  // Voice dictation — Web Speech API is free/on-device-ish, unlike
  // Deska's metered voice minutes. Dictates text into the PTY.
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  // Fullscreen: the complete terminal view (banner, tools, model, input
  // line) like a standalone TUI window — toggled by the ⤢ button.
  const [maxed, setMaxed] = useState(false);
  // Deska split: a second agent's terminal beside (right) or below (down)
  // this one inside the same drawer.
  const [split, setSplit] = useState<null | "right" | "down">(null);
  const [splitAgent, setSplitAgent] = useState<string | null>(null);
  // "split with NEW terminal": a fresh independent shell in the second pane
  // (Deska behavior) instead of mirroring an existing agent.
  const [pendingNew, setPendingNew] = useState<{ name: string; since: number } | null>(null);

  // Card-style header info: Terminal N · status · CLI mark + label.
  const agent = useBoard((s) => s.agents[agentId]);
  const activeBoard = useBoard((s) => s.activeBoard);
  const agentsMap = useBoard((s) => s.agents);
  const ptyBuffer = useBoard((s) => s.ptyBuffers[agentId]);
  useEffect(() => {
    if (!pendingNew) return;
    // Only match shells spawned AFTER the request — a same-named terminal
    // from an earlier session must not steal the pane.
    const hit = Object.values(agentsMap).find((a) => a.name === pendingNew.name && (a.seenAt ?? 0) >= pendingNew.since - 2000);
    if (hit) {
      setSplitAgent(hit.id);
      setPendingNew(null);
    }
  }, [agentsMap, pendingNew]);
  // The pane's agent is only valid while it lives on the board being shown —
  // after a board switch the picker would lie (display the first option)
  // while keystrokes still went to the previous board's agent.
  const splitAgentValid =
    splitAgent && agentsMap[splitAgent] && (agentsMap[splitAgent].board_id ?? "main") === activeBoard
      ? splitAgent
      : null;
  const termNo = Object.keys(agentsMap)
    .filter((id) => (agentsMap[id].board_id ?? "main") === activeBoard)
    .indexOf(agentId) + 1;
  const title = terminalTitle(name, termNo);
  const status = (agent?.status === "exited" ? "done" : agent?.status ?? "idle") as AgentStatus;
  const cli = (agent?.command ?? "bash").split(/\s+/)[0].toLowerCase();
  const meta = cliMeta(cli);
  const statusColor = STATUS_COLOR[status];
  const model = announcedModel(ptyBuffer);



  // Unmounting the drawer (close, pop-out, double-click expand) must stop
  // dictation — otherwise speech keeps landing in the PTY with no stop control.
  useEffect(() => () => { recRef.current?.stop?.(); }, []);

  const toggleDictation = () => {
    if (listening) {
      recRef.current?.stop?.();
      setListening(false);
      return;
    }
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const text = e.results[e.results.length - 1][0].transcript;
      if (text) {
        useBoard.getState().sendInput(agentId, new TextEncoder().encode(text + " "));
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const popped = pos.x >= 0;
  const panelStyle: React.CSSProperties = maxed
    ? { position: "fixed", inset: 12, zIndex: 40 }
    : popped
      ? { position: "absolute", left: pos.x, top: pos.y, zIndex: 20 }
      : { position: "absolute", bottom: 16 + index * 28, right: 16 + index * 28, zIndex: 20 };

  const onHeaderDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input, select")) return;
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 120, ev.clientX - d.dx)),
        y: Math.max(48, Math.min(window.innerHeight - 60, ev.clientY - d.dy)),
      });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onResizeDown = (e: React.PointerEvent) => {
    if (maxed) return;
    e.preventDefault();
    e.stopPropagation();
    markPtyResizeIntent(agentId);
    resizeRef.current = { x: e.clientX, y: e.clientY, width: size.width, height: size.height };
    let nextSize = { width: size.width, height: size.height };
    const move = (ev: PointerEvent) => {
      const start = resizeRef.current;
      if (!start) return;
      nextSize = {
        width: Math.max(380, Math.min(window.innerWidth * 0.92, start.width + ev.clientX - start.x)),
        height: Math.max(240, Math.min(window.innerHeight * 0.88, start.height + ev.clientY - start.y)),
      };
      setSize(nextSize);
    };
    const up = () => {
      resizeRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try { localStorage.setItem(TERMINAL_SIZE_KEY, JSON.stringify(nextSize)); } catch { /* noop */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className="terminal-drawer group"
      style={{
        ...panelStyle,
        display: "flex",
        flexDirection: "column",
        height: maxed ? undefined : size.height,
        width: maxed ? undefined : size.width,
        maxWidth: "92vw",
        maxHeight: "88vh",
        overflow: "hidden",
        background: "#0d0e10",
        border: "1px solid rgba(255,255,255,.12)",
        borderRadius: 12,
        boxShadow: "0 18px 48px rgba(0,0,0,.42)",
      }}
    >
      <div
        onPointerDown={onHeaderDown}
        title={popped ? "drag to move" : "drag to pop out onto the canvas"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          borderBottom: "1px solid var(--cv-glass-edge)",
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: "var(--cv-text-xs)",
            fontWeight: 600,
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 20,
              height: 20,
              borderRadius: 5,
              border: "1px solid rgba(120,150,190,0.45)",
              color: "#7cb9ff",
              fontSize: "var(--cv-text-xxs)",
              flex: "none",
            }}
          >
            ›_
          </span>
          <span style={{ color: "var(--cv-ink)", whiteSpace: "nowrap" }}>
            {title}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--cv-text-xxs)",
              fontWeight: 600,
              color: statusColor,
              whiteSpace: "nowrap",
            }}
          >
            <StatusBars color={statusColor} />
            {STATUS_LABEL[status]}
          </span>
          {model && (
            <span
              data-testid="terminal-model"
              title="model announced by this CLI"
              style={{ color: "var(--cv-ink-dim)", fontSize: "var(--cv-text-xxs)", whiteSpace: "nowrap" }}
            >
              {model}
            </span>
          )}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              marginLeft: "auto",
              fontSize: "var(--cv-text-xs)",
              fontWeight: 600,
              color: "var(--cv-ink-dim)",
              whiteSpace: "nowrap",
            }}
          >
            <CliMark cli={cli} color={meta.color} size={13} />
            {meta.label}
          </span>
        </span>
        <div
          className={`flex items-center gap-2 transition-opacity ${confirmingKill || listening ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            title="split right — second terminal beside this one"
            onClick={() => {
              const next = split === "right" ? null : "right";
              setSplit(next);
              if (next && !splitAgent) {
                const other = Object.keys(agentsMap).find((id) => id !== agentId && (agentsMap[id].board_id ?? "main") === activeBoard);
                setSplitAgent(other ?? null);
              }
            }}
            style={{
              border: "none",
              background: "transparent",
              fontSize: "var(--cv-text-xxs)",
              cursor: "pointer",
              color: split === "right" ? "var(--cv-accent)" : "var(--cv-ink-dim)",
            }}
          >
            ▸▪
          </button>
          <button
            title="split down — second terminal below this one"
            onClick={() => {
              const next = split === "down" ? null : "down";
              setSplit(next);
              if (next && !splitAgent) {
                const other = Object.keys(agentsMap).find((id) => id !== agentId && (agentsMap[id].board_id ?? "main") === activeBoard);
                setSplitAgent(other ?? null);
              }
            }}
            style={{
              border: "none",
              background: "transparent",
              fontSize: "var(--cv-text-xxs)",
              cursor: "pointer",
              color: split === "down" ? "var(--cv-accent)" : "var(--cv-ink-dim)",
            }}
          >
            ▾▪
          </button>
          <button
            title="pop out onto the canvas as a card"
            onClick={() => {
              useBoard.getState().openTermNode(agentId);
              onClose(agentId);
            }}
            style={{
              border: "none",
              background: "transparent",
              fontSize: "var(--cv-text-xs)",
              cursor: "pointer",
              color: "var(--cv-ink-dim)",
            }}
          >
            ⇱
          </button>
          <button
            title={maxed ? "restore" : "maximize — full terminal"}
            onClick={() => setMaxed((m) => !m)}
            style={{
              border: "none",
              background: "transparent",
              fontSize: "var(--cv-text-xs)",
              cursor: "pointer",
              color: "var(--cv-ink-dim)",
            }}
          >
            ⤢
          </button>
          <button
            className="nodrag"
            title="files — open this agent's worktree in the repo explorer"
            onClick={() => {
              const st = useBoard.getState();
              const aid = agentId;
              const a = aid ? st.agents[aid] : undefined;
              const wsRepo = a?.workspace_id ? st.workspaces[a.workspace_id]?.repo : undefined;
              st.openExplorer(a?.worktree ?? wsRepo);
            }}
            style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--cv-ink-dim)", fontSize: "var(--cv-text-xxs)" }}
          >
            ⌸
          </button>
          <button
            title="copy terminal output to clipboard"
            onClick={() => {
              const buf = useBoard.getState().ptyBuffers[agentId];
              if (!buf) return;
              const text = new TextDecoder()
                .decode(buf)
                // strip ANSI escapes + OSC + stray control chars
                .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
                .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
                .replace(/\x1b[@-_]/g, "")
                .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
              navigator.clipboard.writeText(text);
            }}
            style={{
              border: "none",
              background: "transparent",
              fontSize: "var(--cv-text-xxs)",
              cursor: "pointer",
              color: "var(--cv-ink-dim)",
            }}
          >
            ⧉
          </button>
          {([
            ["esc", "\x1b"],
            ["↵", "\r"],
            ["^C", "\x03"],
            ["↑", "\x1b[A"],
            ["↓", "\x1b[B"],
          ] as const).map(([label, seq]) => (
            <button
              key={label}
              title={`send ${label === "↵" ? "enter" : label === "^C" ? "ctrl+c" : label} to the PTY`}
              onClick={() => useBoard.getState().sendInput(agentId, new TextEncoder().encode(seq))}
              style={{
                border: "none",
                background: "transparent",
                fontSize: "var(--cv-text-xxs)",
                cursor: "pointer",
                color: "var(--cv-ink-dim)",
                fontFamily: "var(--cv-font-mono)",
                padding: "0 2px",
              }}
            >
              {label}
            </button>
          ))}
          <button
            title={listening ? "stop dictation" : "dictate into this terminal"}
            onClick={toggleDictation}
            style={{
              border: "none",
              background: "transparent",
              fontSize: "var(--cv-text-xxs)",
              cursor: "pointer",
              color: listening ? "var(--cv-blocked)" : "var(--cv-ink-dim)",
              animation: listening ? "pulse-dot 1.2s ease-in-out infinite" : "none",
            }}
          >
            {listening ? "◉" : "🎙"}
          </button>
          {confirmingKill ? (
            <>
              <span className="text-[10px] text-[var(--cv-blocked)]">confirm kill?</span>
              <button
                className="rounded bg-[var(--cv-blocked)]/20 px-2 py-0.5 text-[10px] font-semibold text-[var(--cv-blocked)]"
                onClick={() => {
                  kill(agentId);
                  setConfirmingKill(false);
                  onClose(agentId);
                }}
              >
                kill
              </button>
              <button
                className="text-[10px] text-[var(--cv-ink-dim)]"
                onClick={() => setConfirmingKill(false)}
              >
                cancel
              </button>
            </>
          ) : (
            <button
              className="text-[10px] text-[var(--cv-ink-dim)] hover:text-[var(--cv-blocked)]"
              onClick={() => setConfirmingKill(true)}
            >
              kill
            </button>
          )}
          <button className="text-xs text-[var(--cv-ink-dim)]" onClick={() => onClose(agentId)}>
            ✕
          </button>
        </div>
      </div>
      <div
        className="min-h-0 flex-1"
        style={{ display: "flex", flexDirection: split === "down" ? "column" : "row" }}
      >
        <TermHost agentId={agentId} />
        {split && (
          <div
            className="min-h-0 flex-1"
            style={{
              display: "flex",
              flexDirection: "column",
              borderLeft: split === "right" ? "1px solid var(--cv-glass-edge)" : "none",
              borderTop: split === "down" ? "1px solid var(--cv-glass-edge)" : "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px", borderBottom: "1px solid var(--cv-glass-edge)" }}>
              <select
                value={splitAgentValid ?? ""}
                onChange={(e) => setSplitAgent(e.target.value || null)}
                title="which agent this pane shows"
                style={{
                  flex: 1,
                  fontSize: "var(--cv-text-xxs)",
                  background: "transparent",
                  color: "var(--cv-ink)",
                  border: "none",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                {!splitAgent && <option value="">pick an agent…</option>}
                {Object.values(agentsMap)
                  .filter((a) => (a.board_id ?? "main") === activeBoard)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
              <button
                title="split with a NEW independent terminal — fresh bash shell in this pane"
                onClick={() => {
                  const name = `split-term-${Date.now() % 100000}`;
                  setPendingNew({ name, since: Date.now() });
                  useBoard.getState().spawn(name, "bash");
                }}
                style={{ border: "none", background: "transparent", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: "var(--cv-text-xxs)" }}
              >
                ＋
              </button>
              <button
                title="close split"
                onClick={() => setSplit(null)}
                style={{ border: "none", background: "transparent", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: "var(--cv-text-xxs)" }}
              >
                ✕
              </button>
            </div>
            {splitAgentValid ? (
              <TermHost agentId={splitAgentValid} />
            ) : (
              <div className="flex-1" style={{ display: "grid", placeItems: "center", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)" }}>
                no second agent on this board yet
              </div>
            )}
          </div>
        )}
      </div>
      {!maxed && (
        <div
          data-testid="terminal-resize-handle"
          role="separator"
          aria-label="Resize terminal"
          onPointerDown={onResizeDown}
          title="drag to resize terminal"
          style={{
            position: "absolute",
            right: 1,
            bottom: 1,
            width: 18,
            height: 18,
            cursor: "nwse-resize",
            touchAction: "none",
            zIndex: 2,
            background: "linear-gradient(135deg, transparent 45%, var(--cv-ink-faint) 47%, var(--cv-ink-faint) 51%, transparent 53%, transparent 65%, var(--cv-ink-faint) 67%, var(--cv-ink-faint) 71%, transparent 73%)",
            opacity: 0.65,
          }}
        />
      )}
    </div>
  );
});
