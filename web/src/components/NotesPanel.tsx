import { useState } from "react";
import { useBoard } from "../store/board";

const COLS = [
  { key: "todo", label: "todo" },
  { key: "doing", label: "doing" },
  { key: "done", label: "done" },
] as const;

/** Kanban notes for the active board — cards persist in SQLite and move
 * between todo/doing/done (Symvibe's tasks panel). */
export function NotesPanel() {
  const notes = useBoard((s) => s.notes);
  const activeBoard = useBoard((s) => s.activeBoard);
  const noteUpsert = useBoard((s) => s.noteUpsert);
  const noteDelete = useBoard((s) => s.noteDelete);
  const [draft, setDraft] = useState("");

  const cards = Object.values(notes).filter(
    (n) => n.board_id === (activeBoard ?? "main"),
  );
  const byCol = (col: string) => cards.filter((n) => n.col === col).sort((a, b) => a.pos - b.pos);

  const move = (note: (typeof cards)[number], dir: -1 | 1) => {
    const i = COLS.findIndex((c) => c.key === note.col);
    const next = COLS[i + dir];
    if (!next) return;
    noteUpsert(note.note_id, next.key, note.text, note.pos);
  };

  return (
    <div
      className="glass"
      style={{
        position: "absolute",
        left: 64,
        top: 64,
        bottom: 64,
        width: 400,
        zIndex: 19,
        display: "flex",
        flexDirection: "column",
        padding: "12px 10px",
        overflow: "hidden",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 650, padding: "0 12px 8px", color: "var(--cv-ink)" }}>
        Notes
      </div>
      <form
        style={{ display: "flex", gap: 6, margin: "0 4px 10px" }}
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (!t) return;
          noteUpsert(null, "todo", t);
          setDraft("");
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="new card…"
          style={{
            flex: 1,
            background: "var(--cv-glass-hi)",
            border: "1px solid var(--cv-glass-edge)",
            borderRadius: 999,
            padding: "6px 14px",
            fontSize: 12,
            color: "var(--cv-ink)",
            outline: "none",
          }}
        />
      </form>
      <div style={{ flex: 1, display: "flex", gap: 6, minHeight: 0 }}>
        {COLS.map((col) => (
          <div key={col.key} style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--cv-ink-dim)", padding: "0 6px 6px", textTransform: "uppercase", letterSpacing: 0.6 }}>
              {col.label} · {byCol(col.key).length}
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {byCol(col.key).map((n) => (
                <div
                  key={n.note_id}
                  className="glass"
                  style={{ margin: "0 0 6px", padding: "8px 10px", fontSize: 11.5, color: "var(--cv-ink)", lineHeight: 1.4 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ flex: 1, wordBreak: "break-word" }}>{n.text}</span>
                    <button
                      title="delete card"
                      style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 12, padding: 0 }}
                      onClick={() => noteDelete(n.note_id)}
                    >
                      ×
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                    <button
                      disabled={col.key === "todo"}
                      style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 11, padding: 0, opacity: col.key === "todo" ? 0.3 : 1 }}
                      onClick={() => move(n, -1)}
                    >
                      ←
                    </button>
                    <button
                      disabled={col.key === "done"}
                      style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: 11, padding: 0, opacity: col.key === "done" ? 0.3 : 1 }}
                      onClick={() => move(n, 1)}
                    >
                      →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
