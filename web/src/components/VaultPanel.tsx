import { useState } from "react";
import { useBoard } from "../store/board";

/** Obsidian-style vault browser: point it at a vault directory and read
 * markdown notes in a side column. Read-only, .md only. */
export function VaultPanel() {
  const vaultDir = useBoard((s) => s.vaultDir);
  const vaultEntries = useBoard((s) => s.vaultEntries);
  const vaultFile = useBoard((s) => s.vaultFile);
  const vaultList = useBoard((s) => s.vaultList);
  const vaultRead = useBoard((s) => s.vaultRead);
  const closeVaultFile = useBoard((s) => s.closeVaultFile);
  const [dir, setDir] = useState(vaultDir || "/home/ubuntu/repos/agent-canvas");
  const [filter, setFilter] = useState("");

  const shown = vaultEntries.filter((e) =>
    e.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div
      className="glass"
      style={{
        position: "absolute",
        left: 64,
        top: 64,
        bottom: 64,
        width: 320,
        zIndex: 19,
        display: "flex",
        flexDirection: "column",
        padding: "12px 10px",
        overflow: "hidden",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 650, padding: "0 12px 8px", color: "var(--cv-ink)" }}>
        Vault
      </div>
      <form
        style={{ display: "flex", gap: 6, margin: "0 4px 8px" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (dir.trim()) vaultList(dir.trim());
        }}
      >
        <input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder="/path/to/vault"
          style={{ flex: 1, minWidth: 0, background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 999, padding: "6px 12px", fontSize: 11, color: "var(--cv-ink)", outline: "none", fontFamily: "ui-monospace, monospace" }}
        />
        <button className="glass-pill" style={{ fontSize: 10.5, padding: "5px 12px", cursor: "pointer", border: "none", color: "var(--cv-accent)" }} type="submit">
          open
        </button>
      </form>
      {vaultEntries.length > 0 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`${vaultEntries.length} notes — filter…`}
          style={{ margin: "0 4px 8px", background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 999, padding: "5px 12px", fontSize: 11, color: "var(--cv-ink)", outline: "none" }}
        />
      )}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {shown.map((e) => (
          <button
            key={e}
            onClick={() => vaultRead(e)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              border: "none",
              background: vaultFile?.path === e ? "var(--cv-glass-hi)" : "transparent",
              color: "var(--cv-ink)",
              fontSize: 11.5,
              padding: "6px 12px",
              borderRadius: 8,
              cursor: "pointer",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: "var(--cv-ink-dim)" }}>✎ </span>
            {e}
          </button>
        ))}
      </div>
      {vaultFile && (
        <div
          className="glass"
          style={{
            position: "absolute",
            left: "100%",
            top: 0,
            bottom: 0,
            marginLeft: 12,
            width: 480,
            zIndex: 20,
            display: "flex",
            flexDirection: "column",
            padding: "14px 16px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--cv-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {vaultFile.path}
            </span>
            <button style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 14 }} onClick={closeVaultFile}>
              ×
            </button>
          </div>
          <pre
            style={{
              flex: 1,
              overflow: "auto",
              margin: 0,
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid var(--cv-glass-edge)",
              background: "var(--cv-glass-hi)",
              color: "var(--cv-ink)",
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
            }}
          >
            {vaultFile.text}
          </pre>
        </div>
      )}
    </div>
  );
}
