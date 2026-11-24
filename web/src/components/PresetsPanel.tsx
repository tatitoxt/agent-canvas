import { useState } from "react";
import { panelRoot } from "./panelChrome";
import { useBoard } from "../store/board";

const inputStyle: React.CSSProperties = {
  background: "var(--cv-glass-hi)",
  border: "1px solid var(--cv-glass-edge)",
  borderRadius: 10,
  padding: "7px 10px",
  fontSize: 12,
  color: "var(--cv-ink)",
  outline: "none",
  width: "100%",
};

const btn: React.CSSProperties = {
  background: "var(--cv-glass-hi)",
  border: "1px solid var(--cv-glass-edge)",
  borderRadius: 8,
  padding: "4px 10px",
  fontSize: 11,
  color: "var(--cv-ink)",
  cursor: "pointer",
};

/** Symvibe's "save this board's layout" — capture the live roster +
 * positions as a named preset, restore it later (missing members
 * respawn; live ones snap back to their saved spots). */
export function PresetsPanel() {
  const presets = useBoard((s) => s.presets);
  const activeBoard = useBoard((s) => s.activeBoard);
  const savePreset = useBoard((s) => s.savePreset);
  const applyPreset = useBoard((s) => s.applyPreset);
  const deletePreset = useBoard((s) => s.deletePreset);
  const [name, setName] = useState("");

  const boardPresets = presets[activeBoard] ?? {};
  const names = Object.keys(boardPresets);

  return (
    <div
      style={{ ...panelRoot, padding: "16px 16px" }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--cv-ink)", marginBottom: 4 }}>
        ◫ Layout presets
      </div>
      <div style={{ fontSize: 11, color: "var(--cv-ink-dim)", marginBottom: 14 }}>
        Save this board's roster + arrangement; restore it later — missing members respawn.
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <input
          style={inputStyle}
          placeholder="preset name (e.g. Dev HQ)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              savePreset(name.trim());
              setName("");
            }
          }}
        />
        <button
          style={{ ...btn, color: "var(--cv-accent)", opacity: name.trim() ? 1 : 0.4 }}
          disabled={!name.trim()}
          onClick={() => {
            savePreset(name.trim());
            setName("");
          }}
        >
          save
        </button>
      </div>

      {names.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--cv-ink-dim)" }}>No presets on this board yet.</div>
      )}
      {names.map((n) => {
        const p = boardPresets[n];
        return (
          <div
            key={n}
            style={{
              border: "1px solid var(--cv-glass-edge)",
              borderRadius: 10,
              padding: "9px 10px",
              marginBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "var(--cv-ink)" }}>{n}</span>
              <button style={{ ...btn, color: "var(--cv-accent)" }} onClick={() => applyPreset(n)}>
                apply
              </button>
              <button style={{ ...btn, color: "var(--cv-ink-dim)" }} onClick={() => deletePreset(n)}>
                ×
              </button>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--cv-ink-dim)", marginTop: 4 }}>
              {p.agents.length} member{p.agents.length === 1 ? "" : "s"}
              {p.agents.length > 0 && " · " + p.agents.map((a) => a.name).join(", ")}
            </div>
          </div>
        );
      })}
    </div>
  );
}
