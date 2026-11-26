import { useMemo, useState } from "react";
import { panelRoot } from "./panelChrome";
import { useBoard } from "../store/board";

const WD = ["m", "t", "w", "t", "f", "s", "s"];

/** Month grid over the real vault: days that have a `Daily/YYYY-MM-DD.md`
 * note get an amber dot and open on click (Obsidian-style daily journal). */
export function CalendarPanel() {
  const vaultEntries = useBoard((s) => s.vaultEntries);
  const vaultDir = useBoard((s) => s.vaultDir);
  const vaultRead = useBoard((s) => s.vaultRead);
  const notes = useBoard((s) => s.notes);
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const daily = useMemo(() => {
    const set = new Set<string>();
    for (const e of vaultEntries) {
      const m = /^Daily\/(\d{4}-\d{2}-\d{2})\.md$/.exec(e);
      if (m) set.add(m[1]);
    }
    return set;
  }, [vaultEntries]);

  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const startCol = (first.getDay() + 6) % 7; // monday-first
  const days = new Date(y, m, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);
  const dueNotes = useMemo(
    () =>
      Object.values(notes)
        .filter((n) => n.due)
        .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")),
    [notes],
  );

  const openDaily = (d: number) => {
    const date = `${ym}-${String(d).padStart(2, "0")}`;
    vaultRead(`Daily/${date}.md`);
  };

  const cells: (number | null)[] = [
    ...Array<null>(startCol).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);

  const monthName = first.toLocaleString("en-US", { month: "long" });

  return (
    <div
      data-panel="calendar"
      style={{ ...panelRoot, padding: "12px 10px" }}
    >
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          padding: "0 12px 8px",
          color: "var(--cv-ink)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>
          <button style={navBtn} onClick={() => setYm(shift(ym, -1))}>‹</button>
          {monthName} {y}
          <button style={navBtn} onClick={() => setYm(shift(ym, 1))}>›</button>
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7,1fr)",
          gap: 2,
          padding: "0 8px",
          fontSize: 9.5,
          color: "var(--cv-ink-dim)",
          textAlign: "center",
        }}
      >
        {WD.map((d, i) => (
          <div key={i} style={{ padding: "2px 0" }}>{d}</div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const date = `${ym}-${String(d).padStart(2, "0")}`;
          const hasNote = daily.has(date);
          const isToday = date === today;
          return (
            <button
              key={i}
              onClick={() => openDaily(d)}
              title={hasNote ? `Daily/${date}.md` : `open Daily/${date}.md`}
              style={{
                position: "relative",
                padding: "6px 0",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 11,
                color: isToday ? "#fff" : "var(--cv-ink)",
                background: isToday ? "var(--cv-accent)" : "transparent",
              }}
            >
              {d}
              {hasNote && (
                <span
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: 1,
                    width: 4,
                    height: 4,
                    marginLeft: -2,
                    borderRadius: "50%",
                    background: isToday ? "#fff" : "var(--cv-accent)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
      {dueNotes.length > 0 && (
        <div style={{ marginTop: 10, padding: "0 12px", overflowY: "auto" }}>
          <div style={{ fontSize: 9.5, color: "var(--cv-ink-dim)", paddingBottom: 4 }}>due</div>
          {dueNotes.slice(0, 12).map((n) => (
            <div
              key={n.note_id}
              style={{
                fontSize: 11,
                color: (n.due ?? "") < today && n.col !== "done" ? "var(--cv-danger,#e66)" : "var(--cv-ink)",
                padding: "3px 0",
                display: "flex",
                gap: 8,
              }}
            >
              <span style={{ color: "var(--cv-ink-dim)", flexShrink: 0 }}>{n.due}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.text}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: "auto", padding: "8px 12px 2px", fontSize: 9.5, color: "var(--cv-ink-dim)" }}>
        {vaultDir ? `${daily.size} daily notes in vault` : "no vault mounted"}
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--cv-accent)",
  fontSize: 14,
  cursor: "pointer",
  padding: "0 8px",
};

function shift(ym: string, d: number) {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(y, m - 1 + d, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
