import { useState } from "react";
import { panelRoot } from "./panelChrome";
import { useBoard, acctKey, DEFAULT_WEEK_CAP_KB } from "../store/board";

const CLIS = [
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
  { cmd: "kimi", label: "◻ Kimi Code" },
  { cmd: "vibe", label: "▦ Mistral Vibe" },
  { cmd: "pi", label: "▶ Pi" },
  { cmd: "antigravity", label: "▲ Antigravity" },
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

const fmtBytes = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1000 ? `${(n / 1000).toFixed(1)} KB` : `${n} B`;

/** Weekly-cap editor for one usage key — inline KB input, empty = default. */
function CapEditor({ usageKey, capKb }: { usageKey: string; capKb: number }) {
  const setAcctCap = useBoard((s) => s.setAcctCap);
  const custom = useBoard((s) => s.acctLedger.caps[usageKey]);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  if (!editing) {
    return (
      <button
        title="edit this account's weekly cap"
        style={{ border: "none", background: "none", cursor: "pointer", color: "var(--cv-ink-dim)", fontSize: 9.5, padding: 0 }}
        onClick={() => { setVal(custom != null ? String(custom) : ""); setEditing(true); }}
      >
        {custom != null ? `cap ${fmtBytes(capKb * 1024)}` : "cap"}
      </button>
    );
  }
  return (
    <input
      autoFocus
      style={{ ...inputStyle, width: 72, padding: "2px 8px", fontSize: 10 }}
      placeholder={`${DEFAULT_WEEK_CAP_KB / 1024} MB`}
      title="weekly cap in KB — Enter to save, empty = default"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const kb = parseFloat(val);
          setAcctCap(usageKey, Number.isFinite(kb) && kb > 0 ? kb : null);
          setEditing(false);
        }
        if (e.key === "Escape") setEditing(false);
      }}
      onBlur={() => setEditing(false)}
    />
  );
}

/** Named sign-ins per CLI — "one agent, three accounts, all at work":
 * each account owns an isolated config dir so e.g. two Codex logins run
 * side by side and every node shows which account is doing the work.
 * Rows group by CLI and carry their week's metered volume + cap. */
export function AccountsPanel() {
  const accounts = useBoard((s) => s.accounts);
  const agents = useBoard((s) => s.agents);
  const sessionUse = useBoard((s) => s.sessionUse);
  const ledger = useBoard((s) => s.acctLedger);
  const createAccount = useBoard((s) => s.createAccount);
  const deleteAccount = useBoard((s) => s.deleteAccount);
  const spawn = useBoard((s) => s.spawn);

  const [creating, setCreating] = useState(false);
  const [cli, setCli] = useState("codex");
  const [label, setLabel] = useState("");
  const [env, setEnv] = useState("");

  const list = Object.values(accounts);
  const inUse = new Set(
    Object.values(agents)
      .map((a) => a.account_label)
      .filter((l): l is string => !!l),
  );
  // Group accounts by CLI so a multi-login CLI shows its rows together.
  const byCli = new Map<string, typeof list>();
  for (const a of list) {
    const g = byCli.get(a.cli) ?? [];
    g.push(a);
    byCli.set(a.cli, g);
  }
  const cliGroups = [...byCli.entries()].sort(([a], [b]) => a.localeCompare(b));

  const totalBytes = Object.values(agents).reduce((t, a) => t + (a.output_bytes ?? 0), 0);

  return (
    <div
      style={{ ...panelRoot, padding: "12px 10px" }}
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
            <input
              style={inputStyle}
              placeholder="auth env var — optional (e.g. MYCLI_HOME)"
              title="Env var that points this CLI at the account's config dir. Leave empty to use the CLI's known key (CODEX_HOME, CLAUDE_CONFIG_DIR, GEMINI_CLI_HOME)."
              value={env}
              onChange={(e) => setEnv(e.target.value)}
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
                createAccount(cli, label.trim(), env.trim() || undefined);
                setLabel("");
                setEnv("");
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
        {cliGroups.map(([groupCli, rows]) => (
          <div key={groupCli}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: "var(--cv-ink-faint)",
                padding: "6px 12px 3px",
              }}
            >
              {CLIS.find((c) => c.cmd === groupCli)?.label ?? groupCli}
            </div>
            {rows.map((a) => {
              const key = acctKey(a.cli, a.label);
              const week = ledger.bytes[key] ?? 0;
              const capKb = ledger.caps[key] ?? DEFAULT_WEEK_CAP_KB;
              const pct = Math.min(100, (week / 1024 / capKb) * 100);
              const sess = sessionUse[key] ?? 0;
              return (
                <div
                  key={a.account_id}
                  style={{
                    margin: "0 4px 6px",
                    padding: "9px 12px",
                    borderRadius: 14,
                    background: "var(--cv-glass-hi)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, color: "var(--cv-accent)", flex: "none" }}>
                      {CLIS.find((c) => c.cmd === a.cli)?.label.split(" ")[0] ?? "▢"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--cv-ink)" }}>
                        @{a.label}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--cv-ink-dim)" }}>
                        {a.cli}
                        {(sess > 0 || week > 0) && (
                          <span style={{ color: "var(--cv-accent)", opacity: 0.85 }}>
                            {" "}· {fmtBytes(sess)} session · {fmtBytes(week)} week
                          </span>
                        )}
                      </div>
                    </div>
                    <CapEditor usageKey={key} capKb={capKb} />
                    <button
                      title={`spawn a ${a.cli} agent as @${a.label}`}
                      style={{ border: "none", background: "none", cursor: "pointer", color: "var(--cv-accent)", fontSize: 14, fontWeight: 700, padding: "0 2px" }}
                      onClick={() => spawn(a.cli, a.cli, undefined, undefined, a.account_id)}
                    >
                      +
                    </button>
                    <button
                      title={inUse.has(a.label) ? "in use by an agent" : "delete account"}
                      style={{ border: "none", background: "none", cursor: "pointer", color: "var(--cv-ink-dim)", fontSize: 13 }}
                      onClick={() => deleteAccount(a.account_id)}
                    >
                      ×
                    </button>
                  </div>
                  {/* weekly-cap meter — matches the Juice panel */}
                  <div
                    title={`${Math.round(pct)}% of the ${fmtBytes(capKb * 1024)} weekly cap`}
                    style={{
                      marginTop: 6,
                      height: 3,
                      borderRadius: 99,
                      background: "var(--cv-glass-edge)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        borderRadius: 99,
                        background: pct >= 75 ? "var(--cv-blocked)" : pct >= 50 ? "var(--cv-waiting)" : "var(--cv-accent)",
                        transition: "width .4s ease",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
