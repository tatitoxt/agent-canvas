import { useEffect, useRef, useState } from "react";
import { getAgentSpawnPositions, useBoard, PERMISSION_LEVELS } from "../store/board";
import { CliMark } from "./CliMark";
import { cliMeta } from "../board/nodes";

const inputStyle: React.CSSProperties = {
  background: "var(--cv-glass-hi)",
  border: "1px solid var(--cv-glass-edge)",
  borderRadius: 10,
  height: 30,
  padding: "0 10px",
  fontSize: 11.5,
  lineHeight: 1,
  color: "var(--cv-ink)",
  outline: "none",
  width: "100%",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 8.5,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "var(--cv-ink-faint)",
  padding: "6px 4px 2px",
};

/** Official agent CLIs offered by the picker — Deska-style agent chooser.
 * "custom" keeps free-text for anything else (aider, scripts, …). */
const AGENT_CHOICES = [
  { cmd: "claude", label: "Claude Code" },
  { cmd: "codex", label: "Codex" },
  { cmd: "gemini", label: "Gemini CLI" },
  { cmd: "aider", label: "Aider" },
  { cmd: "cursor-agent", label: "Cursor" },
  { cmd: "opencode", label: "OpenCode" },
  { cmd: "amp", label: "Amp" },
  { cmd: "droid", label: "Droid" },
  { cmd: "goose", label: "Goose" },
  { cmd: "kilocode", label: "Kilocode" },
  { cmd: "qwen", label: "Qwen Code" },
  { cmd: "hermes", label: "Hermes" },
  { cmd: "kimi", label: "Kimi Code" },
  { cmd: "vibe", label: "Mistral Vibe" },
  { cmd: "pi", label: "Pi" },
  { cmd: "antigravity", label: "Antigravity" },
  { cmd: "bash", label: "Terminal" },
  { cmd: "custom", label: "custom command…" },
];

/** One "+" bubble bottom-center → opens an Apple-style popover that asks
 * what to spawn: CLI grid, workspace, permission, account. The canvas
 * stays clean until you ask for an agent. */
export function SpawnBar() {
  const connected = useBoard((s) => s.connected);
  const connect = useBoard((s) => s.connect);
  const spawn = useBoard((s) => s.spawn);
  // The chooser has no permanent button — it opens from the
  // orchestrator's + or the rail's New Task.
  const open = useBoard((s) => s.spawnOpen);
  const setOpen = useBoard((s) => s.setSpawnOpen);
  const [choice, setChoice] = useState("claude");
  const [command, setCommand] = useState("");
  const [permission, setPermission] = useState("supervised");
  const [count, setCount] = useState(1);
  const workspaces = useBoard((s) => s.workspaces);
  const activeBoard = useBoard((s) => s.activeBoard);
  const boardWs = Object.values(workspaces).filter((w) => (w.board_id ?? "main") === activeBoard);
  const [wsId, setWsId] = useState<string>("");
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const canSpawn = connected && (choice !== "custom" || command.trim().length > 0);

  return (
    <div
      ref={wrap}
      style={{
        position: "absolute",
        left: "50%",
        bottom: 64,
        transform: "translateX(-50%)",
        zIndex: 15,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {open && (
        <div
          className="cv-menu cv-menu-scroll"
          style={{
            width: 300,
            maxHeight: "62vh",
            overflowY: "auto",
            padding: 10,
            marginBottom: 10,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {!connected ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 4 }}>
              <span style={{ flex: 1, fontSize: 11.5, color: "var(--cv-ink-dim)" }}>
                daemon offline
              </span>
              <button
                className="glass-pill"
                style={{ ...inputStyle, width: "auto", cursor: "pointer" }}
                onClick={() => connect("")}
              >
                connect
              </button>
            </div>
          ) : (
            <>
              <div style={sectionLabel}>Spawn an agent</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 4,
                  maxHeight: 168,
                  overflowY: "auto",
                  paddingRight: 2,
                }}
              >
                {AGENT_CHOICES.map((c) => {
                  const on = choice === c.cmd;
                  const color = c.cmd === "custom" ? "var(--cv-ink-dim)" : cliMeta(c.cmd).color;
                  return (
                    <button
                      key={c.cmd}
                      title={`${c.label}${on ? " — selected" : ""}`}
                      onClick={() => setChoice(c.cmd)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        height: 26,
                        padding: "0 8px",
                        borderRadius: 8,
                        border: `1px solid ${on ? "var(--cv-accent)" : "var(--cv-glass-edge)"}`,
                        background: on ? "color-mix(in srgb, var(--cv-accent) 16%, transparent)" : "var(--cv-glass-hi)",
                        color: on ? "var(--cv-ink)" : "var(--cv-ink-dim)",
                        fontSize: 10.5,
                        fontWeight: on ? 650 : 500,
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "inherit",
                      }}
                    >
                      {c.cmd === "custom" ? (
                        <span style={{ width: 13, textAlign: "center", fontSize: 12 }}>+</span>
                      ) : (
                        <CliMark cli={c.cmd} color={color} size={13} />
                      )}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {boardWs.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "var(--cv-ink-dim)", flex: 1 }} title="inside a workspace the agent gets its own git worktree of that repo">
                    workspace
                  </span>
                  <select
                    value={wsId}
                    onChange={(e) => setWsId(e.target.value)}
                    style={{ ...inputStyle, width: 150, cursor: "pointer" }}
                    title="spawn inside this workspace — own git worktree"
                  >
                    <option value="">none — plain shell</option>
                    {boardWs.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {choice === "custom" && (
                <input
                  style={inputStyle}
                  placeholder="command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  autoFocus
                />
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 4 }} title="permission level — what the agent may do without asking">
                {PERMISSION_LEVELS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setPermission(l.id)}
                    title={`${l.label} — ${l.hint}`}
                    style={{
                      flex: 1,
                      height: 22,
                      borderRadius: 7,
                      border: `1px solid ${permission === l.id ? "var(--cv-perm)" : "var(--cv-glass-edge)"}`,
                      background: permission === l.id ? "color-mix(in srgb, var(--cv-perm) 16%, transparent)" : "transparent",
                      color: permission === l.id ? "var(--cv-perm)" : "var(--cv-ink-dim)",
                      fontSize: 9.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {l.id === "auto_accept" ? "edits" : l.id}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 10, color: "var(--cv-ink-dim)", flex: 1 }} title="parallel workers — each runs in its own git worktree">
                  workers · own worktree each
                </span>
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    title={`spawn ${n} worker${n > 1 ? "s" : ""} on the same task`}
                    onClick={() => setCount(n)}
                    style={{
                      width: 22,
                      height: 20,
                      borderRadius: 6,
                      border: `1px solid ${count === n ? "var(--cv-accent)" : "var(--cv-glass-edge)"}`,
                      background: count === n ? "color-mix(in srgb, var(--cv-accent) 18%, transparent)" : "var(--cv-glass-hi)",
                      color: count === n ? "var(--cv-accent)" : "var(--cv-ink-dim)",
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button
                style={{
                  height: 32,
                  borderRadius: 10,
                  border: "none",
                  marginTop: 2,
                  background: "var(--cv-accent)",
                  color: "#14110d",
                  fontWeight: 700,
                  fontSize: 11.5,
                  cursor: "pointer",
                  boxShadow: "0 0 0 1px color-mix(in srgb, var(--cv-accent) 30%, transparent)",
                  opacity: canSpawn ? 1 : 0.45,
                }}
                disabled={!canSpawn}
                onClick={() => {
                  const cmd = choice === "custom" ? command.trim() : choice;
                  const st = useBoard.getState();
                  const origin = st.pendingSpawnPos;
                  st.setPendingSpawnPos(null);
                  const existing = Object.values(st.agents).filter((a) => (a.board_id ?? "main") === st.activeBoard);
                  let placements: Array<{ x: number; y: number }>;
                  if (wsId) {
                    const wsAgents = existing.filter((a) => a.workspace_id === wsId);
                    const row = wsAgents.length;
                    const wsSize = st.workspaceSizes[wsId] ?? { w: 900, h: 540 };
                    st.resizeWorkspace(wsId, Math.max(wsSize.w, 520), Math.max(wsSize.h, 100 + (row + count) * 284));
                    placements = Array.from({ length: count }, (_, i) => ({ x: 24, y: 64 + (row + i) * 284 }));
                  } else {
                    const explicit = existing.filter((a) => !a.workspace_id && st.positions[a.id]);
                    const missing = existing.filter((a) => !a.workspace_id && !st.positions[a.id]);
                    const fallback = getAgentSpawnPositions(missing.length, st.viewportRect, explicit.map((a) => ({ ...st.positions[a.id], w: st.agentSizes[a.id]?.w ?? 460, h: st.agentSizes[a.id]?.h ?? 260 })));
                    const occupied = [
                      ...explicit.map((a) => ({ ...st.positions[a.id], w: st.agentSizes[a.id]?.w ?? 460, h: st.agentSizes[a.id]?.h ?? 260 })),
                      ...fallback.map((p) => ({ ...p, w: 460, h: 260 })),
                      ...Object.values(st.panelNodes[st.activeBoard] ?? {}).map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })),
                      ...Object.values(st.termNodes[st.activeBoard] ?? {}).map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })),
                    ];
                    placements = getAgentSpawnPositions(count, st.viewportRect, occupied, { w: 460, h: 260 }, origin);
                  }
                  for (let i = 0; i < count; i++) {
                    const name = count > 1 ? `${cmd}-p${i + 1}` : cmd;
                    st.setSpawnPositionForName(name, placements[i]);
                    spawn(
                      name,
                      cmd,
                      wsId || undefined,
                      permission,
                      undefined,
                      count > 1
                        ? `You are worker ${i + 1} of ${count} on a parallel task — each worker has its own worktree, work independently.`
                        : undefined,
                    );
                  }
                  setCount(1);
                  setOpen(false);
                }}
              >
                {count > 1 ? `+ spawn ×${count}` : "+ spawn"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
