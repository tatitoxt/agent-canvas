import { useEffect, useMemo, useRef, useState } from "react";
import { useBoard } from "../store/board";

// ANSI escape sequences stripped for display + matching.
const ansi = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
const clean = (s: string) => s.replace(ansi, " ").replace(/\s+/g, " ").trim();

/** ⌘F on-device search across every agent's PTY scrollback — Deska's
 * "find anything in your panels" without the 30MB model. */
export function SearchPanel({
  onClose,
  onOpenAgent,
}: {
  onClose: () => void;
  onOpenAgent: (id: string, name: string) => void;
}) {
  const agents = useBoard((s) => s.agents);
  const ptyBuffers = useBoard((s) => s.ptyBuffers);
  const activityLines = useBoard((s) => s.activityLines);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Array<{ id: string; name: string; status: string; snippet: string }> = [];
    for (const a of Object.values(agents)) {
      const buf = ptyBuffers[a.id];
      const text = buf ? clean(new TextDecoder().decode(buf)) : "";
      const at = text.toLowerCase().indexOf(q);
      if (at === -1 && !a.name.toLowerCase().includes(q) && !((activityLines[a.id] ?? a.lastLine) ?? "").toLowerCase().includes(q)) {
        continue;
      }
      const snippet =
        at === -1
          ? ((activityLines[a.id] ?? a.lastLine) ?? "")
          : `…${text.slice(Math.max(0, at - 60), at + 90)}…`;
      out.push({ id: a.id, name: a.name, status: a.status, snippet });
    }
    return out;
  }, [query, ptyBuffers, agents, activityLines]);

  return (
    <div
      style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(10,10,12,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="glass"
        style={{
          position: "absolute",
          top: "18%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 520,
          maxHeight: 440,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder="search agent transcripts…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && results[0]) {
              onOpenAgent(results[0].id, results[0].name);
              onClose();
            }
          }}
          style={{
            background: "transparent",
            border: "none",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            padding: "13px 16px",
            fontSize: "var(--cv-text-md)",
            color: "var(--cv-ink)",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        <div style={{ overflowY: "auto", padding: "6px" }}>
          {query.trim() && results.length === 0 && (
            <div style={{ padding: "16px 14px", fontSize: "var(--cv-text-xs)", color: "var(--cv-ink-dim)" }}>
              no matches in live transcripts
            </div>
          )}
          {!query.trim() && (
            <div style={{ padding: "16px 14px", fontSize: "var(--cv-text-xs)", color: "var(--cv-ink-dim)" }}>
              searches the last ~64KB of every agent's terminal — all local, nothing leaves this machine
            </div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                onOpenAgent(r.id, r.name);
                onClose();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderRadius: 8,
                padding: "8px 12px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div style={{ fontSize: "var(--cv-text-sm)", fontWeight: 600, color: "var(--cv-ink)" }}>
                {r.name}
                <span style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)", marginLeft: 8 }}>{r.status}</span>
              </div>
              <div
                style={{
                  fontSize: "var(--cv-text-xxs)",
                  color: "var(--cv-ink-dim)",
                  fontFamily: "var(--cv-font-mono)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.snippet}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
