import { useEffect, useRef, useState } from "react";
import { useBoard } from "../store/board";
import { Icon } from "./icons";

const railCol: React.CSSProperties = {
  position: "absolute",
  left: 12,
  top: 58,
  bottom: 12,
  zIndex: 20,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
};

const bubble: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 3,
  padding: "6px 5px",
  borderRadius: 14,
};

const btn = (active: boolean): React.CSSProperties => ({
  width: 32,
  height: 32,
  display: "grid",
  placeItems: "center",
  borderRadius: 9,
  border: "none",
  cursor: "pointer",
  color: active ? "var(--cv-ink)" : "var(--cv-ink-faint)",
  background: active ? "var(--cv-glass-hi)" : "transparent",
  position: "relative",
  boxShadow: active ? "inset 0 1px 0 var(--cv-glass-shine)" : "none",
});

const sectionLabel: React.CSSProperties = {
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: 0.9,
  color: "var(--cv-ink-faint)",
  textTransform: "uppercase",
  padding: "1px 0 2px",
};

const menuRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  width: "100%",
  padding: "6px 10px",
  border: "none",
  background: "transparent",
  color: "var(--cv-ink)",
  fontSize: 11.5,
  fontWeight: 550,
  textAlign: "left",
  cursor: "pointer",
  borderRadius: 8,
};

const statusDot = (c: string): React.CSSProperties => ({
  width: 6,
  height: 6,
  borderRadius: 99,
  background: c,
  flex: "none",
});

const STATUS_COLOR: Record<string, string> = {
  working: "var(--cv-working)",
  waiting: "var(--cv-waiting)",
  blocked: "var(--cv-blocked)",
  done: "var(--cv-done)",
  idle: "var(--cv-idle)",
  exited: "var(--cv-idle)",
};

/** Left rail, Deska-style — stacked separate bubbles instead of one
 * packed column: Spaces · Extras · New/Task tools · Ask Dex + Inbox ·
 * open panels · canvas controls (hide, gather, zoom). */
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
  const summaries = useBoard((s) => s.panelSummaries);
  const inboxCount =
    Object.keys(approvals).length +
    Object.values(agents).filter((a) => a.status === "waiting" || a.status === "blocked").length +
    Object.values(edges).filter((e) => e.state === "delegated").length;

  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [editName, setEditName] = useState("");
  const [menu, setMenu] = useState<"extras" | "panels" | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menu]);

  const agentCount = (boardId: string) =>
    Object.values(agents).filter(
      (a) => (a.board_id ?? "main") === boardId && a.status !== "exited",
    ).length;

  const openAgents = Object.values(agents)
    .filter((a) => (a.board_id ?? "main") === activeBoard && a.status !== "exited");

  const submitEdit = () => {
    const n = editName.trim();
    if (n) {
      if (editing === "new") createBoard(n);
      else if (editing) renameBoard(editing, n);
    }
    setEditing(null);
    setEditName("");
  };

  const renameInput = (key: string) => (
    <input
      key={key}
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
        width: 32,
        height: 32,
        borderRadius: 9,
        border: "1px solid var(--cv-glass-edge)",
        background: "var(--cv-glass-hi)",
        color: "var(--cv-ink)",
        fontSize: 11,
        textAlign: "center",
        outline: "none",
      }}
    />
  );

  return (
    <div ref={railRef} style={railCol}>
      {/* ── Bubble 1 · Spaces ─────────────────────────────── */}
      <nav className="glass" style={bubble}>
        <div style={sectionLabel}>Spaces</div>
        {Object.entries(boards).map(([id, n]) =>
          editing === id ? (
            renameInput(id)
          ) : (
            <button
              key={id}
              onClick={() => setActiveBoard(id)}
              onDoubleClick={() => { setEditing(id); setEditName(n); }}
              onContextMenu={(e) => { e.preventDefault(); setEditing(id); setEditName(n); }}
              title={`${n} — double-click to rename${id !== "main" ? ", ⌫ deletes when empty" : ""}`}
              style={{
                ...btn(id === activeBoard),
                fontSize: 12,
                fontWeight: 700,
                color: id === activeBoard ? "var(--cv-accent)" : "var(--cv-ink-dim)",
              }}
            >
              {n.slice(0, 1).toUpperCase()}
              {agentCount(id) > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
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
                  onClick={(e) => { e.stopPropagation(); deleteBoard(id); }}
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
          renameInput("new")
        ) : (
          <button
            onClick={() => { setEditing("new"); setEditName(""); }}
            title="New board"
            style={{ ...btn(false), fontSize: 15 }}
          >
            +
          </button>
        )}
      </nav>

      {/* ── Bubble 2 · Extras (integrations hub) ──────────── */}
      <nav className="glass" style={{ ...bubble, position: "relative" }}>
        <button
          title="Extras — plug other apps into the canvas"
          onClick={() => setMenu((m) => (m === "extras" ? null : "extras"))}
          style={btn(menu === "extras")}
        >
          <Icon name="extras" />
        </button>
        {menu === "extras" && (
          <div className="cv-menu" style={{ position: "absolute", left: 46, top: 0, width: 208, padding: 6, zIndex: 40 }}>
            <div style={sectionLabel}>Extras</div>
            {[
              ["monitor", "VS Code", "bridge — soon"],
              ["vault", "Obsidian vault", "open vault panel"],
              ["thread", "Discord bridge", "chat relay — soon"],
              ["automations", "GitHub Actions", "watch runs — soon"],
            ].map(([icon, label, hint]) => (
              <button
                key={label}
                style={{ ...menuRow, opacity: label.includes("—") ? 1 : 1 }}
                title={hint}
                onClick={() => {
                  if (label === "Obsidian vault") onSelect("vault");
                  setMenu(null);
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--cv-glass-hi)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Icon name={icon as string} size={14} color="var(--cv-ink-dim)" />
                <span style={{ flex: 1 }}>{label}</span>
                {hint.includes("soon") && (
                  <span style={{ fontSize: 9, color: "var(--cv-ink-faint)" }}>soon</span>
                )}
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* ── Bubble 3 · create ─────────────────────────────── */}
      <nav className="glass" style={bubble}>
        <button
          title="New task — pick a CLI and spawn (focuses the spawn button)"
          onClick={() => useBoard.getState().focusSpawn()}
          style={btn(false)}
        >
          <Icon name="newtask" />
        </button>
        <button
          title="File Explorer — vault files"
          onClick={() => onSelect("vault")}
          style={btn(active === "vault")}
        >
          <Icon name="explorer" />
        </button>
        <button
          title="Terminal — spawn a plain shell"
          onClick={() => useBoard.getState().spawn("Terminal", "bash")}
          style={btn(false)}
        >
          <Icon name="terminal" />
        </button>
        <button
          title="Code Editor — notes"
          onClick={() => onSelect("notes")}
          style={btn(active === "notes")}
        >
          <Icon name="code" />
        </button>
      </nav>

      {/* ── Bubble 4 · Dex + comms ────────────────────────── */}
      <nav className="glass" style={bubble}>
        <button
          title="Ask Dex — talk to the board commander"
          onClick={() => onSelect("thread")}
          style={btn(active === "thread")}
        >
          <Icon name="bot" color={active === "thread" ? "var(--cv-accent)" : undefined} />
        </button>
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
                top: 0,
                right: 0,
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
        <button
          title="Automations"
          onClick={() => onSelect("automations")}
          style={btn(active === "automations")}
        >
          <Icon name="automations" />
        </button>
      </nav>

      {/* ── Bubble 5 · open panels ────────────────────────── */}
      <nav className="glass" style={{ ...bubble, position: "relative" }}>
        <button
          title="Panels on the canvas — which terminals are open"
          onClick={() => setMenu((m) => (m === "panels" ? null : "panels"))}
          style={btn(menu === "panels")}
        >
          <Icon name="panels" />
          {openAgents.length > 0 && (
            <span
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                minWidth: 13,
                height: 13,
                borderRadius: 999,
                background: "var(--cv-glass-hi)",
                border: "1px solid var(--cv-glass-edge)",
                color: "var(--cv-ink-dim)",
                fontSize: 8.5,
                fontWeight: 700,
                display: "grid",
                placeItems: "center",
                padding: "0 3px",
              }}
            >
              {openAgents.length}
            </span>
          )}
        </button>
        {menu === "panels" && (
          <div className="cv-menu" style={{ position: "absolute", left: 46, top: 0, width: 216, padding: 6, zIndex: 40, maxHeight: 320, overflowY: "auto" }}>
            <div style={sectionLabel}>Panels on the canvas</div>
            {openAgents.length === 0 && (
              <div style={{ ...menuRow, color: "var(--cv-ink-faint)", cursor: "default" }}>
                no open panels
              </div>
            )}
            {openAgents.map((a) => (
              <button
                key={a.id}
                style={menuRow}
                title={`open ${a.name}`}
                onClick={() => { useBoard.getState().requestTerm(a.id, a.name); setMenu(null); }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--cv-glass-hi)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={statusDot(STATUS_COLOR[a.status] ?? "var(--cv-idle)")} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.name}
                </span>
                <span style={{ fontSize: 9.5, color: "var(--cv-ink-faint)" }}>{a.status}</span>
              </button>
            ))}
          </div>
        )}
      </nav>

      <div style={{ flex: 1 }} />

      {/* ── Bubble 6 · canvas controls ────────────────────── */}
      <nav className="glass" style={bubble}>
        <button
          title="Hide panels and menus — chrome away, canvas only"
          onClick={() => useBoard.getState().toggleChrome()}
          style={btn(false)}
        >
          <Icon name="hide" />
        </button>
        <button
          title="Gather loose windows into a group"
          onClick={() => useBoard.getState().gatherLoose()}
          style={btn(false)}
        >
          <Icon name="gather" />
        </button>
        <button
          title="Show panel summaries — last line + mini preview per card"
          onClick={() => useBoard.getState().togglePanelSummaries()}
          style={btn(!summaries)}
        >
          <Icon name="eye" color={summaries ? "var(--cv-ink)" : "var(--cv-ink-faint)"} />
        </button>
      </nav>
      <nav className="glass" style={bubble}>
        <button title="Zoom out" onClick={() => useBoard.getState().requestZoom(-1)} style={btn(false)}>
          <Icon name="minus" />
        </button>
        <button title="Zoom in" onClick={() => useBoard.getState().requestZoom(1)} style={btn(false)}>
          <Icon name="plus" />
        </button>
        <button title="Zoom to fit" onClick={() => useBoard.getState().requestView()} style={btn(false)}>
          <Icon name="zoom" />
        </button>
        <div
          title={connected ? "daemon connected" : "daemon offline"}
          style={{
            marginTop: 2,
            width: 7,
            height: 7,
            borderRadius: 999,
            background: connected ? "var(--cv-done)" : "var(--cv-ink-faint)",
          }}
        />
      </nav>
    </div>
  );
}
