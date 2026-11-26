import { useState } from "react";

/** One-click starting points — Deska's botoneable automation examples. */
const PRESETS = [
  { name: "morning digest", prompt: "Summarize what changed in this repo since yesterday and what is worth my attention today", mins: 1440 },
  { name: "hourly PR check", prompt: "Check the repo's open pull requests and report any that are waiting on me", mins: 60 },
  { name: "water break", prompt: "Post a short reminder to drink water and stretch", mins: 60 },
];

import { panelRoot } from "./panelChrome";
import { useBoard, PERMISSION_LEVELS, type Guardrails } from "../store/board";

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
  padding: "10px 12px 4px",
};

const AGENT_COMMANDS = ["claude", "codex", "gemini", "aider", "bash"];

const GUARDRAIL_ROWS: Array<{ key: keyof Guardrails; label: string; options: Array<[string, string]> }> = [
  { key: "waitForAnswer", label: "Wait for my answer", options: [["15m", "15m"], ["1h", "1h"], ["4h", "4h"], ["forever", "forever"]] },
  { key: "onNoAnswer", label: "If I do not answer", options: [["safest", "choose safest"], ["stop", "stop"], ["proceed", "proceed anyway"]] },
  { key: "onNotAllowed", label: "If a command is not allowed", options: [["ask", "ask me"], ["deny", "deny"]] },
  { key: "unresponsiveAfter", label: "If it stops responding", options: [["15m", "after 15m"], ["30m", "after 30m"], ["1h", "after 1h"]] },
  { key: "unresponsiveAction", label: "…then", options: [["takeover", "the next agent takes over"], ["stop", "stop"]] },
  { key: "onRunCollision", label: "If run-time collides", options: [["queue", "queue for later"], ["skip", "skip"]] },
  { key: "onComputerOff", label: "If the computer was off", options: [["run-once", "run once on return"], ["skip", "skip"]] },
];

const select: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 7,
  padding: "3px 6px",
  fontSize: 10.5,
  color: "var(--cv-ink)",
  outline: "none",
  fontFamily: "inherit",
};

/** Deska-style automations: saved tasks that run an agent with guardrails —
 * an idle hang limit and a policy for gated commands (hold vs auto-deny). */
export function AutomationsPanel() {
  const onBoard = useBoard((s) => !!s.panelNodes[s.activeBoard]?.["panel-automations"]);
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
  const [guardOpen, setGuardOpen] = useState(false);
  const guardrails = useBoard((s) => s.guardrails);
  const guardrailOverrides = useBoard((s) => s.guardrailOverrides);
  const setGuardrails = useBoard((s) => s.setGuardrails);
  const setGuardrailOverride = useBoard((s) => s.setGuardrailOverride);

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
    setEveryMins("");
    setCreating(false);
  };

  return (
    <div
      data-panel="automations"
      style={{ ...panelRoot, padding: "12px 10px" }}
    >
      <div
        style={{
          padding: "0 12px 8px",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <button
          className="cv-mini-btn"
          title="automation guardrails — global policy for automated runs"
          style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 9px", color: guardOpen ? "var(--cv-accent)" : "var(--cv-ink-dim)" }}
          onClick={() => setGuardOpen((g) => !g)}
        >
          ⚙
        </button>
        <button
          className="cv-mini-btn cv-canvas-jump"
          title="Show this live Automations window on the canvas"
          style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 8px", color: "var(--cv-ink-dim)" }}
          onClick={() => {
            if (!onBoard) useBoard.getState().openPanelNode("automations");
            useBoard.getState().requestFocus("panel-automations");
            useBoard.getState().requestNav("canvas");
          }}
        >
          {onBoard ? "Open on canvas" : "+ Add to canvas"}
        </button>
        <button
          className="cv-mini-btn"
          style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 11px", color: "var(--cv-accent)" }}
          onClick={() => setCreating((c) => !c)}
        >
          {creating ? "cancel" : "+ new"}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {guardOpen && (
          <div style={{ padding: "2px 12px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", marginBottom: 6 }}>
            <div className="cv-section-label" style={{ paddingBottom: 6 }}>
              Guardrails — applies unless a run overrides
            </div>
            {GUARDRAIL_ROWS.map((r) => (
              <div key={r.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "3px 0" }}>
                <span style={{ fontSize: 10.5, color: "var(--cv-ink-dim)", flex: 1 }}>{r.label}</span>
                <select
                  style={select}
                  value={guardrails[r.key]}
                  onChange={(e) => setGuardrails({ [r.key]: e.target.value } as Partial<Guardrails>)}
                >
                  {r.options.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
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
              {PERMISSION_LEVELS.map((p) => (
                <option key={p.id} value={p.id}>{p.label} — {p.hint}</option>
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
              className="cv-mini-btn"
              style={{ fontSize: 11, fontWeight: 600, padding: "5px 14px", cursor: "pointer", color: "var(--cv-done)" }}
              onClick={save}
            >
              save automation
            </button>
          </div>
        )}
        {list.length === 0 && !creating && (
          <div style={{ padding: "14px 12px", fontSize: 11.5, color: "var(--cv-ink-dim)" }}>
            <div style={{ marginBottom: 8 }}>Nothing saved yet — start from an example:</div>
            {PRESETS.map((p) => (
              <button
                key={p.name}
                className="cv-mini-btn"
                style={{ display: "block", width: "100%", textAlign: "left", margin: "0 0 6px", padding: "7px 10px", fontSize: 11.5, cursor: "pointer", color: "var(--cv-ink)" }}
                onClick={() => {
                  setName(p.name);
                  setPrompt(p.prompt);
                  setEveryMins(String(p.mins));
                  setCreating(true);
                }}
              >
                {p.name}
                <span style={{ display: "block", fontSize: 10, color: "var(--cv-ink-dim)", marginTop: 2 }}>{p.prompt.slice(0, 64)}…</span>
              </button>
            ))}
          </div>
        )}
        {list.length > 0 && <div className="cv-section-label" style={label}>Saved</div>}
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
                className="cv-mini-btn"
                title={guardrailOverrides[a.id] ? "this run uses its own settings, not the global guardrails" : "follows the global guardrails — click to let this run keep its own settings"}
                style={{ fontSize: 10, fontWeight: 600, padding: "2px 10px", cursor: "pointer", color: guardrailOverrides[a.id] ? "var(--cv-accent)" : "var(--cv-ink-faint)" }}
                onClick={() => setGuardrailOverride(a.id, !guardrailOverrides[a.id])}
              >
                {guardrailOverrides[a.id] ? "override: on" : "override"}
              </button>
              <button
                className="cv-mini-btn"
                style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 12px", cursor: "pointer", color: "var(--cv-done)" }}
                onClick={() => runAutomation(a.id)}
              >
                run
              </button>
              <button
                className="cv-mini-btn"
                style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 12px", cursor: "pointer", color: "var(--cv-blocked)" }}
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
