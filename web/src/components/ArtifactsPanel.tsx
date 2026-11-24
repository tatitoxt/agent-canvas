import { useState } from "react";
import { useBoard } from "../store/board";
import { useReactFlow } from "@xyflow/react";
import { cleanPinSpot } from "./PinBtn";
import { downloadPdf } from "../lib/pdf";
import { Icon } from "./icons";

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

const SUGGESTIONS: { icon: string; color: string; label: string; dex: string }[] = [
  { icon: "canvas", color: "#7ba3cf", label: "Design a landing page for my app", dex: "spawn codex to design a landing page for my app" },
  { icon: "code", color: "#7ba389", label: "Build me a budget calculator", dex: "spawn codex to build me a budget calculator" },
  { icon: "notes", color: "#c9a26b", label: "Write a new document", dex: "pdf Project overview" },
];

export function ArtifactsPanel() {
  const artifacts = useBoard((s) => s.artifacts);
  const activeBoard = useBoard((s) => s.activeBoard);
  const artifactCreate = useBoard((s) => s.artifactCreate);
  const artifactDelete = useBoard((s) => s.artifactDelete);
  const threadSend = useBoard((s) => s.threadSend);
  const requestNav = useBoard((s) => s.requestNav);
  const pinCard = useBoard((s) => s.pinCard);
  const { screenToFlowPosition } = useReactFlow();
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState("note");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");

  const list = Object.values(artifacts)
    .filter((a) => a.board_id === (activeBoard ?? "main"))
    .filter((a) => !query || a.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div
      className="glass"
      data-panel="artifacts"
      style={{
        position: "absolute",
        left: 64,
        top: 64,
        bottom: 64,
        width: 340,
        zIndex: 19,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* search */}
      <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid var(--cv-glass-edge)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--cv-glass-hi)",
            border: "1px solid var(--cv-glass-edge)",
            borderRadius: 10,
            padding: "6px 10px",
          }}
        >
          <Icon name="bot" size={13} color="var(--cv-ink-faint)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) {
                threadSend(query.trim());
                setQuery("");
                requestNav("thread");
              }
            }}
            placeholder="Search artifacts or ask Dex"
            style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", color: "var(--cv-ink)", fontSize: 11.5 }}
          />
          <span style={{ fontSize: 9, color: "var(--cv-ink-faint)", border: "1px solid var(--cv-glass-edge)", borderRadius: 5, padding: "1px 5px" }}>⌘F</span>
        </div>
      </div>

      <div
        style={{
          fontSize: 13,
          fontWeight: 650,
          padding: "10px 16px 8px",
          color: "var(--cv-ink)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Icon name="artifacts" size={15} color="var(--cv-ink)" />
          Artifacts
        </span>
        <button
          className="glass-pill"
          style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 11px", cursor: "pointer", border: "none", color: "var(--cv-ink)" }}
          onClick={() => setCreating((c) => !c)}
        >
          + new
        </button>
      </div>

      {creating && (
        <div className="glass" style={{ margin: "0 12px 8px", padding: "10px 12px" }}>
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
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 22px", gap: 14 }}>
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 18,
              background: "var(--cv-glass-hi)",
              border: "1px solid var(--cv-glass-edge)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Icon name="bot" size={26} color="var(--cv-ink)" />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--cv-ink)" }}>What you make with Dex shows up here</div>
            <div style={{ fontSize: 11, color: "var(--cv-ink-dim)", marginTop: 5, lineHeight: 1.5 }}>
              Pages, designs, apps and documents your agents make, next to your notes. Ask for something to start.
            </div>
          </div>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s.label}
                onClick={() => { threadSend(s.dex); requestNav("thread"); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 12,
                  border: "1px solid var(--cv-glass-edge)",
                  background: "var(--cv-glass-hi)",
                  color: "var(--cv-ink)",
                  fontSize: 11.5,
                  fontWeight: 550,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    flex: "none",
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    display: "grid",
                    placeItems: "center",
                    background: `color-mix(in srgb, ${s.color} 14%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${s.color} 32%, transparent)`,
                  }}
                >
                  <Icon name={s.icon} size={12} color={s.color} />
                </span>
                <span style={{ flex: 1 }}>{s.label}</span>
                <span style={{ color: "var(--cv-ink-faint)" }}>→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
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
              <button
                title="Add to Board — pin as a card on the canvas"
                style={{
                  border: "1px solid color-mix(in srgb, var(--cv-accent) 45%, transparent)",
                  borderRadius: 999,
                  background: "color-mix(in srgb, var(--cv-accent) 10%, transparent)",
                  cursor: "pointer",
                  color: "var(--cv-accent)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 8px",
                  fontSize: 10,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
                onClick={() =>
                  pinCard(
                    a.title,
                    (a.text ?? a.path ?? "")
                      .split("\n")
                      .filter((l) => l.trim() && !/^#{1,6}\s/.test(l.trim()))
                      .slice(0, 6)
                      .join("\n")
                      .slice(0, 260),
                    undefined,
                    "artifacts",
                    screenToFlowPosition(cleanPinSpot("artifacts")),
                  )
                }
              >
                <Icon name="pin" size={11} />
                board
              </button>
              {a.kind === "pdf" && a.text && (
                <button
                  title="download PDF again"
                  style={{ border: "none", background: "none", cursor: "pointer", color: "var(--cv-accent)", display: "grid", placeItems: "center" }}
                  onClick={() => downloadPdf(a.title.replace(/^PDF — /, ""), a.text ?? "")}
                >
                  <Icon name="download" size={14} />
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
