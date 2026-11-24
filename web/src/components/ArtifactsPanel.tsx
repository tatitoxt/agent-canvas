import { useState } from "react";
import { useBoard } from "../store/board";
import { downloadPdf } from "../lib/pdf";

/** Each artifact kind gets its own symbol + muted color (Deska-style
 * deliverable templates). */
const KINDS: Record<string, { mark: string; color: string }> = {
  report: { mark: "▤", color: "#7ba3cf" },
  plan: { mark: "☰", color: "#c2a15e" },
  diff: { mark: "±", color: "#9a7fd4" },
  log: { mark: "▦", color: "#86817a" },
  image: { mark: "▩", color: "#7ba389" },
  note: { mark: "✎", color: "#c9a26b" },
  pdf: { mark: "⎙", color: "#c96b6b" },
};
const kindMeta = (k: string) => KINDS[k] ?? KINDS.note;

export function ArtifactsPanel() {
  const artifacts = useBoard((s) => s.artifacts);
  const activeBoard = useBoard((s) => s.activeBoard);
  const artifactCreate = useBoard((s) => s.artifactCreate);
  const artifactDelete = useBoard((s) => s.artifactDelete);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState("note");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  const list = Object.values(artifacts)
    .filter((a) => a.board_id === (activeBoard ?? "main"))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

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
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 650,
          padding: "0 12px 8px",
          color: "var(--cv-ink)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        Artifacts
        <button
          className="glass-pill"
          style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 11px", cursor: "pointer", border: "none", color: "var(--cv-ink)" }}
          onClick={() => setCreating((c) => !c)}
        >
          + new
        </button>
      </div>
      {creating && (
        <div className="glass" style={{ margin: "0 4px 8px", padding: "10px 12px" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              style={{ background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 999, padding: "5px 10px", fontSize: 11.5, color: "var(--cv-ink)", outline: "none" }}
            >
              {Object.keys(KINDS).map((k) => (
                <option key={k} value={k}>
                  {KINDS[k].mark} {k}
                </option>
              ))}
            </select>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="title"
              style={{ flex: 1, minWidth: 0, background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 999, padding: "5px 12px", fontSize: 11.5, color: "var(--cv-ink)", outline: "none" }}
            />
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="contents (optional)"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 56, background: "var(--cv-glass-hi)", border: "1px solid var(--cv-glass-edge)", borderRadius: 12, padding: "7px 10px", fontSize: 11, color: "var(--cv-ink)", outline: "none", resize: "vertical" }}
          />
          <button
            className="glass-pill"
            style={{ marginTop: 6, fontSize: 11, padding: "5px 14px", cursor: "pointer", border: "none", color: "var(--cv-accent)" }}
            onClick={() => {
              if (!title.trim()) return;
              artifactCreate(kind, title.trim(), undefined, text || undefined);
              setTitle("");
              setText("");
              setCreating(false);
            }}
          >
            create
          </button>
        </div>
      )}
      {list.length === 0 && !creating && (
        <div style={{ fontSize: 11.5, color: "var(--cv-ink-dim)", padding: "4px 12px" }}>
          No artifacts yet — agents register them with `canvasctl artifact`.
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {list.map((a) => {
          const meta = kindMeta(a.kind);
          return (
            <div
              key={a.artifact_id}
              style={{ margin: "0 4px 6px", padding: "9px 12px", borderRadius: 14, background: "var(--cv-glass-hi)", display: "flex", alignItems: "center", gap: 10 }}
            >
              <span
                style={{
                  flex: "none",
                  width: 22,
                  height: 22,
                  borderRadius: 7,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12,
                  color: meta.color,
                  background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${meta.color} 30%, transparent)`,
                }}
              >
                {meta.mark}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--cv-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.title}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--cv-ink-dim)" }}>
                  <span style={{ color: meta.color }}>{a.kind}</span>
                  {a.agent_name && ` · ${a.agent_name}`}
                  {a.created_at && ` · ${a.created_at.slice(5, 16)}`}
                </div>
              </div>
              {a.kind === "pdf" && a.text && (
                <button
                  title="download PDF again"
                  style={{ border: "none", background: "none", cursor: "pointer", color: "var(--cv-accent)", fontSize: 13 }}
                  onClick={() => downloadPdf(a.title.replace(/^PDF — /, ""), a.text ?? "")}
                >
                  ⭳
                </button>
              )}
              <button
                title="delete artifact"
                style={{ border: "none", background: "none", cursor: "pointer", color: "var(--cv-ink-dim)", fontSize: 13 }}
                onClick={() => artifactDelete(a.artifact_id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
