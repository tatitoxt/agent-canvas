import { useEffect, useRef, useState } from "react";
import { useBoard } from "../store/board";
import { useReactFlow } from "@xyflow/react";
import { agentPinSpot } from "./PinBtn";

// Right-click menu on a node — Deska-style node actions: open terminal,
// move to another board, kill (inline two-step confirm).
export function ContextMenu({
  x,
  y,
  nodeId,
  isAgent,
  onOpenTerminal,
  onClose,
}: {
  x: number;
  y: number;
  nodeId: string;
  isAgent: boolean;
  onOpenTerminal: () => void;
  onClose: () => void;
}) {
  const boards = useBoard((s) => s.boards);
  const moveToBoard = useBoard((s) => s.moveToBoard);
  const renameNode = useBoard((s) => s.renameNode);
  const currentName = useBoard(
    (s) => s.agents[nodeId]?.name ?? s.workspaces[nodeId]?.name ?? "",
  );
  const kill = useBoard((s) => s.kill);
  const gitPush = useBoard((s) => s.gitPush);
  const current = useBoard(
    (s) => s.agents[nodeId]?.board_id ?? s.workspaces[nodeId]?.board_id ?? "main",
  );
  const deleteWorkspace = useBoard((s) => s.deleteWorkspace);
  const { screenToFlowPosition } = useReactFlow();
  const [confirmKill, setConfirmKill] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(currentName);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const item: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    border: "none",
    background: "transparent",
    color: "var(--cv-ink)",
    fontSize: 12,
    padding: "7px 12px",
    borderRadius: 8,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div
      ref={ref}
      className="glass"
      style={{
        position: "fixed",
        left: Math.min(x, window.innerWidth - 220),
        top: Math.min(y, window.innerHeight - 200),
        zIndex: 60,
        minWidth: 190,
        padding: 6,
        borderRadius: 12,
      }}
    >
      {isAgent && (
        <button style={item} onClick={() => { onOpenTerminal(); onClose(); }}>
          open terminal
        </button>
      )}
      {isAgent && (
        <button
          style={{ ...item, color: "var(--cv-ink-dim)" }}
          onClick={() => {
            useBoard.getState().openTermNode(nodeId);
            onClose();
          }}
        >
          ⇱ terminal on canvas
        </button>
      )}
      {renaming ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              renameNode(nodeId, name.trim());
              onClose();
            }
            if (e.key === "Escape") onClose();
          }}
          onBlur={() => setRenaming(false)}
          style={{
            ...item,
            border: "1px solid var(--cv-glass-edge)",
            background: "rgba(0,0,0,0.3)",
            outline: "none",
            width: "calc(100% - 24px)",
            margin: "0 12px",
            padding: "5px 0",
            cursor: "text",
          }}
        />
      ) : (
        <button style={{ ...item, color: "var(--cv-ink-dim)" }} onClick={() => setRenaming(true)}>
          rename…
        </button>
      )}
      <div style={{ position: "relative" }}>
        <button
          style={{ ...item, color: "var(--cv-ink-dim)" }}
          onClick={() => setBoardsOpen((o) => !o)}
        >
          move to board ▸
        </button>
        {boardsOpen && (
          <div
            className="glass"
            style={{
              position: "absolute",
              left: "100%",
              top: 0,
              marginLeft: 6,
              minWidth: 140,
              padding: 6,
              borderRadius: 12,
            }}
          >
            {Object.entries(boards).map(([id, name]) => (
              <button
                key={id}
                style={{
                  ...item,
                  color: id === current ? "var(--cv-accent)" : "var(--cv-ink)",
                }}
                onClick={() => { moveToBoard(nodeId, id); onClose(); }}
              >
                {id === current ? "✓ " : ""}{name}
              </button>
            ))}
          </div>
        )}
      </div>
      {isAgent && (
        <button
          style={{ ...item, color: "var(--cv-ink-dim)" }}
          onClick={() => { gitPush(nodeId); onClose(); }}
        >
          git push ▸
        </button>
      )}
      {isAgent && (
        <button
          style={{ ...item, color: "var(--cv-ink-dim)" }}
          title="spawn a twin — same CLI, same board, next to this card"
          onClick={() => {
            const st = useBoard.getState();
            const a = st.agents[nodeId];
            if (a) {
              const p = st.positions[nodeId];
              if (p) st.setPendingSpawnPos({ x: p.x + 60, y: p.y + 60 });
              st.spawn(a.name, a.command ?? "bash", a.workspace_id ?? undefined, a.permission);
            }
            onClose();
          }}
        >
          ⧉ duplicate agent
        </button>
      )}
      {isAgent && (
        <button
          style={{ ...item, color: "var(--cv-ink-dim)" }}
          title="copy the agent's git worktree path"
          onClick={() => {
            const wt = useBoard.getState().agents[nodeId]?.worktree;
            if (wt) { void navigator.clipboard?.writeText(wt).catch(() => {}); useBoard.getState().notify("worktree path copied"); }
            else useBoard.getState().notify("no worktree for this agent");
            onClose();
          }}
        >
          ⧉ copy worktree
        </button>
      )}
      {isAgent && (
        <button
          style={{ ...item, color: "var(--cv-ink-dim)" }}
          onClick={() => {
            const name = useBoard.getState().agents[nodeId]?.name ?? "agent";
            const spot = agentPinSpot(nodeId);
            useBoard.getState().pinCard(
              `${name} — note`,
              "",
              undefined,
              `agent:${nodeId}`,
              spot ? screenToFlowPosition(spot) : undefined,
            );
            onClose();
          }}
        >
          ◈ pin a note
        </button>
      )}
      {isAgent ? (
        <button
          style={{
            ...item,
            color: confirmKill ? "var(--cv-blocked)" : "var(--cv-ink-dim)",
          }}
          onClick={() => {
            if (confirmKill) { kill(nodeId); onClose(); }
            else setConfirmKill(true);
          }}
        >
          {confirmKill ? "confirm kill?" : "kill agent"}
        </button>
      ) : (
        <button
          style={{
            ...item,
            color: confirmDel ? "var(--cv-blocked)" : "var(--cv-ink-dim)",
          }}
          onClick={() => {
            if (confirmDel) { deleteWorkspace(nodeId); onClose(); }
            else setConfirmDel(true);
          }}
        >
          {confirmDel ? "confirm delete?" : "delete workspace"}
        </button>
      )}
    </div>
  );
}
