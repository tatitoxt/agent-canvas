import { useEffect, useRef } from "react";
import { panelRoot } from "./panelChrome";
import { useBoard } from "../store/board";

/** The Dex conversation — log only. Input lives in the Dex pill at
 * the bottom-center of the canvas. */
export function ThreadPanel() {
  const log = useBoard((s) => s.threadLog);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log.length]);

  return (
    <div
      style={{ ...panelRoot, padding: "16px 16px" }}
    >
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {log.length === 0 && (
          <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)" }}>
            Try “spawn two bash”, “pause all”, “focus Terminal 1”, “status”…
          </div>
        )}
        {log.map((m, i) => (
          <div
            key={i}
            title={m.agentId ? "focus this agent" : undefined}
            onClick={m.agentId ? () => useBoard.getState().requestFocus(m.agentId!) : undefined}
            style={{
              alignSelf: m.role === "you" ? "flex-end" : "flex-start",
              maxWidth: "88%",
              background: m.role === "you" ? "var(--cv-glass-hi)" : "transparent",
              border: `1px solid ${m.role === "you" ? "var(--cv-glass-edge)" : "transparent"}`,
              borderRadius: 10,
              padding: "5px 10px",
              fontSize: "var(--cv-text-xs)",
              cursor: m.agentId ? "pointer" : "default",
              textDecoration: m.agentId ? "underline" : "none",
              textDecorationStyle: "dotted",
              textUnderlineOffset: 3,
              color: m.role === "you" ? "var(--cv-ink)" : "var(--cv-accent)",
            }}
          >
            {m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
