import { useEffect, useRef, useState } from "react";
import { useBoard } from "../store/board";
import { Icon } from "./icons";

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
  const spawnFocusN = useBoard((s) => s.spawnFocusN);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("claude");
  const [command, setCommand] = useState("");
  const [wsId, setWsId] = useState("");
  const [permission, setPermission] = useState("supervised");
  const [acctId, setAcctId] = useState("");
  const [task, setTask] = useState("");
  const acctOptions = Object.values(accounts).filter((a) => a.cli === choice);
  const wrap = useRef<HTMLDivElement>(null);

  // "New task" in the rail opens the chooser.
  useEffect(() => {
    if (spawnFocusN > 0) setOpen(true);
  }, [spawnFocusN]);

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
        bottom: 22,
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
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                title="agent CLI"
                autoFocus
              >
                {AGENT_CHOICES.map((c) => (
                  <option key={c.cmd} value={c.cmd}>
                    {c.label}
                  </option>
                ))}
              </select>
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
                  spawn(cmd, cmd, wsId || undefined, permission, acctId || undefined, task.trim() || undefined);
                  setTask("");
                  setOpen(false);
                }}
              >
                + spawn
              </button>
            </>
          )}
        </div>
      )}
      <button
        className="glass-pill"
        onClick={() => setOpen((o) => !o)}
        title={open ? "close" : "Spawn — pick an agent to run on the canvas"}
        style={{
          width: 40,
          height: 40,
          display: "grid",
          placeItems: "center",
          borderRadius: 999,
          cursor: "pointer",
          color: open ? "var(--cv-base)" : "var(--cv-accent)",
          background: open ? "var(--cv-accent)" : undefined,
          boxShadow: open ? "0 0 18px rgba(245,165,36,0.45)" : undefined,
          fontSize: 20,
          fontWeight: 600,
          transform: open ? "rotate(45deg)" : "none",
          transition: "transform 140ms ease, background 140ms ease",
        }}
      >
        <Icon name="plus" size={18} color={open ? "#14110d" : "var(--cv-accent)"} />
      </button>
    </div>
  );
}
