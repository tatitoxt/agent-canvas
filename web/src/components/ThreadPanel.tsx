import { useEffect, useRef } from "react";
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
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {log.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--cv-ink-dim)" }}>
            Try “spawn two bash”, “pause all”, “focus Terminal 1”, “status”…
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
    </div>
  );
}
