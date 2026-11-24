import { useEffect, useRef, useState } from "react";
import { useBoard } from "../store/board";
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
  const workspaces = useBoard((s) => s.workspaces);
  const accounts = useBoard((s) => s.accounts);
  // The chooser has no permanent button — it opens from the
  // orchestrator's + or the rail's New Task.
  const open = useBoard((s) => s.spawnOpen);
  const setOpen = useBoard((s) => s.setSpawnOpen);
  const [choice, setChoice] = useState("claude");
  const [command, setCommand] = useState("");
  const [wsId, setWsId] = useState("");
  const [permission, setPermission] = useState("supervised");
  const [acctId, setAcctId] = useState("");
  const [task, setTask] = useState("");
  const [count, setCount] = useState(1);
  const acctOptions = Object.values(accounts).filter((a) => a.cli === choice);
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
              {choice === "custom" && (
                <input
                  style={inputStyle}
                  placeholder="command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  autoFocus
                />
              )}
              <select
                style={{ ...inputStyle, cursor: "pointer", color: wsId ? "var(--cv-ink)" : "var(--cv-ink-dim)" }}
                value={wsId}
                onChange={(e) => setWsId(e.target.value)}
                title="workspace"
              >
                <option value="">no workspace</option>
                {Object.values(workspaces).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <select
                style={{ ...inputStyle, cursor: "pointer", color: permission === "supervised" ? "var(--cv-ink-dim)" : "var(--cv-accent)" }}
                value={permission}
                onChange={(e) => setPermission(e.target.value)}
                title="permission level — what the agent may do without asking"
              >
                <option value="supervised">supervised</option>
                <option value="auto_accept">auto-accept edits</option>
                <option value="auto">auto</option>
                <option value="full">full access</option>
              </select>
              {acctOptions.length > 0 && (
                <select
                  style={{ ...inputStyle, cursor: "pointer", color: acctId ? "var(--cv-accent)" : "var(--cv-ink-dim)" }}
                  value={acctId}
                  onChange={(e) => setAcctId(e.target.value)}
                  title="which sign-in this agent uses — two accounts of the same CLI can run side by side"
                >
                  <option value="">default account</option>
                  {acctOptions.map((a) => (
                    <option key={a.account_id} value={a.account_id}>
                      @{a.label}
                    </option>
                  ))}
                </select>
              )}
              <input
                style={inputStyle}
                placeholder="initial task (optional) — typed in after boot"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                title="Quick request — typed into the terminal a few seconds after the CLI starts"
              />
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 10, color: "var(--cv-ink-dim)", flex: 1 }} title="parallel tasks — each worker runs the same prompt in its own git worktree">
                  parallel workers · own worktree each
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
                      fontWeight: 650,
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
                  boxShadow: "0 0 14px rgba(245,165,36,0.35)",
                  opacity: canSpawn ? 1 : 0.45,
                }}
                disabled={!canSpawn}
                onClick={() => {
                  const cmd = choice === "custom" ? command.trim() : choice;
                  const t = task.trim();
                  for (let i = 0; i < count; i++) {
                    const brief = count > 1 && t
                      ? `You are worker ${i + 1} of ${count} on a parallel task — each worker has its own worktree, work independently.\n\n${t}`
                      : t || undefined;
                    spawn(
                      count > 1 ? `${cmd}-p${i + 1}` : cmd,
                      cmd,
                      wsId || undefined,
                      permission,
                      acctId || undefined,
                      brief,
                    );
                  }
                  setTask("");
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
