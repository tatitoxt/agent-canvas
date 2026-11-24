import { useState } from "react";
import { useBoard } from "../store/board";

const inputStyle: React.CSSProperties = {
  background: "var(--cv-glass-hi)",
  border: "1px solid var(--cv-glass-edge)",
  borderRadius: 999,
  padding: "6px 12px",
  fontSize: 12,
  color: "var(--cv-ink)",
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--cv-ink)",
  cursor: "pointer",
};

/** Official agent CLIs offered by the picker — Deska-style agent chooser.
 * "custom" keeps free-text for anything else (aider, scripts, …). */
const AGENT_CHOICES = [
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
  { cmd: "kimi", label: "◻ Kimi Code" },
  { cmd: "vibe", label: "▦ Mistral Vibe" },
  { cmd: "pi", label: "▶ Pi" },
  { cmd: "antigravity", label: "▲ Antigravity" },
  { cmd: "bash", label: "›_ Terminal" },
  { cmd: "custom", label: "… custom command" },
];

export function SpawnBar() {
  const connected = useBoard((s) => s.connected);
  const connect = useBoard((s) => s.connect);
  const spawn = useBoard((s) => s.spawn);
  const workspaces = useBoard((s) => s.workspaces);
  const accounts = useBoard((s) => s.accounts);
  const createWorkspace = useBoard((s) => s.createWorkspace);
  const [choice, setChoice] = useState("claude");
  const [command, setCommand] = useState("");
  const [name, setName] = useState("");
  const [wsId, setWsId] = useState("");
  const [permission, setPermission] = useState("supervised");
  const [acctId, setAcctId] = useState("");
  // Named sign-ins of the chosen CLI — "default" = the machine login.
  const acctOptions = Object.values(accounts).filter((a) => a.cli === choice);
  const [makingWs, setMakingWs] = useState(false);
  const [makingWeb, setMakingWeb] = useState(false);
  const [webUrl, setWebUrl] = useState("");
  const [wsName, setWsName] = useState("");
  const [wsRepo, setWsRepo] = useState("");

  return (
    <div
      className="glass-pill"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 22,
        transform: "translateX(-50%)",
        zIndex: 15,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px 8px 16px",
      }}
    >
      {!connected ? (
        <>
          <span style={{ fontSize: 11.5, color: "var(--cv-ink-dim)" }}>
            daemon offline
          </span>
          <button className="glass-pill" style={buttonStyle} onClick={() => connect("")}>
            connect
          </button>
        </>
      ) : makingWeb ? (
        <>
          <input
            style={{ ...inputStyle, width: 260 }}
            placeholder="http://localhost:5173"
            value={webUrl}
            onChange={(e) => setWebUrl(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && webUrl.trim()) {
                useBoard.getState().webNodeAdd(webUrl.trim());
                setMakingWeb(false);
                setWebUrl("");
              }
            }}
          />
          <button
            className="glass-pill"
            style={{ ...buttonStyle, color: "var(--cv-accent)", opacity: webUrl.trim() ? 1 : 0.45 }}
            disabled={!webUrl.trim()}
            onClick={() => {
              useBoard.getState().webNodeAdd(webUrl.trim());
              setMakingWeb(false);
              setWebUrl("");
            }}
          >
            pin
          </button>
          <button className="glass-pill" style={buttonStyle} onClick={() => setMakingWeb(false)}>
            ×
          </button>
        </>
      ) : makingWs ? (
        <>
          <input
            style={{ ...inputStyle, width: 130 }}
            placeholder="workspace name"
            value={wsName}
            onChange={(e) => setWsName(e.target.value)}
            autoFocus
          />
          <input
            style={{ ...inputStyle, width: 220 }}
            placeholder="repo path (~/repos/my-app)"
            value={wsRepo}
            onChange={(e) => setWsRepo(e.target.value)}
          />
          <button
            className="glass-pill"
            style={{ ...buttonStyle, color: "var(--cv-accent)", opacity: wsName.trim() && wsRepo.trim() ? 1 : 0.45 }}
            disabled={!wsName.trim() || !wsRepo.trim()}
            onClick={() => {
              createWorkspace(wsName.trim(), wsRepo.trim());
              setMakingWs(false);
              setWsName("");
              setWsRepo("");
            }}
          >
            create
          </button>
          <button className="glass-pill" style={buttonStyle} onClick={() => setMakingWs(false)}>
            ×
          </button>
        </>
      ) : (
        <>
          <input
            style={{ ...inputStyle, width: 110 }}
            placeholder="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            style={{ ...inputStyle, cursor: "pointer" }}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            title="agent CLI"
          >
            {AGENT_CHOICES.map((c) => (
              <option key={c.cmd} value={c.cmd}>
                {c.label}
              </option>
            ))}
          </select>
          {choice === "custom" && (
            <input
              style={{ ...inputStyle, width: 140 }}
              placeholder="command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              autoFocus
            />
          )}
          <select
            style={{ ...inputStyle, color: wsId ? "var(--cv-ink)" : "var(--cv-ink-dim)", cursor: "pointer" }}
            value={wsId}
            onChange={(e) => setWsId(e.target.value)}
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
          <button
            className="glass-pill"
            style={{ ...buttonStyle, color: "var(--cv-accent)", opacity: (choice !== "custom" || command.trim()) ? 1 : 0.45 }}
            disabled={choice === "custom" && !command.trim()}
            onClick={() => {
              const cmd = choice === "custom" ? command.trim() : choice;
              spawn(name.trim() || cmd, cmd, wsId || undefined, permission, acctId || undefined);
              setName("");
            }}
          >
            + agent
          </button>
          <button
            className="glass-pill"
            style={{ ...buttonStyle, color: "var(--cv-ink-dim)" }}
            onClick={() => setMakingWs(true)}
            title="New workspace"
          >
            ◫+
          </button>
          <button
            className="glass-pill"
            style={{ ...buttonStyle, color: "#7ba3cf" }}
            onClick={() => setMakingWeb(true)}
            title="Pin a live web page (e.g. a localhost dev server) to the canvas"
          >
            ◍+
          </button>
        </>
      )}
    </div>
  );
}
