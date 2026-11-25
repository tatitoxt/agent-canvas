import { useBoard } from "../store/board";
import { downloadPdf } from "../lib/pdf";

/** "Lose nothing" — a markdown digest of every agent session: status,
 * account, and the last visible lines of each terminal. Copy it or fold
 * it into the board memory before quitting. */
export function DigestPanel() {
  const digest = useBoard((s) => s.digest);
  const closeDigest = useBoard((s) => s.closeDigest);
  const memories = useBoard((s) => s.memories);
  const memoryWrite = useBoard((s) => s.memoryWrite);
  if (digest == null) return null;

  const copy = () => void navigator.clipboard.writeText(digest);
  const toMemory = () => {
    memoryWrite("main", `${memories["main"] ?? ""}\n\n${digest}`.trimStart());
    closeDigest();
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        display: "grid",
        placeItems: "center",
        background: "color-mix(in srgb, var(--cv-base) 62%, transparent)",
        backdropFilter: "blur(6px)",
      }}
      onClick={closeDigest}
    >
      <div
        className="glass"
        style={{ width: 560, maxHeight: "72vh", display: "flex", flexDirection: "column", padding: "16px 18px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 650, color: "var(--cv-ink)" }}>Session digest</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="glass-pill" style={{ fontSize: 10.5, padding: "4px 12px", cursor: "pointer", border: "none", color: "var(--cv-ink)" }} onClick={copy}>
              copy
            </button>
            <button
              className="glass-pill"
              style={{ fontSize: 10.5, padding: "4px 12px", cursor: "pointer", border: "none", color: "var(--cv-ink)" }}
              title="Export this digest as PDF (saved to artifacts)"
              onClick={() => {
                downloadPdf("Session digest", digest);
                useBoard.getState().artifactCreate("pdf", "PDF — Session digest", undefined, digest);
              }}
            >
              → PDF
            </button>
            <button className="glass-pill" style={{ fontSize: 10.5, padding: "4px 12px", cursor: "pointer", border: "none", color: "var(--cv-accent)" }} onClick={toMemory}>
              → board memory
            </button>
            <button style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 14 }} onClick={closeDigest}>
              ×
            </button>
          </div>
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
            fontFamily: "var(--cv-font-mono)",
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}
        >
          {digest}
        </pre>
      </div>
    </div>
  );
}
