import { useState } from "react";
import { panelRoot } from "./panelChrome";
import { useBoard } from "../store/board";

const THEMES = [
  { key: "obsidian", label: "Obsidian", sw: "#0e0e10" },
  { key: "sepia", label: "Sepia", sw: "#14110d" },
  { key: "paper", label: "Paper", sw: "#ece8e1" },
] as const;

const SHORTCUTS: [string, string][] = [
  ["f", "fit the board to view"],
  ["1", "zoom to 100%"],
  ["t", "gather loose windows into a group"],
  ["Ctrl+Z", "undo the last card move"],
  ["Ctrl+`", "pop terminal out / put back"],
  ["?", "command palette"],
  ["Del", "close the selected cards"],
  ["right-click", "context menu — spawn, add panels"],
];

const label: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "var(--cv-ink-dim)",
  padding: "8px 12px 6px",
  textTransform: "uppercase",
  letterSpacing: 0.6,
};

const rowBtn: React.CSSProperties = {
  flex: 1,
  padding: "7px 6px",
  border: "none",
  cursor: "pointer",
  fontSize: 10.5,
  color: "var(--cv-ink)",
};

/** App settings — theme, terminal font, OS notifications, canvas
 * housekeeping, daemon link and a keyboard cheat-sheet. */
export function SettingsPanel() {
  const theme = useBoard((s) => s.theme);
  const setTheme = useBoard((s) => s.setTheme);
  const termFont = useBoard((s) => s.termFont);
  const bumpFont = useBoard((s) => s.bumpFont);
  const connected = useBoard((s) => s.connected);
  const connect = useBoard((s) => s.connect);
  const clearDone = useBoard((s) => s.clearDone);
  const undoMove = useBoard((s) => s.undoMove);
  const moveHistory = useBoard((s) => s.moveHistory);
  const panelSummaries = useBoard((s) => s.panelSummaries);
  const togglePanelSummaries = useBoard((s) => s.togglePanelSummaries);
  const vaultDir = useBoard((s) => s.vaultDir);
  const supported = typeof Notification !== "undefined";
  const [perm, setPerm] = useState<NotificationPermission>(supported ? Notification.permission : "denied");
  const [cleared, setCleared] = useState<number | null>(null);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  return (
    <div
      style={{ ...panelRoot, padding: "12px 10px", overflow: "hidden" }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 650, padding: "0 12px 10px", color: "var(--cv-ink)", flexShrink: 0 }}>
        Settings
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--cv-ink-dim)", padding: "0 12px 6px", textTransform: "uppercase", letterSpacing: 0.6 }}>
        Theme
      </div>
      <div style={{ display: "flex", gap: 8, padding: "0 12px 8px" }}>
        {THEMES.map((t) => (
          <button
            key={t.key}
            aria-pressed={theme === t.key}
            aria-label={`Use ${t.label} theme`}
            title={`Use ${t.label} theme`}
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
      <div style={label}>Terminal font</div>
      <div style={{ padding: "0 12px 8px", display: "flex", alignItems: "center", gap: 8 }}>
        <button aria-label="Decrease terminal font" className="glass" style={{ ...rowBtn, flex: 0, padding: "7px 14px" }} onClick={() => bumpFont(-1)} disabled={termFont <= 9}>−</button>
        <span role="status" aria-label={`Terminal font ${termFont} pixels`} style={{ flex: 1, textAlign: "center", fontSize: 11, color: "var(--cv-ink)" }}>{termFont}px</span>
        <button aria-label="Increase terminal font" className="glass" style={{ ...rowBtn, flex: 0, padding: "7px 14px" }} onClick={() => bumpFont(1)} disabled={termFont >= 22}>+</button>
      </div>
      <div style={label}>Canvas</div>
      <div style={{ padding: "0 12px 8px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, fontSize: 10.5, color: "var(--cv-ink-dim)" }}>card summaries under titles</span>
        <button
          aria-label={`Card summaries ${panelSummaries ? "on" : "off"}`}
          aria-pressed={panelSummaries}
          className="glass"
          style={{ ...rowBtn, flex: 0, padding: "7px 12px", outline: panelSummaries ? "1.5px solid var(--cv-accent)" : "none" }}
          onClick={() => togglePanelSummaries()}
        >
          {panelSummaries ? "on" : "off"}
        </button>
      </div>
      <div style={label}>Vault</div>
      <div style={{ padding: "0 12px 8px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, fontSize: 10.5, color: "var(--cv-ink-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={vaultDir || "no vault mounted"}>
          {vaultDir || "no vault mounted — use the vault panel"}
        </span>
      </div>
      <div style={label}>Daemon</div>
      <div style={{ padding: "0 12px 8px", display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 99,
            background: connected ? "var(--cv-working)" : "var(--cv-blocked)",
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1, fontSize: 10.5, color: "var(--cv-ink-dim)" }}>
          {connected ? "connected — canvasd is driving agents" : "offline — agents can't spawn"}
        </span>
        {!connected && (
          <button className="glass" style={{ ...rowBtn, flex: 0, padding: "7px 12px" }} onClick={() => connect("")}>
            retry
          </button>
        )}
      </div>
      <div style={label}>Canvas</div>
      <div style={{ padding: "0 12px 8px", display: "flex", gap: 8 }}>
        <button
          aria-label="Clear exited agents"
          className="glass"
          style={rowBtn}
          onClick={() => setCleared(clearDone())}
        >
          {cleared == null ? "clear exited agents" : cleared > 0 ? `cleared ${cleared} exited` : "no exited agents"}
        </button>
        <button
          className="glass"
          style={{ ...rowBtn, opacity: moveHistory.length ? 1 : 0.45 }}
          disabled={!moveHistory.length}
          onClick={() => undoMove()}
        >
          undo move{moveHistory.length ? ` (${moveHistory.length})` : ""}
        </button>
      </div>
      <div style={label}>Keyboard</div>
      <div style={{ padding: "0 12px 8px", display: "flex", flexDirection: "column", gap: 3 }}>
        {SHORTCUTS.map(([k, what]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                minWidth: 52,
                textAlign: "center",
                padding: "2px 6px",
                borderRadius: 5,
                background: "var(--cv-glass-hi)",
                border: "1px solid var(--cv-glass-edge)",
                fontSize: 9.5,
                fontWeight: 650,
                color: "var(--cv-ink)",
                fontFamily: "var(--cv-mono, monospace)",
              }}
            >
              {k}
            </span>
            <span style={{ fontSize: 10, color: "var(--cv-ink-dim)" }}>{what}</span>
          </div>
        ))}
      </div>
      <div style={label}>Notifications
      </div>
      <div style={{ padding: "0 12px 8px", display: "flex", alignItems: "center", gap: 8 }}>
        <button
          disabled={!supported || perm === "denied"}
          onClick={async () => {
            const p = await Notification.requestPermission();
            setPerm(p);
          }}
          className="glass"
          style={{
            flex: 1,
            padding: "7px 6px",
            border: "none",
            cursor: supported && perm !== "denied" ? "pointer" : "default",
            fontSize: 10.5,
            color: "var(--cv-ink)",
            opacity: !supported || perm === "denied" ? 0.5 : 1,
          }}
        >
          {!supported
            ? "not supported here"
            : perm === "granted"
              ? "on — approvals & returns alert you"
              : perm === "denied"
                ? "blocked in browser"
                : "enable alerts"}
        </button>
      </div>
      <div style={{ fontSize: 9.5, color: "var(--cv-ink-dim)", padding: "0 12px 6px", lineHeight: 1.4 }}>
        Pings you when an agent needs approval or a delegation returns — only while this tab is in the background.
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--cv-ink-dim)", padding: "8px 12px 6px", textTransform: "uppercase", letterSpacing: 0.6 }}>
        Board data
      </div>
      <div style={{ padding: "0 12px 8px", display: "flex", gap: 8 }}>
        <button
          aria-label="Export board settings as JSON"
          onClick={() => {
            const data: Record<string, string> = {};
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k?.startsWith("cv-")) data[k] = localStorage.getItem(k) ?? "";
            }
            const blob = new Blob([JSON.stringify({ app: "agent-canvas", v: 1, data }, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "canvas-export.json";
            a.click();
            window.setTimeout(() => URL.revokeObjectURL(a.href), 0);
          }}
          className="glass"
          style={{ flex: 1, padding: "7px 6px", border: "none", cursor: "pointer", fontSize: 10.5, color: "var(--cv-ink)" }}
        >
          export json
        </button>
        <label
          className="glass"
          style={{ flex: 1, padding: "7px 6px", fontSize: 10.5, color: "var(--cv-ink)", textAlign: "center", cursor: "pointer" }}
        >
          import json
          <input
            aria-label="Import board settings JSON"
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const input = e.currentTarget;
              void f.text().then((t) => {
                try {
                  const j: unknown = JSON.parse(t);
                  if (!j || typeof j !== "object" || (j as { app?: unknown }).app !== "agent-canvas" || ![1, 2].includes((j as { v?: number }).v ?? -1)) {
                    throw new Error("This file is not a supported Agent Canvas export.");
                  }
                  const data = (j as { data?: unknown }).data;
                  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The export is missing its settings data.");
                  const entries = Object.entries(data as Record<string, unknown>);
                  if (entries.some(([k, v]) => !k.startsWith("cv-") || typeof v !== "string")) throw new Error("The export contains invalid settings.");
                  for (const [k, v] of entries) localStorage.setItem(k, v as string);
                  setImportFeedback(`Imported ${entries.length} settings. Reloading…`);
                  location.reload();
                } catch (error) {
                  setImportFeedback(error instanceof Error ? error.message : "Could not read this settings file.");
                  input.value = "";
                }
              }).catch(() => setImportFeedback("Could not read this settings file."));
            }}
          />
        </label>
      </div>
      {importFeedback && <div role="status" style={{ fontSize: 10, color: "var(--cv-accent)", padding: "0 12px 6px" }}>{importFeedback}</div>}
      <div style={{ fontSize: 9.5, color: "var(--cv-ink-dim)", padding: "0 12px 6px", lineHeight: 1.4 }}>
        Carries your presets, shapes, notes, thread and theme between machines — canvas layouts live in the daemon's .canvas/board.db.
      </div>
      </div>
    </div>
  );
}
