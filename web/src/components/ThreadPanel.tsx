import { useEffect, useRef, useState } from "react";
import { useBoard } from "../store/board";

const inputStyle: React.CSSProperties = {
  background: "var(--cv-glass-hi)",
  border: "1px solid var(--cv-glass-edge)",
  borderRadius: 999,
  padding: "7px 14px",
  fontSize: 12,
  color: "var(--cv-ink)",
  outline: "none",
  width: "100%",
};

const CHIPS = [
  "kill all",
  "pause all",
  "show me the whole board",
  "spawn two bash",
];

/** Symvibe's THREAD — the built-in assistant that commands the board.
 * Deterministic intents today (spawn/kill/pause/preset/open/fit/
 * digest + quick commands); an LLM layer can sit behind threadSend
 * later without changing the UI. */
export function ThreadPanel() {
  const log = useBoard((s) => s.threadLog);
  const send = useBoard((s) => s.threadSend);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log.length]);

  const submit = (v: string) => {
    if (!v.trim()) return;
    send(v);
    setText("");
  };

  return (
    <div
      className="glass-panel"
      style={{
        position: "absolute",
        left: 64,
        top: 64,
        bottom: 64,
        width: 330,
        zIndex: 19,
        padding: "16px 16px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--cv-ink)", marginBottom: 4 }}>
        ⧉ THREAD
      </div>
      <div style={{ fontSize: 11, color: "var(--cv-ink-dim)", marginBottom: 12 }}>
        I command your agents, move the board and open its tools.
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {log.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--cv-ink-dim)" }}>
            Try “spawn two bash”, “pause all”, “apply preset Dev HQ”, “open loops”…
          </div>
        )}
        {log.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "you" ? "flex-end" : "flex-start",
              maxWidth: "88%",
              background: m.role === "you" ? "var(--cv-glass-hi)" : "transparent",
              border: `1px solid ${m.role === "you" ? "var(--cv-glass-edge)" : "transparent"}`,
              borderRadius: 10,
              padding: "5px 10px",
              fontSize: 11.5,
              color: m.role === "you" ? "var(--cv-ink)" : "var(--cv-accent)",
            }}
          >
            {m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        {CHIPS.map((c) => (
          <button
            key={c}
            onClick={() => submit(c)}
            style={{
              background: "var(--cv-glass-hi)",
              border: "1px solid var(--cv-glass-edge)",
              borderRadius: 999,
              padding: "3px 10px",
              fontSize: 10.5,
              color: "var(--cv-ink-dim)",
              cursor: "pointer",
            }}
          >
            {c}
          </button>
        ))}
      </div>

      <input
        style={inputStyle}
        placeholder="command the board…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit(text)}
        autoFocus
      />
    </div>
  );
}
