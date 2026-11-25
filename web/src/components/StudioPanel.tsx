import { useBoard } from "../store/board";
import { Icon } from "./icons";

/** Studios — the repo turned into material: a markdown dossier (tree,
 * README head, agents, notes, artifacts) you can copy or download. */
export function StudioPanel() {
  const doc = useBoard((s) => s.studioDoc);
  const close = useBoard((s) => s.closeStudioDoc);
  if (doc == null) return null;

  const copy = () => void navigator.clipboard.writeText(doc);
  const download = () => {
    const a = document.createElement("a");
    a.download = `studio-${Date.now()}.md`;
    a.href = URL.createObjectURL(new Blob([doc], { type: "text/markdown" }));
    a.click();
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
      onClick={close}
    >
      <div
        className="glass"
        style={{ width: 620, maxHeight: "72vh", display: "flex", flexDirection: "column", padding: 18 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 650, color: "var(--cv-ink)" }}>studio doc</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="glass-pill" style={{ border: "none", cursor: "pointer", fontSize: 11, padding: "5px 12px", color: "var(--cv-accent)" }} onClick={copy}>copy</button>
            <button className="glass-pill" style={{ border: "none", cursor: "pointer", fontSize: 11, padding: "5px 12px", color: "var(--cv-accent)" }} onClick={download}>▤ .md</button>
            <button style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", display: "flex", padding: 2 }} onClick={close}><Icon name="ph-x" size={12} /></button>
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
          {doc}
        </pre>
      </div>
    </div>
  );
}
