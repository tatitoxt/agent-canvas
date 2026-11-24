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

const railColRight: React.CSSProperties = {
  ...railCol,
  left: undefined,
  right: 12,
};

const bubble: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 3,
  padding: "6px 5px",
  borderRadius: 14,
};

const bubbleRow: React.CSSProperties = {
  ...bubble,
  flexDirection: "row",
  padding: "5px 6px",
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

const miniBtn = (active: boolean): React.CSSProperties => ({
  ...btn(active),
  width: 26,
  height: 26,
  borderRadius: 7,
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

const badge = (bg: string): React.CSSProperties => ({
  position: "absolute",
  top: 0,
  right: 0,
  minWidth: 13,
  height: 13,
  borderRadius: 999,
  background: bg,
  color: "var(--cv-base)",
  fontSize: 8.5,
  fontWeight: 700,
  display: "grid",
  placeItems: "center",
  padding: "0 3px",
});

const hoverRow = (e: React.MouseEvent<HTMLButtonElement>, on: boolean) => {
  e.currentTarget.style.background = on ? "var(--cv-glass-hi)" : "transparent";
};

/** Board tiles — Deska's Spaces list. `menuSide` is which edge the
 * (future) flyouts open toward; today only tiles render. */
function SpacesBubble() {
  const boards = useBoard((s) => s.boards);
  const activeBoard = useBoard((s) => s.activeBoard);
  const setActiveBoard = useBoard((s) => s.setActiveBoard);
  const createBoard = useBoard((s) => s.createBoard);
  const renameBoard = useBoard((s) => s.renameBoard);
  const deleteBoard = useBoard((s) => s.deleteBoard);
  const agents = useBoard((s) => s.agents);

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
              <span style={badge("var(--cv-done)")}>{agentCount(id)}</span>
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
  );
}

/** Integrations hub — one button, dropdown opens toward `side`. */
function ExtrasBubble({ side, onSelect }: { side: "left" | "right"; onSelect: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <nav ref={ref} className="glass" style={{ ...bubble, position: "relative" }}>
      <button
        title="Extras — plug other apps into the canvas (VS Code, Obsidian, Discord)"
        onClick={() => setOpen((o) => !o)}
        style={btn(open)}
      >
        <Icon name="extras" />
      </button>
      {open && (
        <div
          className="cv-menu"
          style={{
            position: "absolute",
            [side]: 46,
            bottom: 0,
            width: 208,
            padding: 6,
            zIndex: 40,
          }}
        >
          <div style={sectionLabel}>Extras</div>
          {[
            ["monitor", "VS Code", "bridge — soon"],
            ["vault", "Obsidian vault", "open vault panel"],
            ["thread", "Discord bridge", "chat relay — soon"],
            ["automations", "GitHub Actions", "watch runs — soon"],
          ].map(([icon, label, hint]) => (
            <button
              key={label}
              style={menuRow}
              title={hint}
              onClick={() => {
                if (label === "Obsidian vault") onSelect("vault");
                setOpen(false);
              }}
              onMouseEnter={(e) => hoverRow(e, true)}
              onMouseLeave={(e) => hoverRow(e, false)}
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
  );
}

/** Left rail — the code bubble up top (source control, explorer,
 * dev ticket, daemon status), Extras parked at the bottom. */
export function NavRail({ active, onSelect }: { active: string; onSelect: (key: string) => void }) {
  const agents = useBoard((s) => s.agents);
  const activeBoard = useBoard((s) => s.activeBoard);
  const connected = useBoard((s) => s.connected);
  const openAgents = Object.values(agents)
    .filter((a) => (a.board_id ?? "main") === activeBoard && a.status !== "exited");
  const gitAgents = openAgents.filter((a) => a.worktree);

  const [menu, setMenu] = useState<"git" | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menu]);

  return (
    <div ref={railRef} style={railCol}>
      <nav className="glass" style={bubble}>
        <div style={{ position: "relative" }}>
          <button
            title="Source control — worktrees, push an agent's branch"
            onClick={() => setMenu((m) => (m === "git" ? null : "git"))}
            style={btn(menu === "git")}
          >
            <Icon name="git" />
            {gitAgents.length > 0 && (
              <span style={badge("var(--cv-glass-hi)")}>{gitAgents.length}</span>
            )}
          </button>
          {menu === "git" && (
            <div
              className="cv-menu cv-menu-scroll"
              style={{
                position: "absolute",
                left: 46,
                top: 0,
                width: 220,
                padding: 6,
                zIndex: 40,
                maxHeight: 340,
                overflowY: "auto",
              }}
            >
              <div style={sectionLabel}>Source control</div>
              {gitAgents.length === 0 && (
                <div style={{ ...menuRow, color: "var(--cv-ink-faint)", cursor: "default" }}>
                  no agents with worktrees
                </div>
              )}
              {gitAgents.map((a) => (
                <button
                  key={a.id}
                  style={menuRow}
                  title={`push ${a.worktree} — the agent's branch`}
                  onClick={() => { useBoard.getState().gitPush(a.id); setMenu(null); }}
                  onMouseEnter={(e) => hoverRow(e, true)}
                  onMouseLeave={(e) => hoverRow(e, false)}
                >
                  <Icon name="git" size={13} color="var(--cv-ink-dim)" />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.name}
                  </span>
                  <span style={{ fontSize: 9.5, color: "var(--cv-ink-faint)" }}>push</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          title="Explorer — vault files"
          onClick={() => onSelect("vault")}
          style={btn(active === "vault")}
        >
          <Icon name="explorer" />
        </button>
        <button
          title="Dev ticket — notes and tasks on the board"
          onClick={() => onSelect("notes")}
          style={btn(active === "notes")}
        >
          <Icon name="ticket" />
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

      <div style={{ flex: 1 }} />

      <ExtrasBubble side="left" onSelect={onSelect} />
    </div>
  );
}

/** Right rail — Spaces up top; the mini controls bubble (zoom,
 * gather, hide, summaries) parked at the bottom-right edge, right
 * of the minimap. */
export function RightRail() {
  const summaries = useBoard((s) => s.panelSummaries);

  return (
    <div style={railColRight}>
      <SpacesBubble />

      <div style={{ flex: 1 }} />

      <nav className="glass" style={bubble}>
        <button title="Zoom out" onClick={() => useBoard.getState().requestZoom(-1)} style={btn(false)}>
          <Icon name="minus" />
        </button>
        <button title="Zoom in" onClick={() => useBoard.getState().requestZoom(1)} style={btn(false)}>
          <Icon name="plus" />
        </button>
        <button title="Zoom to fit — frame the whole board" onClick={() => useBoard.getState().requestView()} style={btn(false)}>
          <Icon name="zoom" />
        </button>
        <button
          title="Gather loose windows into a group"
          onClick={() => useBoard.getState().gatherLoose()}
          style={btn(false)}
        >
          <Icon name="gather" />
        </button>
        <button
          title="Hide panels and menus — chrome away, canvas only"
          onClick={() => useBoard.getState().toggleChrome()}
          style={btn(false)}
        >
          <Icon name="hide" />
        </button>
        <button
          title="Show panel summaries — last line + mini preview per card"
          onClick={() => useBoard.getState().togglePanelSummaries()}
          style={btn(!summaries)}
        >
          <Icon name="eye" color={summaries ? "var(--cv-ink)" : "var(--cv-ink-faint)"} />
        </button>
      </nav>
    </div>
  );
}

/** Bottom dock — the wide Dex pill sits dead-center at the bottom of
 * the screen. A 3-column grid keeps it exactly on the 50% axis:
 * create on its left, the small round inbox on its right. */
export function BottomDock({ active, onSelect }: { active: string; onSelect: (key: string) => void }) {
  const agents = useBoard((s) => s.agents);
  const edges = useBoard((s) => s.edges);
  const approvals = useBoard((s) => s.approvals);
  const inboxCount =
    Object.keys(approvals).length +
    Object.values(agents).filter((a) => a.status === "waiting" || a.status === "blocked").length +
    Object.values(edges).filter((e) => e.state === "delegated").length;
  const [dexText, setDexText] = useState("");
  const dexInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 12,
        zIndex: 20,
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "end",
        pointerEvents: "none",
      }}
    >
      {/* ── left of Dex · create ──────────────────────────── */}
      <div style={{ justifySelf: "end", display: "flex", alignItems: "flex-end", gap: 8, marginRight: 16, pointerEvents: "auto" }}>
        <nav className="glass" style={bubbleRow}>
          <button
            title="New task — open the spawn chooser (lives on the Orchestrator)"
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
      </div>

      {/* ── dead center · Dex (a real input — Enter sends) ── */}
      <div style={{ justifySelf: "center", pointerEvents: "auto" }}>
        <div
          className="glass"
          title="Ask Dex — command the board in plain words"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 40,
            width: 320,
            padding: "0 8px 0 16px",
            borderRadius: 999,
            cursor: "text",
          }}
          onClick={() => dexInputRef.current?.focus()}
        >
          <Icon name="bot" size={16} color={active === "thread" ? "var(--cv-accent)" : "var(--cv-ink-dim)"} />
          <input
            ref={dexInputRef}
            value={dexText}
            onChange={(e) => setDexText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dexText.trim()) {
                useBoard.getState().threadSend(dexText.trim());
                setDexText("");
                onSelect("thread");
              }
            }}
            placeholder="Ask Dex…"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              background: "transparent",
              outline: "none",
              color: "var(--cv-ink)",
              fontSize: 12.5,
              fontWeight: 550,
            }}
          />
          <button
            title="Open the Dex thread"
            onClick={(e) => { e.stopPropagation(); onSelect("thread"); }}
            style={{ ...miniBtn(false), borderRadius: 999 }}
          >
            <Icon name="thread" size={13} />
          </button>
        </div>
      </div>

      {/* ── right of Dex · inbox, small and round ─────────── */}
      <div style={{ justifySelf: "start", display: "flex", alignItems: "flex-end", gap: 8, marginLeft: 16, pointerEvents: "auto" }}>
        <nav className="glass" style={{ ...bubbleRow, borderRadius: 999, padding: 3 }}>
          <button
            title="Inbox — approvals, waiting agents, delegations in flight"
            onClick={() => onSelect("inbox")}
            style={miniBtn(active === "inbox")}
          >
            <Icon name="inbox" size={13} />
            {inboxCount > 0 && <span style={badge("var(--cv-waiting)")}>{inboxCount}</span>}
          </button>
        </nav>
      </div>
    </div>
  );
}
