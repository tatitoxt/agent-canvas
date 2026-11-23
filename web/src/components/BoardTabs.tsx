import { useState } from "react";
import { useBoard } from "../store/board";

// Board tabs — Deska "Spaces": separate canvases, each with its own
// agents/workspaces/edges. Switching filters the whole canvas.
// Double-click a tab to rename; right-click to rename or delete
// (delete only lands if the board is empty — the daemon refuses otherwise).
export function BoardTabs() {
  const boards = useBoard((s) => s.boards);
  const activeBoard = useBoard((s) => s.activeBoard);
  const setActiveBoard = useBoard((s) => s.setActiveBoard);
  const createBoard = useBoard((s) => s.createBoard);
  const renameBoard = useBoard((s) => s.renameBoard);
  const deleteBoard = useBoard((s) => s.deleteBoard);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const submit = () => {
    const n = name.trim();
    if (n) createBoard(n);
    setName("");
    setAdding(false);
  };

  const submitRename = () => {
    const n = renameValue.trim();
    if (n && renamingId) renameBoard(renamingId, n);
    setRenamingId(null);
  };

  const inputStyle: React.CSSProperties = {
    border: "none",
    background: "transparent",
    color: "var(--cv-ink)",
    fontSize: 11,
    width: 90,
    outline: "none",
    padding: "4px 8px",
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
      {Object.entries(boards).map(([id, n]) =>
        renamingId === id ? (
          <input
            key={id}
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") setRenamingId(null);
            }}
            onBlur={submitRename}
            style={inputStyle}
          />
        ) : (
          <button
            key={id}
            onClick={() => setActiveBoard(id)}
            onDoubleClick={() => {
              setRenamingId(id);
              setRenameValue(n);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setRenamingId(id);
              setRenameValue(n);
            }}
            title={
              id === "main"
                ? `${n} — double-click to rename`
                : `${n} — double-click to rename, ⌫ deletes when empty`
            }
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
            {id !== "main" && id === activeBoard && (
              <span
                role="button"
                aria-label="delete board"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteBoard(id);
                }}
                style={{
                  marginLeft: 6,
                  color: "var(--cv-ink-faint)",
                  fontSize: 10,
                }}
                title="delete board (only when empty)"
              >
                ×
              </span>
            )}
          </button>
        ),
      )}
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
          style={inputStyle}
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
