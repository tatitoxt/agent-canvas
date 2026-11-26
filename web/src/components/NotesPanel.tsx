import { useState } from "react";
import { panelRoot } from "./panelChrome";
import { useBoard } from "../store/board";

const COLS = [
  { key: "todo", label: "Todo" },
  { key: "doing", label: "Doing" },
  { key: "done", label: "Done" },
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
  // Deska "From earlier tasks" — cards parked on other boards.
  const earlier = Object.values(notes).filter(
    (n) => n.board_id !== (activeBoard ?? "main"),
  );
  const byCol = (col: string) => cards.filter((n) => n.col === col).sort((a, b) => a.pos - b.pos);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = cards.filter((n) => n.due).sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  const overdue = (n: (typeof cards)[number]) => !!n.due && n.due < today && n.col !== "done";

  const move = (note: (typeof cards)[number], dir: -1 | 1) => {
    const i = COLS.findIndex((c) => c.key === note.col);
    const next = COLS[i + dir];
    if (!next) return;
    noteUpsert(note.note_id, next.key, note.text, note.pos);
  };

  return (
    <div
      data-panel="notes"
      style={{ ...panelRoot, padding: "12px 10px" }}
    >
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
            fontSize: "var(--cv-text-xs)",
            color: "var(--cv-ink)",
            outline: "none",
          }}
        />
      </form>
      {upcoming.length > 0 && (
        <div style={{ margin: "0 4px 8px", display: "flex", flexDirection: "column", gap: 2, maxHeight: 90, overflowY: "auto" }}>
          {upcoming.map((n) => (
            <div key={n.note_id} style={{ display: "flex", gap: 6, fontSize: "var(--cv-text-xxs)", color: overdue(n) ? "var(--cv-waiting)" : "var(--cv-ink-dim)", alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--cv-font-mono)", flexShrink: 0 }}>{n.due}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--cv-ink)" }}>{n.text}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 1, display: "flex", gap: 6, minHeight: 0 }}>
        {COLS.map((col) => (
          <div key={col.key} style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 400, color: "var(--cv-ink-dim)", padding: "0 6px 6px", letterSpacing: "0.02em" }}>
              {col.label} · {byCol(col.key).length}
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {byCol(col.key).map((n) => (
                <div
                  key={n.note_id}
                  className="glass"
                  style={{ margin: "0 0 6px", padding: "8px 10px", fontSize: "var(--cv-text-xs)", color: "var(--cv-ink)", lineHeight: 1.4, outline: overdue(n) ? "1px solid var(--cv-waiting)" : "none" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ flex: 1, wordBreak: "break-word" }}>{n.text}</span>
                    <button
                      title="delete card"
                      style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: "var(--cv-text-xs)", padding: 0 }}
                      onClick={() => noteDelete(n.note_id)}
                    >
                      ×
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 6, alignItems: "center" }}>
                    <input
                      type="date"
                      value={n.due ?? ""}
                      onChange={(e) => noteUpsert(n.note_id, n.col, n.text, n.pos, e.target.value || undefined)}
                      title="due date"
                      style={{ background: "none", border: "none", color: overdue(n) ? "var(--cv-waiting)" : "var(--cv-ink-dim)", fontSize: "var(--cv-text-xxs)", fontFamily: "var(--cv-font-mono)", width: 92, padding: 0 }}
                    />
                    <button
                      disabled={col.key === "todo"}
                      style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: "var(--cv-text-xxs)", padding: 0, opacity: col.key === "todo" ? 0.3 : 1 }}
                      onClick={() => move(n, -1)}
                    >
                      ←
                    </button>
                    <button
                      disabled={col.key === "done"}
                      style={{ border: "none", background: "none", color: "var(--cv-ink-dim)", cursor: "pointer", fontSize: "var(--cv-text-xxs)", padding: 0, opacity: col.key === "done" ? 0.3 : 1 }}
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
      {earlier.length > 0 && (
        <div style={{ margin: "8px 4px 0", borderTop: "1px solid var(--cv-glass-edge)", paddingTop: 8, maxHeight: 110, overflowY: "auto" }}>
          <div style={{ fontSize: "var(--cv-text-xxs)", fontWeight: 400, color: "var(--cv-ink-dim)", letterSpacing: "0.02em", padding: "0 6px 6px" }}>
            From earlier tasks
          </div>
          {earlier.map((n) => (
            <div key={n.note_id} style={{ display: "flex", gap: 6, fontSize: "var(--cv-text-xxs)", color: "var(--cv-ink-dim)", padding: "2px 6px", alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--cv-font-mono)", fontSize: "var(--cv-text-xxs)", flexShrink: 0 }}>[{n.col}]</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--cv-ink)" }}>{n.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
