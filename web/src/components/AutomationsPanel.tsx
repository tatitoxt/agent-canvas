import { useState } from "react";
import { useBoard } from "../store/board";

const input: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  padding: "6px 10px",
  fontSize: 11.5,
  color: "var(--cv-ink)",
  outline: "none",
  fontFamily: "inherit",
  marginBottom: 6,
};

const label: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  color: "var(--cv-ink-faint)",
  padding: "10px 12px 4px",
};

const AGENT_COMMANDS = ["claude", "codex", "gemini", "aider", "bash"];
const PERMISSIONS = ["supervised", "auto_accept", "auto", "full"];

/** Deska-style automations: saved tasks that run an agent with guardrails —
 * an idle hang limit and a policy for gated commands (hold vs auto-deny). */
export function AutomationsPanel() {
  const automations = useBoard((s) => s.automations);
  const workspaces = useBoard((s) => s.workspaces);
  const createAutomation = useBoard((s) => s.createAutomation);
  const runAutomation = useBoard((s) => s.runAutomation);
  const deleteAutomation = useBoard((s) => s.deleteAutomation);

  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [command, setCommand] = useState("claude");
  const [permission, setPermission] = useState("auto");
  const [idleSecs, setIdleSecs] = useState("300");
  const [onApproval, setOnApproval] = useState("hold");
  const [everyMins, setEveryMins] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [creating, setCreating] = useState(false);

  const wsList = Object.values(workspaces);
  const list = Object.values(automations);

  const save = () => {
    if (!name.trim() || !prompt.trim()) return;
    createAutomation({
      name: name.trim(),
      prompt: prompt.trim(),
      command,
      permission,
      idle_secs: parseInt(idleSecs, 10) || 300,
      on_approval: onApproval,
      workspace_id: workspaceId || undefined,
      interval_secs: (parseInt(everyMins, 10) || 0) * 60 || undefined,
    });
    setName("");
    setPrompt("");
    setCreating(false);
  };

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
        Automations
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
          <div style={{ padding: "4px 8px 10px" }}>
            <input style={input} placeholder="name — e.g. nightly audit" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea
              style={{ ...input, minHeight: 56, resize: "vertical" }}
              placeholder="prompt the agent receives on run"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <select style={input} value={command} onChange={(e) => setCommand(e.target.value)}>
              {AGENT_COMMANDS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {wsList.length > 0 && (
              <select style={input} value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                <option value="">board repo</option>
                {wsList.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            )}
            <select style={input} value={permission} onChange={(e) => setPermission(e.target.value)}>
              {PERMISSIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input
              style={input}
              type="number"
              min={10}
              placeholder="hang limit (seconds of silence)"
              value={idleSecs}
              onChange={(e) => setIdleSecs(e.target.value)}
            />
            <select style={input} value={onApproval} onChange={(e) => setOnApproval(e.target.value)}>
              <option value="hold">on gated input: hold for me</option>
              <option value="deny">on gated input: auto-deny</option>
            </select>
            <input
              style={input}
              type="number"
              min={0}
              placeholder="repeat every N minutes (empty = manual)"
              value={everyMins}
              onChange={(e) => setEveryMins(e.target.value)}
            />
            <button
              className="glass-pill"
              style={{ fontSize: 11, fontWeight: 600, padding: "5px 14px", cursor: "pointer", border: "none", color: "var(--cv-done)" }}
              onClick={save}
            >
              save automation
            </button>
          </div>
        )}
        {list.length === 0 && !creating && (
          <div style={{ padding: "18px 12px", fontSize: 11.5, color: "var(--cv-ink-dim)" }}>
            No automations yet — save a recurring task and run it on demand.
          </div>
        )}
        {list.length > 0 && <div style={label}>saved</div>}
        {list.map((a) => (
          <div
            key={a.id}
            style={{ padding: "9px 12px", borderRadius: 10, marginBottom: 2 }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--cv-ink)" }}>{a.name}</div>
            <div
              style={{
                fontSize: 11,
                color: "var(--cv-ink-dim)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={a.prompt}
            >
              {a.prompt}
            </div>
            <div style={{ fontSize: 10, color: "var(--cv-ink-faint)", marginTop: 2 }}>
              {a.command} · {a.permission} · hang {a.idle_secs}s · gated: {a.on_approval}
              {a.interval_secs ? ` · every ${Math.round(a.interval_secs / 60)}m` : ""}
              {a.last_run_at ? ` · ran ${a.last_run_at.slice(0, 16)}` : " · never ran"}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                className="glass-pill"
                style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 12px", cursor: "pointer", border: "none", color: "var(--cv-done)" }}
                onClick={() => runAutomation(a.id)}
              >
                run
              </button>
              <button
                className="glass-pill"
                style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 12px", cursor: "pointer", border: "none", color: "var(--cv-blocked)" }}
                onClick={() => deleteAutomation(a.id)}
              >
                delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
