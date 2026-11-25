import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { TeamBuilder } from "./TeamBuilder";
import { WebLauncher } from "./WebLauncher";
import { useBoard } from "../store/board";

const PANEL_ITEMS = [
  { key: "inbox", icon: "inbox", label: "Inbox", hint: "tasks and agent requests" },
  { key: "sc", icon: "git", label: "Source Control", hint: "branches, changed files and push" },
  { key: "prs", icon: "github", label: "Pull requests", hint: "review and merge requests" },
  { key: "explorer", icon: "explorer", label: "Explorer", hint: "browse repository files and preview code" },
  { key: "vault", icon: "vault", label: "Obsidian", hint: "browse and edit your live vault" },
  { key: "tickets", icon: "ticket", label: "Dex Tickets", hint: "delegations and task outcomes" },
  { key: "artifacts", icon: "artifacts", label: "Artifacts", hint: "saved notes and agent work" },
  { key: "thread", icon: "thread", label: "Thread", hint: "command the board in words" },
  { key: "automations", icon: "automations", label: "Automations" },
  { key: "loops", icon: "loops", label: "Loops", hint: "re-send instructions on a cadence" },
  { key: "presets", icon: "presets", label: "Presets", hint: "saved board layouts" },
  { key: "memory", icon: "memory", label: "Memory" },
  { key: "notes", icon: "notes", label: "Board Notes" },
  { key: "skills", icon: "skills", label: "Skills" },
  { key: "accounts", icon: "accounts", label: "Accounts" },
  { key: "usage", icon: "mission-map", label: "Mission Map", hint: "agents, terminals, models and accounts" },
  { key: "settings", icon: "settings", label: "Settings" },
  { key: "issues", icon: "issue", label: "Issues", hint: "issues from the connected repo" },
] as const;

const rowBtn: React.CSSProperties = {
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

const miniInput: React.CSSProperties = {
  background: "var(--cv-glass-hi)",
  border: "1px solid var(--cv-glass-edge)",
  borderRadius: 8,
  height: 26,
  padding: "0 9px",
  fontSize: 11,
  color: "var(--cv-ink)",
  outline: "none",
  width: "100%",
};

export interface ToolsMenuActions {
  onDigest: () => void;
  onShot: () => void;
  onStudio: () => void;
  onDraw: () => void;
  onRegion: () => void;
  onMission?: () => void;
  onAddToBoard?: (key: string) => void;
  drawOn: boolean;
  regionOn: boolean;
}

/** Tools launcher for board actions and the complete set of canvas panels. */
export function ToolsMenu({
  active,
  onSelect,
  actions,
}: {
  active: string;
  onSelect: (key: string) => void;
  actions: ToolsMenuActions;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [sub, setSub] = useState<"ws" | "shape" | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [wsName, setWsName] = useState("");
  const [wsRepo, setWsRepo] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPinned(localStorage.getItem("cv-tools-pinned") === "true");
  }, []);

  const activeBoard = useBoard((s) => s.activeBoard);
  const spawnOrchestrator = useBoard((s) => s.spawnOrchestrator);
  const pauseAll = useBoard((s) => s.pauseAll);
  const resumeAll = useBoard((s) => s.resumeAll);
  const gatherLoose = useBoard((s) => s.gatherLoose);
  const summaries = useBoard((s) => s.panelSummaries);
  const togglePanelSummaries = useBoard((s) => s.togglePanelSummaries);
  const createWorkspace = useBoard((s) => s.createWorkspace);
  const addShape = useBoard((s) => s.addShape);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!wrap.current?.contains(target) && !dock.current?.contains(target) && !pinned) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, pinned]);

  const dismiss = () => { if (!pinned) setOpen(false); };

  const item = (icon: string, label: string, onClick: () => void, hint?: string, on?: boolean) => (
    <button
      key={label}
      style={{ ...rowBtn, color: on ? "var(--cv-accent)" : "var(--cv-ink)" }}
      title={hint}
      onClick={() => {
        onClick();
        setSub(null);
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--cv-glass-hi)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon name={icon} size={14} color={on ? "var(--cv-accent)" : "var(--cv-ink-dim)"} />
      <span style={{ flex: 1 }}>{label}</span>
      {hint && <span style={{ fontSize: 9.5, color: "var(--cv-ink-faint)" }}>{hint}</span>}
    </button>
  );

  return (
    <div ref={wrap} style={{ position: "relative", pointerEvents: "auto" }}>
      <button
        className="glass-pill"
        onClick={() => setOpen((o) => !o)}
        title="Tools — panels, board ops, capture"
        style={{
          display: "grid",
          placeItems: "center",
          width: 34,
          height: 34,
          color: open ? "var(--cv-accent)" : "var(--cv-ink)",
          cursor: "pointer",
        }}
      >
        <Icon name="tools" size={15} color={open ? "var(--cv-accent)" : "var(--cv-ink-dim)"} />
      </button>
      {open && createPortal(
        <div
          ref={dock}
          className="cv-menu"
          role="dialog"
          aria-label="Tools panel"
          style={{
            position: "fixed", top: 76, right: 14, bottom: 18,
            width: collapsed ? 54 : 292, maxWidth: "calc(100vw - 28px)",
            display: "flex", flexDirection: "column", overflow: "hidden",
            zIndex: 70, transition: "width 180ms ease",
          }}
        >
          <header style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 48, padding: collapsed ? "0 10px" : "0 14px", borderBottom: "1px solid var(--cv-glass-edge)" }}>
            {!collapsed && <strong style={{ flex: 1, fontSize: 13, fontWeight: 650 }}>Tools</strong>}
            <button className="glass-pill" title={pinned ? "Unpin Tools panel" : "Pin Tools panel"} aria-label={pinned ? "Unpin Tools panel" : "Pin Tools panel"} onClick={() => { const next = !pinned; setPinned(next); localStorage.setItem("cv-tools-pinned", String(next)); }} style={{ width: 28, height: 28, display: "grid", placeItems: "center", color: pinned ? "var(--cv-accent)" : "var(--cv-ink-dim)" }}><Icon name="pin" size={14} /></button>
            <button className="glass-pill" title={collapsed ? "Expand Tools panel" : "Collapse Tools panel"} aria-label={collapsed ? "Expand Tools panel" : "Collapse Tools panel"} onClick={() => setCollapsed((v) => !v)} style={{ width: 28, height: 28, display: "grid", placeItems: "center" }}><Icon name={collapsed ? "expand" : "collapse"} size={14} /></button>
            {!pinned && <button className="glass-pill" title="Close Tools panel" aria-label="Close Tools panel" onClick={() => setOpen(false)} style={{ width: 28, height: 28, display: "grid", placeItems: "center" }}><Icon name="x" size={14} /></button>}
          </header>
          <div className="cv-menu-scroll" style={{ flex: 1, overflowY: "auto", padding: collapsed ? "6px 5px" : "6px 6px 10px" }}>
          {!collapsed && <>
          <div style={sectionLabel}>Board</div>
          {item("automations", "New orchestrator", () => { spawnOrchestrator(); dismiss(); }, "wire consoles, command all")}
          {item("accounts", "Team builder", () => { setTeamOpen(true); dismiss(); }, "roles × one CLI")}
          {item("shape", "Add shape", () => setSub((s) => (s === "shape" ? null : "shape")), "whiteboard")}
          {sub === "shape" && (
            <div style={{ display: "flex", gap: 6, padding: "4px 10px 6px" }}>
              {(["rect", "ellipse", "diamond", "sticky"] as const).map((k) => (
                <button
                  key={k}
                  className="glass-pill"
                  style={{ ...rowBtn, width: "auto", padding: "5px 10px", justifyContent: "center", fontSize: 12 }}
                  title={k}
                  onClick={() => { addShape(k); setSub(null); dismiss(); }}
                >
                  {{ rect: "▢", ellipse: "◯", diamond: "◇", sticky: "▤" }[k]}
                </button>
              ))}
            </div>
          )}
          {item("ws", "New workspace", () => setSub((s) => (s === "ws" ? null : "ws")))}
          {sub === "ws" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "4px 10px 6px" }}>
              <input style={miniInput} placeholder="workspace name" value={wsName} onChange={(e) => setWsName(e.target.value)} autoFocus />
              <input style={miniInput} placeholder="repo path (~/repos/my-app)" value={wsRepo} onChange={(e) => setWsRepo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && wsName.trim() && wsRepo.trim()) {
                    createWorkspace(wsName.trim(), wsRepo.trim());
                    setSub(null); dismiss(); setWsName(""); setWsRepo("");
                  }
                }} />
            </div>
          )}
          {item("web", "Open a page", () => { setLauncherOpen(true); dismiss(); }, "web nodes on canvas")}
          {item("pause", "Pause all", () => pauseAll(activeBoard), "SIGSTOP every agent")}
          {item("play", "Resume all", () => resumeAll(activeBoard))}
          {item("gather", "Gather loose windows", () => { gatherLoose(); dismiss(); }, "into a group")}
          {item("eye", "Panel summaries", () => togglePanelSummaries(), summaries ? "on" : "off", summaries)}
          <div style={sectionLabel}>Capture</div>
          {item("draw", "Pencil markups", () => { actions.onDraw(); dismiss(); }, actions.drawOn ? "on" : "", actions.drawOn)}
          {item("region", "Region shot", () => { actions.onRegion(); dismiss(); }, "drag → PNG")}
          {item("shot", "Canvas shot", () => { actions.onShot(); dismiss(); }, "⌘⇧S")}
          {item("digest", "Session digest", () => { actions.onDigest(); dismiss(); }, "lose nothing")}
          {item("studio", "Studio doc", () => { actions.onStudio(); dismiss(); }, "repo → dossier")}
          <div style={sectionLabel}>Panels</div>
          {PANEL_ITEMS.map((it) => (
            <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <div style={{ flex: 1 }}>{item(it.icon, it.label, () => { onSelect(it.key); dismiss(); }, "hint" in it ? it.hint : undefined, active === it.key)}</div>
              <button
                title={`Add ${it.label} to canvas`}
                aria-label={`Add ${it.label} to canvas`}
                onClick={() => {
                  actions.onAddToBoard?.(it.key);
                  setOpen(false);
                }}
                style={{ border: "none", background: "transparent", color: "var(--cv-ink-faint)", borderRadius: 7, cursor: "pointer", padding: "5px 7px", fontSize: 12 }}
              >+</button>
            </div>
          ))}
          </>}
          {collapsed && PANEL_ITEMS.map((it) => <button key={it.key} title={it.label} aria-label={it.label} onClick={() => { onSelect(it.key); dismiss(); }} style={{ ...rowBtn, justifyContent: "center", padding: "9px 0", color: active === it.key ? "var(--cv-accent)" : "var(--cv-ink)" }}><Icon name={it.icon} size={16} /></button>)}
          </div>
        </div>,
        document.body,
      )}
      {teamOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
          <TeamBuilder onClose={() => setTeamOpen(false)} />
        </div>
      )}
      {launcherOpen && <WebLauncher onClose={() => setLauncherOpen(false)} />}
    </div>
  );
}
