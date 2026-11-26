import { useState } from "react";
import { useBoard } from "../store/board";
import { Icon } from "./icons";

const inputStyle: React.CSSProperties = {
  background: "var(--cv-glass-hi)",
  border: "1px solid var(--cv-glass-edge)",
  borderRadius: 10,
  padding: "7px 10px",
  fontSize: "var(--cv-text-xs)",
  color: "var(--cv-ink)",
  outline: "none",
};

/** Symvibe's "Spawn 4" team builder — pick roles, one CLI for all,
 * Spawn N lands them as a group on the board. */
const ROLES = [
  { key: "frontend", glyph: "◧", label: "Frontend" },
  { key: "backend", glyph: "◨", label: "Backend" },
  { key: "tester", glyph: "◫", label: "Tester" },
  { key: "reviewer", glyph: "◪", label: "Reviewer" },
  { key: "design", glyph: "◐", label: "Design" },
  { key: "docs", glyph: "▤", label: "Docs" },
  { key: "security", glyph: "◈", label: "Security" },
  { key: "general", glyph: "◆", label: "General" },
];

const CLIS = [
  { cmd: "claude", label: "Claude" },
  { cmd: "codex", label: "Codex" },
  { cmd: "gemini", label: "Gemini" },
  { cmd: "opencode", label: "OpenCode" },
  { cmd: "bash", label: "Shell" },
];

export function TeamBuilder({ onClose }: { onClose: () => void }) {
  const spawn = useBoard((s) => s.spawn);
  const activeBoard = useBoard((s) => s.activeBoard);
  const [roleCounts, setRoleCounts] = useState<Record<string, number>>({});
  const [cli, setCli] = useState("codex");

  const total = Object.values(roleCounts).reduce((a, b) => a + b, 0);
  const bump = (key: string, d: number) =>
    setRoleCounts((rc) => {
      const n = Math.max(0, (rc[key] ?? 0) + d);
      const out = { ...rc };
      if (n === 0) delete out[key];
      else out[key] = n;
      return out;
    });

  const spawnAll = () => {
    for (const [role, n] of Object.entries(roleCounts)) {
      for (let i = 1; i <= n; i++) {
        spawn(`${role}-${i}`, cli);
      }
    }
    onClose();
  };

  return (
    <div
      className="glass-panel"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 84,
        transform: "translateX(-50%)",
        zIndex: 20,
        width: 340,
        padding: "14px 16px",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: "var(--cv-text-xs)", fontWeight: 700, color: "var(--cv-ink)" }}>◨ Team builder</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--cv-ink-dim)", cursor: "pointer", display: "flex", padding: 2 }}><Icon name="ph-x" size={12} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
        {ROLES.map((r) => {
          const n = roleCounts[r.key] ?? 0;
          return (
            <div
              key={r.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 8px",
                borderRadius: 8,
                background: n > 0 ? "var(--cv-glass-hi)" : "transparent",
                border: `1px solid ${n > 0 ? "var(--cv-accent)" : "var(--cv-glass-edge)"}`,
              }}
            >
              <span style={{ color: "var(--cv-accent)", fontSize: "var(--cv-text-xs)" }}>{r.glyph}</span>
              <span style={{ flex: 1, fontSize: "var(--cv-text-xs)", color: "var(--cv-ink)" }}>{r.label}</span>
              <button onClick={() => bump(r.key, -1)} style={{ background: "none", border: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: "var(--cv-text-xs)" }}>−</button>
              <span style={{ fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink)", minWidth: 10, textAlign: "center" }}>{n}</span>
              <button onClick={() => bump(r.key, 1)} style={{ background: "none", border: "none", color: "var(--cv-ink)", cursor: "pointer", fontSize: "var(--cv-text-xs)" }}>+</button>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <select style={{ ...inputStyle, flex: 1, cursor: "pointer" }} value={cli} onChange={(e) => setCli(e.target.value)} title="CLI for every member">
          {CLIS.map((c) => (
            <option key={c.cmd} value={c.cmd}>{c.label}</option>
          ))}
        </select>
        <button
          onClick={spawnAll}
          disabled={total === 0}
          style={{
            background: "var(--cv-accent)",
            border: "none",
            borderRadius: 10,
            padding: "7px 14px",
            fontSize: "var(--cv-text-xs)",
            fontWeight: 700,
            color: "var(--cv-base)",
            cursor: total > 0 ? "pointer" : "default",
            opacity: total > 0 ? 1 : 0.4,
          }}
        >
          Spawn {total || ""}
        </button>
      </div>
      <div style={{ marginTop: 8, fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)" }}>
        Lands on board “{activeBoard}” · each member gets the role as its name
      </div>
    </div>
  );
}
