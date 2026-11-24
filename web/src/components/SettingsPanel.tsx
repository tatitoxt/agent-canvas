import { useBoard } from "../store/board";

const THEMES = [
  { key: "obsidian", label: "Obsidian", sw: "#0e0e10" },
  { key: "sepia", label: "Sepia", sw: "#14110d" },
  { key: "paper", label: "Paper", sw: "#ece8e1" },
] as const;

/** App settings — theme picker today (the tokens derive all glass). */
export function SettingsPanel() {
  const theme = useBoard((s) => s.theme);
  const setTheme = useBoard((s) => s.setTheme);
  return (
    <div
      className="glass"
      style={{
        position: "absolute",
        left: 64,
        top: 64,
        width: 300,
        zIndex: 19,
        padding: "12px 10px",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 650, padding: "0 12px 10px", color: "var(--cv-ink)" }}>
        Settings
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--cv-ink-dim)", padding: "0 12px 6px", textTransform: "uppercase", letterSpacing: 0.6 }}>
        Theme
      </div>
      <div style={{ display: "flex", gap: 8, padding: "0 12px 8px" }}>
        {THEMES.map((t) => (
          <button
            key={t.key}
            onClick={() => setTheme(t.key)}
            className="glass"
            style={{
              flex: 1,
              padding: "8px 6px",
              border: "none",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              outline: theme === t.key ? "1.5px solid var(--cv-accent)" : "none",
            }}
          >
            <span style={{ width: 26, height: 26, borderRadius: 8, background: t.sw, border: "1px solid var(--cv-glass-edge)" }} />
            <span style={{ fontSize: 10.5, color: "var(--cv-ink)" }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
