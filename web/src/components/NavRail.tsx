import { useState } from "react";
import { useBoard } from "../store/board";
import { Icon } from "./icons";

const railStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  zIndex: 20,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  padding: "8px 7px",
};

const btn = (active: boolean): React.CSSProperties => ({
  width: 34,
  height: 34,
  display: "grid",
  placeItems: "center",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  color: active ? "var(--cv-ink)" : "var(--cv-ink-faint)",
  background: active ? "var(--cv-glass-hi)" : "transparent",
  position: "relative",
  boxShadow: active ? "inset 0 1px 0 var(--cv-glass-shine)" : "none",
});

const divider: React.CSSProperties = {
  width: 20,
  height: 1,
  background: "var(--cv-glass-edge)",
  margin: "4px 0",
};

/** Left rail — Deska "Spaces": one tile per board (rename on double-click,
 * ⌫ on the active non-main tile), + to add, then tasks/inbox and the
 * daemon dot. Replaces the old top board tabs. */
export function NavRail({ active, onSelect }: { active: string; onSelect: (key: string) => void }) {
  const connected = useBoard((s) => s.connected);
  const boards = useBoard((s) => s.boards);
  const activeBoard = useBoard((s) => s.activeBoard);
  const setActiveBoard = useBoard((s) => s.setActiveBoard);
  const createBoard = useBoard((s) => s.createBoard);
  const renameBoard = useBoard((s) => s.renameBoard);
  const deleteBoard = useBoard((s) => s.deleteBoard);
  const agents = useBoard((s) => s.agents);
  const edges = useBoard((s) => s.edges);
  const approvals = useBoard((s) => s.approvals);
  const inboxCount =
    Object.keys(approvals).length +
    Object.values(agents).filter((a) => a.status === "waiting" || a.status === "blocked").length +
    Object.values(edges).filter((e) => e.state === "delegated").length;

  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [editName, setEditName] = useState("");

  const agentCount = (boardId: string) =>
    Object.values(agents).filter(
      (a) => (a.board_id ?? "main") === boardId && a.status !== "exited",
    ).length;

  const submitEdit = () => {
    const n = editName.trim();
    if (n) {
      if (editing === "new") createBoard(n);
      else if (editing) renameBoard(editing, n);
    }
    setEditing(null);
    setEditName("");
  };

  return (
    <nav className="glass" style={{ ...railStyle, left: 12 }}>
      <div
        title="Agent Canvas"
        style={{ marginBottom: 2, color: "var(--cv-accent)", padding: 4 }}
      >
        <Icon name="canvas" size={17} />
      </div>
      <div
        style={{
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: 0.8,
          color: "var(--cv-ink-faint)",
          textTransform: "uppercase",
          marginBottom: 2,
        }}
      >
        Spaces
      </div>
      {Object.entries(boards).map(([id, n]) =>
        editing === id ? (
          <input
            key={id}
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitEdit();
              if (e.key === "Escape") setEditing(null);
            }}
            onBlur={submitEdit}
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              border: "1px solid var(--cv-glass-edge)",
              background: "var(--cv-glass-hi)",
              color: "var(--cv-ink)",
              fontSize: 11,
              textAlign: "center",
              outline: "none",
            }}
          />
        ) : (
          <button
            key={id}
            onClick={() => setActiveBoard(id)}
            onDoubleClick={() => {
              setEditing(id);
              setEditName(n);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setEditing(id);
              setEditName(n);
            }}
            title={
              id === "main"
                ? `${n} — double-click to rename`
                : `${n} — double-click to rename, ⌫ deletes when empty`
            }
            style={{
              ...btn(id === activeBoard),
              fontSize: 12,
              fontWeight: 700,
              color:
                id === activeBoard ? "var(--cv-accent)" : "var(--cv-ink-dim)",
            }}
          >
            {n.slice(0, 1).toUpperCase()}
            {agentCount(id) > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: 1,
                  right: 1,
                  minWidth: 13,
                  height: 13,
                  borderRadius: 999,
                  background: "var(--cv-done)",
                  color: "var(--cv-base)",
                  fontSize: 8.5,
                  fontWeight: 700,
                  display: "grid",
                  placeItems: "center",
                  padding: "0 3px",
                }}
              >
                {agentCount(id)}
              </span>
            )}
            {id !== "main" && id === activeBoard && (
              <span
                role="button"
                aria-label="delete board"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteBoard(id);
                }}
                title="delete board (only when empty)"
                style={{
                  position: "absolute",
                  bottom: -1,
                  right: -1,
                  width: 13,
                  height: 13,
                  borderRadius: 999,
                  background: "var(--cv-blocked)",
                  color: "var(--cv-base)",
                  fontSize: 9,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                ×
              </span>
            )}
          </button>
        ),
      )}
      {editing === "new" ? (
        <input
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitEdit();
            if (e.key === "Escape") setEditing(null);
          }}
          onBlur={submitEdit}
          placeholder="+"
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            border: "1px solid var(--cv-glass-edge)",
            background: "var(--cv-glass-hi)",
            color: "var(--cv-ink)",
            fontSize: 11,
            textAlign: "center",
            outline: "none",
          }}
        />
      ) : (
        <button
          onClick={() => {
            setEditing("new");
            setEditName("");
          }}
          title="new board"
          style={{ ...btn(false), fontSize: 15 }}
        >
          +
        </button>
      )}
      <div style={divider} />
      <button
        title="Inbox — approvals, waiting agents, delegations"
        onClick={() => onSelect("inbox")}
        style={btn(active === "inbox")}
      >
        <Icon name="inbox" />
        {inboxCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: 1,
              right: 1,
              minWidth: 14,
              height: 14,
              borderRadius: 999,
              background: "var(--cv-waiting)",
              color: "var(--cv-base)",
              fontSize: 9,
              fontWeight: 700,
              display: "grid",
              placeItems: "center",
              padding: "0 4px",
            }}
          >
            {inboxCount}
          </span>
        )}
      </button>
      <button
        title="Tasks — delegated work in flight"
        onClick={() => onSelect("history")}
        style={btn(active === "history")}
      >
        <Icon name="tasks" />
      </button>
      <div style={{ flex: 1 }} />
      <div
        title={connected ? "daemon connected" : "daemon offline"}
        style={{
          marginTop: 4,
          width: 8,
          height: 8,
          borderRadius: 999,
          background: connected ? "var(--cv-done)" : "var(--cv-ink-faint)",
        }}
      />
    </nav>
  );
}
