import { useState } from "react";
import { useBoard } from "../store/board";

// Board tabs — Deska "Spaces": separate canvases, each with its own
// agents/workspaces/edges. Switching filters the whole canvas.
export function BoardTabs() {
  const boards = useBoard((s) => s.boards);
  const activeBoard = useBoard((s) => s.activeBoard);
  const setActiveBoard = useBoard((s) => s.setActiveBoard);
  const createBoard = useBoard((s) => s.createBoard);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const submit = () => {
    const n = name.trim();
    if (n) createBoard(n);
    setName("");
    setAdding(false);
  };

  return (
    <div
      className="glass-pill"
      style={{
        position: "absolute",
        top: 52,
        left: 50,
        zIndex: 14,
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "3px 4px",
      }}
    >
      {Object.entries(boards).map(([id, n]) => (
        <button
          key={id}
          onClick={() => setActiveBoard(id)}
          style={{
            border: "none",
            background:
              id === activeBoard
                ? "color-mix(in srgb, var(--cv-accent) 18%, transparent)"
                : "transparent",
            color:
              id === activeBoard ? "var(--cv-accent)" : "var(--cv-ink-dim)",
            fontSize: 11,
            fontWeight: 500,
            padding: "4px 10px",
            borderRadius: 999,
            cursor: "pointer",
          }}
        >
          {n}
        </button>
      ))}
      {adding ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") setAdding(false);
          }}
          onBlur={submit}
          placeholder="board name"
          style={{
            border: "none",
            background: "transparent",
            color: "var(--cv-ink)",
            fontSize: 11,
            width: 90,
            outline: "none",
            padding: "4px 8px",
          }}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          title="new board"
          style={{
            border: "none",
            background: "transparent",
            color: "var(--cv-ink-faint)",
            fontSize: 12,
            padding: "3px 8px",
            borderRadius: 999,
            cursor: "pointer",
          }}
        >
          +
        </button>
      )}
    </div>
  );
}
