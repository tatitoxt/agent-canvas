import { useState } from "react";
import { actionBtn } from "./panelChrome";
import { Icon } from "./icons";

/** "Generate PDF" menu — pick a template or ask for anything; the doc is
 * built from live board state, exported as .pdf and saved to artifacts. */
export function GeneratePdfMenu({ onPick, onAsk }: {
  onPick: (kind: "overview" | "onboarding" | "architecture") => void;
  onAsk: (question: string) => void;
}) {
  const [q, setQ] = useState("");
  const rows: { k: "overview" | "onboarding" | "architecture"; icon: string; label: string; hint: string }[] = [
    { k: "overview", icon: "notes", label: "Project overview", hint: "agents, boards, notes — what the board is doing" },
    { k: "onboarding", icon: "play", label: "Onboarding guide", hint: "how to drive this board" },
    { k: "architecture", icon: "artifacts", label: "Architecture", hint: "canvas + daemon + protocol map" },
  ];
  return (
    <div>
      <div style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 400, letterSpacing: "0.02em", color: "var(--cv-ink-faint)", padding: "2px 6px 6px" }}>
        Generate PDF
      </div>
      {rows.map((r) => (
        <button
          key={r.k}
          onClick={() => onPick(r.k)}
          style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%",
            padding: "8px 10px", border: "none", background: "transparent",
            color: "var(--cv-ink)", fontSize: "var(--cv-text-xs)", fontWeight: 500,
            borderRadius: 8, cursor: "pointer", textAlign: "left",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--cv-glass-hi)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Icon name={r.icon} size={15} color="var(--cv-ink-dim)" />
          <div>
            <div>{r.label}</div>
            <div style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-faint)" }}>{r.hint}</div>
          </div>
        </button>
      ))}
      <form
        style={{ display: "flex", gap: 5, padding: "8px 6px 2px", borderTop: "1px solid var(--cv-glass-edge)", marginTop: 4 }}
        onSubmit={(e) => { e.preventDefault(); if (q.trim()) onAsk(q.trim()); }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask for anything…"
          style={{ flex: 1, minWidth: 0, background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 999, padding: "5px 10px", fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink)", outline: "none" }}
        />
        <button type="submit" className="cv-mini-btn" style={{ ...actionBtn, color: "var(--cv-accent)" }} title="Write a PDF about this from the board's state">→</button>
      </form>
    </div>
  );
}
