import { useState } from "react";
import { panelRoot } from "./panelChrome";
import { useBoard } from "../store/board";

const input: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  padding: "6px 10px",
  fontSize: "var(--cv-text-xs)",
  color: "var(--cv-ink)",
  outline: "none",
  fontFamily: "inherit",
  marginBottom: 6,
};

const label: React.CSSProperties = {
  fontSize: "var(--cv-text-xxs)",
  fontWeight: 400,
  letterSpacing: "0.02em",
  color: "var(--cv-ink-faint)",
  padding: "10px 12px 4px",
};

/** Symvibe loop templates — one tap fills the form. */
const TEMPLATES: {
  name: string;
  trigger: string;
  interval?: number;
  pattern?: string;
  instruction: string;
}[] = [
  { name: "Progress check", trigger: "interval", interval: 15, instruction: "Post a one-line status: what you did, what's next, anything blocking you." },
  { name: "Keep them moving", trigger: "idle", instruction: "Pick up the next task from the board's notes and keep going." },
  { name: "Build rescue", trigger: "match", pattern: "FAILED", instruction: "Stop what you're doing and fix the failure that just printed." },
  { name: "Test watchdog", trigger: "interval", interval: 30, instruction: "Run the test suite. If anything fails, fix it before continuing." },
  { name: "Commit checkpoint", trigger: "interval", interval: 20, instruction: "Commit your work-in-progress with a clear message." },
  { name: "Review sweep", trigger: "interval", interval: 45, instruction: "Re-read the files you changed this session and flag anything unfinished or broken." },
  { name: "Hourly standup", trigger: "interval", interval: 60, instruction: "Write a two-line standup: done / doing / blocked." },
];

/** Loops — put your agents on autopilot: a saved instruction the daemon
 * re-sends on an interval, when the agent goes idle, or the moment its
 * output matches a pattern. (Symvibe's loops panel.) */
export function LoopsPanel() {
  const loops = useBoard((s) => s.loops);
  const agents = useBoard((s) => s.agents);
  const activeBoard = useBoard((s) => s.activeBoard);
  const boards = useBoard((s) => s.boards);
  const createLoop = useBoard((s) => s.createLoop);
  const deleteLoop = useBoard((s) => s.deleteLoop);
  const runLoop = useBoard((s) => s.runLoop);
  const setLoopEnabled = useBoard((s) => s.setLoopEnabled);

  const [creating, setCreating] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [target, setTarget] = useState("*");
  const [trigger, setTrigger] = useState("interval");
  const [everyMins, setEveryMins] = useState("15");
  const [pattern, setPattern] = useState("");

  const boardAgents = Object.values(agents).filter((a) => (a.board_id ?? "main") === activeBoard);
  const list = Object.values(loops).filter((l) => l.board_id === activeBoard);

  const agentName = (id: string) => (id === "*" ? "every agent" : agents[id]?.name ?? id.slice(0, 8));

  const save = () => {
    if (!instruction.trim()) return;
    createLoop({
      board_id: activeBoard,
      target,
      instruction: instruction.trim(),
      trigger,
      interval_secs: trigger === "interval" ? (parseInt(everyMins, 10) || 15) * 60 : undefined,
      pattern: trigger === "match" ? pattern.trim() || undefined : undefined,
    });
    setInstruction("");
    setPattern("");
    setCreating(false);
  };

  const apply = (t: (typeof TEMPLATES)[number]) => {
    setInstruction(t.instruction);
    setTrigger(t.trigger);
    if (t.interval) setEveryMins(String(t.interval));
    if (t.pattern) setPattern(t.pattern);
    setCreating(true);
  };

  return (
    <div
      data-panel="loops"
      style={{ ...panelRoot, padding: "12px 10px" }}
    >
      <div
        style={{
          padding: "0 12px 8px",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <button
          className="cv-mini-btn"
          style={{ padding: "3px 11px", color: "var(--cv-accent)" }}
          onClick={() => setCreating((c) => !c)}
        >
          {creating ? "cancel" : "+ new"}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!creating && (
          <>
            <div style={{ padding: "6px 12px 2px", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", lineHeight: 1.5 }}>
              A loop sends one instruction to your consoles — on a timer, when an
              agent goes idle, or the moment its output prints something you care
              about. Board: <b style={{ color: "var(--cv-ink)" }}>{boards[activeBoard] ?? activeBoard}</b>.
            </div>
            <div style={label}>Start from a template</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "4px 12px 8px" }}>
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  className="cv-mini-btn"
                  style={{ padding: "3px 9px", color: "var(--cv-ink-dim)" }}
                  onClick={() => apply(t)}
                >
                  {t.name}
                </button>
              ))}
              <button
                className="cv-mini-btn"
                style={{ padding: "3px 9px", color: "var(--cv-accent)" }}
                onClick={() => { setInstruction(""); setTrigger("interval"); setCreating(true); }}
              >
                Start from scratch
              </button>
            </div>
          </>
        )}
        {creating && (
          <div style={{ padding: "4px 8px 10px" }}>
            <textarea
              style={{ ...input, minHeight: 56, resize: "vertical" }}
              placeholder="the instruction the agent receives"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <select style={input} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="*">every agent on this board</option>
              {boardAgents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <select style={input} value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              <option value="interval">on a timer</option>
              <option value="idle">when the agent goes idle</option>
              <option value="match">when its output matches</option>
            </select>
            {trigger === "interval" && (
              <input
                style={input}
                type="number"
                min={1}
                placeholder="every N minutes"
                value={everyMins}
                onChange={(e) => setEveryMins(e.target.value)}
              />
            )}
            {trigger === "match" && (
              <input
                style={input}
                placeholder='text to watch for — e.g. "FAILED" or "DO YOU WANT"'
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
              />
            )}
            <button
              className="cv-mini-btn"
              style={{ padding: "5px 14px", color: "var(--cv-done)" }}
              onClick={save}
            >
              start loop
            </button>
          </div>
        )}
        {list.length === 0 && !creating && (
          <div style={{ padding: "14px 12px", fontSize: "var(--cv-text-xs)", color: "var(--cv-ink-faint)" }}>
            No loops on this board yet.
          </div>
        )}
        {list.length > 0 && <div style={label}>Running on this board</div>}
        {list.map((l) => (
          <div key={l.loop_id} style={{ padding: "9px 12px", borderRadius: 10, marginBottom: 2, opacity: l.enabled ? 1 : 0.5 }}>
            <div
              style={{
                fontSize: "var(--cv-text-xxs)",
                color: "var(--cv-ink)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
              title={l.instruction}
            >
              {l.instruction}
            </div>
            <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", marginTop: 3 }}>
              → {agentName(l.target)} ·{" "}
              {l.trigger === "interval"
                ? `every ${Math.round((l.interval_secs ?? 0) / 60)}m`
                : l.trigger === "idle"
                  ? "when idle"
                  : `on "${l.pattern}"`}
              {l.last_fired_at ? ` · fired ${l.last_fired_at.slice(0, 16)}` : " · never fired"}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                className="cv-mini-btn"
                style={{ padding: "2px 12px", color: l.enabled ? "var(--cv-waiting)" : "var(--cv-done)" }}
                onClick={() => setLoopEnabled(l.loop_id, !l.enabled)}
              >
                {l.enabled ? "pause" : "resume"}
              </button>
              <button
                className="cv-mini-btn"
                title="run it once right now"
                style={{ padding: "2px 12px", color: "var(--cv-accent)" }}
                onClick={() => runLoop(l.loop_id)}
              >
                run now
              </button>
              <button
                className="cv-mini-btn"
                style={{ padding: "2px 12px", color: "var(--cv-blocked)" }}
                onClick={() => deleteLoop(l.loop_id)}
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
