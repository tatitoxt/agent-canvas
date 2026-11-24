import { useState } from "react";
import { useBoard } from "../store/board";

const CLIS = [
  { cmd: "claude", label: "◆ Claude Code" },
  { cmd: "codex", label: "◈ Codex" },
  { cmd: "gemini", label: "✦ Gemini CLI" },
  { cmd: "claude", label: "◆ Claude Code" },
  { cmd: "codex", label: "◈ Codex" },
  { cmd: "gemini", label: "✦ Gemini CLI" },
  { cmd: "aider", label: "▣ Aider" },
  { cmd: "cursor-agent", label: "◐ Cursor" },
  { cmd: "opencode", label: "❖ OpenCode" },
  { cmd: "amp", label: "▲ Amp" },
  { cmd: "droid", label: "⬡ Droid" },
  { cmd: "goose", label: "◈ Goose" },
  { cmd: "kilocode", label: "◈ Kilocode" },
  { cmd: "qwen", label: "✧ Qwen Code" },
  { cmd: "hermes", label: "◧ Hermes" },
];

const inputStyle: React.CSSProperties = {
  background: "var(--cv-glass-hi)",
  border: "1px solid var(--cv-glass-edge)",
  borderRadius: 999,
  padding: "6px 12px",
  fontSize: 12,
  color: "var(--cv-ink)",
  outline: "none",
  width: "100%",
};

/** Named sign-ins per CLI — "one agent, three accounts, all at work":
 * each account owns an isolated config dir so e.g. two Codex logins run
 * side by side and every node shows which account is doing the work. */
export function AccountsPanel() {
  const accounts = useBoard((s) => s.accounts);
  const agents = useBoard((s) => s.agents);
  const createAccount = useBoard((s) => s.createAccount);
  const deleteAccount = useBoard((s) => s.deleteAccount);

  const [creating, setCreating] = useState(false);
  const [cli, setCli] = useState("codex");
  const [label, setLabel] = useState("");

  const list = Object.values(accounts);
  const inUse = new Set(
    Object.values(agents)
      .map((a) => a.account_label)
      .filter((l): l is string => !!l),
  );
  // Usage per account: agents run under it and their PTY output bytes.
  const usage = new Map<string, { agents: number; bytes: number }>();
  for (const a of Object.values(agents)) {
    if (!a.account_label) continue;
    const u = usage.get(a.account_label) ?? { agents: 0, bytes: 0 };
    u.agents += 1;
    u.bytes += a.output_bytes ?? 0;
    usage.set(a.account_label, u);
  }
  const fmtBytes = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1000 ? `${(n / 1000).toFixed(1)} KB` : `${n} B`;
  const totalBytes = Object.values(agents).reduce((t, a) => t + (a.output_bytes ?? 0), 0);

  return (
    <div
      className="glass"
      style={{
        position: "absolute",
        left: 64,
        top: 64,
        bottom: 64,
        width: 320,
        zIndex: 19,
        display: "flex",
        flexDirection: "column",
        padding: "12px 10px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 650,
          padding: "0 12px 8px",
          color: "var(--cv-ink)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        Accounts
        <button
          className="glass-pill"
          style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 11px", cursor: "pointer", border: "none", color: "var(--cv-accent)" }}
          onClick={() => setCreating((c) => !c)}
        >
          {creating ? "cancel" : "+ new"}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {creating && (
          <div
            style={{
              margin: "0 4px 10px",
              padding: "10px 12px",
              borderRadius: 14,
              background: "var(--cv-glass-hi)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={cli}
              onChange={(e) => setCli(e.target.value)}
            >
              {CLIS.map((c) => (
                <option key={c.cmd} value={c.cmd}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              style={inputStyle}
              placeholder="label (e.g. personal, work, client)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
            <div style={{ fontSize: 10.5, color: "var(--cv-ink-dim)", padding: "0 2px" }}>
              Each account gets its own config dir — sign in inside the
              agent's terminal and the login stays scoped to @{label.trim() || "label"}.
            </div>
            <button
              className="glass-pill"
              style={{ fontSize: 11.5, fontWeight: 600, padding: "6px 14px", cursor: "pointer", border: "none", color: "var(--cv-accent)", opacity: label.trim() ? 1 : 0.45, alignSelf: "flex-start" }}
              disabled={!label.trim()}
              onClick={() => {
                createAccount(cli, label.trim());
                setLabel("");
                setCreating(false);
              }}
            >
              create account
            </button>
          </div>
        )}
        {list.length === 0 && !creating && (
          <div style={{ fontSize: 11.5, color: "var(--cv-ink-dim)", padding: "4px 12px" }}>
            No named accounts — agents use the machine's default sign-in.
          </div>
        )}
        {list.length > 0 && (
          <div style={{ fontSize: 10.5, color: "var(--cv-ink-dim)", padding: "0 12px 6px" }}>
            all agents · {fmtBytes(totalBytes)} output
          </div>
        )}
        {list.map((a) => (
          <div
            key={a.account_id}
            style={{
              margin: "0 4px 6px",
              padding: "9px 12px",
              borderRadius: 14,
              background: "var(--cv-glass-hi)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--cv-accent)", flex: "none" }}>
              {CLIS.find((c) => c.cmd === a.cli)?.label.split(" ")[0] ?? "▢"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--cv-ink)" }}>
                @{a.label}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--cv-ink-dim)" }}>
                {a.cli}
                {usage.has(a.label) && (
                  <span style={{ color: "var(--cv-accent)", opacity: 0.85 }}>
                    {" "}· {usage.get(a.label)!.agents} agent{usage.get(a.label)!.agents === 1 ? "" : "s"} · {fmtBytes(usage.get(a.label)!.bytes)}
                  </span>
                )}
              </div>
            </div>
            <button
              title={inUse.has(a.label) ? "in use by an agent" : "delete account"}
              style={{ border: "none", background: "none", cursor: "pointer", color: "var(--cv-ink-dim)", fontSize: 13 }}
              onClick={() => deleteAccount(a.account_id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
