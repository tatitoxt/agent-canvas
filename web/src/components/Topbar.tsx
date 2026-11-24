import { useEffect, useRef, useState } from "react";
import { useBoard } from "../store/board";
import { Icon } from "./icons";
import { ToolsMenu, type ToolsMenuActions } from "./ToolsRail";

const pill: React.CSSProperties = {
  padding: "5px 10px",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--cv-ink)",
  display: "flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const iconBtn = (active: boolean): React.CSSProperties => ({
  display: "grid",
  placeItems: "center",
  width: 34,
  height: 34,
  color: active ? "var(--cv-accent)" : "var(--cv-ink)",
  cursor: "pointer",
  position: "relative",
});

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

const sectionLabel: React.CSSProperties = {
  fontSize: 8.5,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "var(--cv-ink-faint)",
  padding: "8px 10px 3px",
};

/** Deska-style topbar. Left: machine (This Mac / cloud / phone), workspaces,
 * worktrees, tasks. Right, icon-only: mission map, search, automations,
 * notifications, tools, settings. Everything iconified with tooltips. */
export function Topbar({
  nav,
  onNav,
  tools,
}: {
  nav: string;
  onNav: (key: string) => void;
  tools: ToolsMenuActions;
}) {
  const connected = useBoard((s) => s.connected);
  const workspaces = useBoard((s) => s.workspaces);
  const agents = useBoard((s) => s.agents);
  const edges = useBoard((s) => s.edges);
  const approvals = useBoard((s) => s.approvals);

  const wsList = Object.values(workspaces);
  const liveAgents = Object.values(agents).filter((a) => a.status !== "exited");
  const delegated = Object.values(edges).filter((e) => e.state === "delegated").length;
  const waiting = Object.values(agents).filter((a) => a.status === "waiting").length;
  const blockedN = Object.values(agents).filter((a) => a.status === "blocked").length;
  const notifCount = Object.keys(approvals).length + waiting + blockedN;

  const [menu, setMenu] = useState<"machine" | "ws" | "wt" | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menu]);

  const drop = (key: "machine" | "ws" | "wt", node: React.ReactNode) =>
    menu === key ? (
      <div
        className="cv-menu cv-menu-scroll"
        style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          left: 0,
          minWidth: 200,
          maxHeight: "60vh",
          overflowY: "auto",
          padding: 6,
          zIndex: 40,
        }}
      >
        {node}
      </div>
    ) : null;

  const row = (icon: string, label: string, hint: string, onClick?: () => void, dim?: boolean) => (
    <button
      key={label}
      style={{ ...menuRow, opacity: dim ? 0.45 : 1, cursor: onClick ? "pointer" : "default" }}
      title={hint}
      onClick={() => { onClick?.(); setMenu(null); }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--cv-glass-hi)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon name={icon} size={14} color="var(--cv-ink-dim)" />
      <span style={{ flex: 1 }}>{label}</span>
      {dim && <span style={{ fontSize: 9, color: "var(--cv-ink-faint)" }}>soon</span>}
    </button>
  );

  const openSearch = () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }));

  return (
    <div
      ref={wrap}
      style={{
        position: "absolute",
        top: 12,
        left: 58,
        right: 12,
        zIndex: 15,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {/* ── left: app · machine · workspaces · worktrees · tasks ── */}
      <div
        className="glass-pill"
        style={{
          display: "flex",
          alignItems: "center",
          padding: "3px 6px",
          gap: 2,
          pointerEvents: "auto",
        }}
      >
        <span style={{ ...pill, color: "var(--cv-accent)", fontWeight: 700, cursor: "default" }}>
          Canvas
        </span>
        <div style={{ position: "relative" }}>
          <button
            style={{ ...pill, border: "none", background: "transparent" }}
            title="Machine — where agents run"
            onClick={() => setMenu((m) => (m === "machine" ? null : "machine"))}
          >
            <Icon name="monitor" size={13} color="var(--cv-ink-dim)" />
            This Mac
            <span style={{ fontSize: 9, color: "var(--cv-ink-faint)" }}>▾</span>
          </button>
          {drop("machine", (
            <>
              <div style={sectionLabel}>Machine</div>
              {row("monitor", "This Mac", "agents run locally", () => {})}
              {row("ws", "Cloud box", "remote runner — soon", undefined, true)}
              {row("bot", "Phone", "pair a device — soon", undefined, true)}
            </>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <button
            style={{ ...pill, border: "none", background: "transparent" }}
            title="Workspaces"
            onClick={() => setMenu((m) => (m === "ws" ? null : "ws"))}
          >
            <Icon name="ws" size={13} color="var(--cv-ink-dim)" />
            {wsList.length > 0 ? `${wsList.length} ws` : "Workspaces"}
            <span style={{ fontSize: 9, color: "var(--cv-ink-faint)" }}>▾</span>
          </button>
          {drop("ws", (
            <>
              <div style={sectionLabel}>Workspaces</div>
              {wsList.length === 0 &&
                row("ws", "no workspaces", "create one from Tools → New workspace")}
              {wsList.map((w) =>
                row("ws", w.name, w.repo ?? "", () => useBoard.getState().requestFocus(w.id)),
              )}
            </>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <button
            style={{ ...pill, border: "none", background: "transparent" }}
            title="Worktrees — agent branches in flight"
            onClick={() => setMenu((m) => (m === "wt" ? null : "wt"))}
          >
            <Icon name="worktree" size={13} color="var(--cv-ink-dim)" />
            Worktrees
            <span style={{ fontSize: 9, color: "var(--cv-ink-faint)" }}>▾</span>
          </button>
          {drop("wt", (
            <>
              <div style={sectionLabel}>Worktrees</div>
              {Object.values(agents).filter((a) => a.worktree && a.status !== "exited").length === 0 &&
                row("worktree", "no worktrees", "spawn agents in a workspace to see their trees")}
              {Object.values(agents)
                .filter((a) => a.worktree && a.status !== "exited")
                .map((a) =>
                  row("worktree", a.name, `${a.branch ?? ""} · ${a.worktree}`, undefined),
                )}
            </>
          ))}
        </div>
        <button
          style={{ ...pill, border: "none", background: "transparent" }}
          title={`Tasks — ${delegated} in flight`}
          onClick={() => onNav("history")}
        >
          <Icon name="tasks" size={13} color="var(--cv-ink-dim)" />
          Tasks{delegated > 0 ? ` ${delegated}` : ""}
        </button>
        <span style={{ fontSize: 10.5, color: "var(--cv-ink-faint)", padding: "0 6px" }}>
          {connected ? `${liveAgents.length} live` : "offline"}
        </span>
      </div>

      <div style={{ flex: 1 }} />

      {/* ── right: icons only ── */}
      <div
        className="glass-pill"
        style={{
          display: "flex",
          alignItems: "center",
          padding: "3px 4px",
          gap: 2,
          pointerEvents: "auto",
        }}
      >
        <button
          className="glass-pill"
          style={{ ...iconBtn(false), background: "transparent", border: "none" }}
          title="Search — find on the board (⌘F)"
          onClick={openSearch}
        >
          <Icon name="search" size={15} color="var(--cv-ink-dim)" />
        </button>
        <button
          className="glass-pill"
          style={{ ...iconBtn(nav === "automations"), background: "transparent", border: "none" }}
          title="Automations"
          onClick={() => onNav("automations")}
        >
          <Icon name="automations" size={15} color={nav === "automations" ? "var(--cv-accent)" : "var(--cv-ink-dim)"} />
        </button>
        <button
          className="glass-pill"
          style={{ ...iconBtn(nav === "inbox"), background: "transparent", border: "none" }}
          title="Notifications — approvals and agents that need you"
          onClick={() => onNav("inbox")}
        >
          <Icon name="bell" size={15} color={nav === "inbox" ? "var(--cv-accent)" : "var(--cv-ink-dim)"} />
          {notifCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                minWidth: 13,
                height: 13,
                borderRadius: 999,
                background: "var(--cv-waiting)",
                color: "var(--cv-base)",
                fontSize: 8.5,
                fontWeight: 700,
                display: "grid",
                placeItems: "center",
                padding: "0 3px",
              }}
            >
              {notifCount}
            </span>
          )}
        </button>
        <button
          className="glass-pill"
          style={{ ...iconBtn(false), background: "transparent", border: "none" }}
          title="Mission Map — fit the whole board in view"
          onClick={() => useBoard.getState().requestView()}
        >
          <Icon name="map" size={15} color="var(--cv-ink-dim)" />
        </button>
        <ToolsMenu active={nav} onSelect={onNav} actions={tools} />
        <button
          className="glass-pill"
          style={{ ...iconBtn(nav === "settings"), background: "transparent", border: "none" }}
          title="Settings"
          onClick={() => onNav("settings")}
        >
          <Icon name="settings" size={15} color={nav === "settings" ? "var(--cv-accent)" : "var(--cv-ink-dim)"} />
        </button>
      </div>
    </div>
  );
}
